/**
 * Replay model: turns one recorded (finished) game into "what the providers would have returned at virtual time V".
 *
 * Nothing here is imported by production code. It reads fixtures written by scripts/record-game.mjs
 * (server/test/fixtures/replay/<league>-<espnId>/) and reuses the real payload shapes, so the production parsers
 * (`normalizeEvent`, `parseSummary`, `normalizeNhl`, `parsePbp`) run unchanged against the reconstructed responses.
 *
 * Fidelity (details in docs/notes/replay-research.md): score, period, intermissions, goals/cards and the NHL skater situation are
 * exact at play granularity; the running clock is interpolated between plays; boxscore stats are the final numbers scaled by
 * elapsed time (approximation); team schedule/stats are the recorded (final-day) ones.
 */
import fs from "node:fs";
import path from "node:path";
import { leagueById, periodSeconds, type LeagueDef } from "../leagues.js";
import type { Raw } from "../providers/raw.js";


/** Virtual time starts this long before the game's first recorded event, so the "pre" state and game_start are visible. */
export const LEAD_MS = 10 * 60_000;

interface Meta {
  league: string;
  espn_id: string;
  date: string;
  title: string;
  start_time: string;
  nhl_id?: string | undefined;
}

export interface Marker {
  kind: "start" | "goal" | "intermission" | "resume" | "final";
  label: string;
  /** virtual ms since sim origin */
  v: number;
}

interface Snap {
  state: "pre" | "in" | "post";
  period: number;
  /** seconds left on a count-down clock (hockey/basketball/football), or elapsed seconds for soccer */
  clockS?: number | undefined;
  running: boolean;
  intermission: boolean;
  /** seconds until the next period starts, while intermission */
  breakLeftS?: number | undefined;
  halftime: boolean;
  half?: "Top" | "Bottom" | undefined;
  home: number;
  away: number;
}

interface Mark {
  w: number;
  period: number;
  /** seconds remaining on the display clock (count-down sports) */
  rem?: number | undefined;
  /** hockey: seconds elapsed in the period */
  el?: number | undefined;
  home: number;
  away: number;
  type: string;
  scoring: boolean;
  half?: "Top" | "Bottom" | undefined;
}

interface Timeline {
  first: number;
  end: number;
  snap(w: number): Snap;
  /** cumulative score deltas per period for the given team side, for periods that have started by `w` */
  linescores(w: number): { home: number[]; away: number[] };
}

const mmss = (s: unknown): number => {
  const m = /^(\d+):(\d{2})$/.exec(String(s ?? "").trim());
  return m ? Number(m[1]) * 60 + Number(m[2]) : NaN;
};
const fmtClock = (sec: number): string => {
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};
const fmtClock2 = (sec: number): string => {
  const s = Math.max(0, Math.round(sec));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
};
const ord = (n: number) => `${n}${["th", "st", "nd", "rd"][(n % 100 >= 11 && n % 100 <= 13) || n % 10 > 3 ? 0 : n % 10]}`;

// ---- play-based timeline (hockey, basketball, football, baseball) ---------------------------------------------------

class PlayTimeline implements Timeline {
  readonly marks: Mark[] = [];
  readonly first: number;
  readonly end: number;
  private finalScore: { home: number; away: number };

  constructor(private league: LeagueDef, plays: Raw[], finalScore: { home: number; away: number }) {
    this.finalScore = finalScore;
    let carry = { home: 0, away: 0 };
    // ESPN lists plays in game order but some wallclocks run backwards by seconds (a basket logged late), which would make
    // the score regress; keep the game order and clamp the wall clock to be non-decreasing instead of sorting by it.
    let lastW = 0;
    const sorted = plays
      .filter((p) => p.wallclock && Number.isFinite(Date.parse(p.wallclock)))
      .map((p) => ({ p, w: (lastW = Math.max(lastW, Date.parse(p.wallclock))) }));
    for (const { p, w } of sorted) {
      const period = Number(p.period?.number ?? 0);
      let rem: number | undefined;
      let el: number | undefined;
      if (league.sport === "hockey") {
        el = mmss(p.clock?.displayValue);
        if (!Number.isFinite(el)) el = 0;
        rem = period >= 5 ? 0 : Math.max(0, periodSeconds(league, period) - el);
      } else if (league.sport === "basketball" || league.sport === "football") {
        const v = typeof p.clock?.value === "number" ? p.clock.value : mmss(p.clock?.displayValue);
        rem = Number.isFinite(v) ? v : undefined;
      }
      // ESPN's play log has the odd score glitch (an NBA game lists 106-93 then 103-93); a scoreboard never goes backwards on its
      // own, so keep scores monotonic here and use the explicit phantom-goal scenario to test corrections.
      let home = Math.max(carry.home, Number(p.homeScore ?? carry.home));
      let away = Math.max(carry.away, Number(p.awayScore ?? carry.away));
      // a hockey shootout's own tally (1-0) is not the game score; the real score only changes when the SO ends
      if (league.sport === "hockey" && period >= 5) ({ home, away } = carry);
      carry = { home, away };
      const half = p.period?.type === "Top" || p.period?.type === "Bottom" ? (p.period.type as "Top" | "Bottom") : undefined;
      this.marks.push({ w, period, rem, el, home, away, type: String(p.type?.text ?? ""), scoring: !!p.scoringPlay, half });
    }
    this.first = this.marks[0]?.w ?? 0;
    this.end = this.marks[this.marks.length - 1]?.w ?? 0;
  }

  snap(w: number): Snap {
    const m = this.marks;
    const pre: Snap = { state: "pre", period: 0, running: false, intermission: false, halftime: false, home: 0, away: 0 };
    const last = m[m.length - 1];
    if (!last || w < this.first) return pre;
    if (w >= this.end) {
      return { state: "post", period: last.period, clockS: 0, running: false, intermission: false, halftime: false, ...this.finalScore };
    }
    let i = 0;
    // marks are sorted; linear scan from the end is plenty fast for a few hundred plays
    for (let k = m.length - 1; k >= 0; k--) if ((m[k]?.w ?? Infinity) <= w) { i = k; break; }
    const cur = m[i];
    if (!cur) return pre;
    const nxt = m[i + 1];
    const snap: Snap = { state: "in", period: cur.period, clockS: cur.rem, running: false, intermission: false, halftime: false, home: cur.home, away: cur.away, half: cur.half };
    if (nxt && nxt.period > cur.period) {
      // between the last play of a period and the first of the next one
      snap.intermission = true;
      snap.clockS = 0;
      snap.breakLeftS = Math.max(0, (nxt.w - w) / 1000);
      snap.halftime = false;
    } else if (cur.rem !== undefined && nxt && nxt.period === cur.period && nxt.rem !== undefined) {
      const dt = (w - cur.w) / 1000;
      const left = cur.rem - dt;
      snap.running = left > nxt.rem;
      snap.clockS = Math.max(nxt.rem, left);
    }
    return snap;
  }

  linescores(w: number): { home: number[]; away: number[] } {
    const last = new Map<number, { home: number; away: number }>();
    let maxP = 0;
    for (const k of this.marks) {
      if (k.w > w) break;
      if (this.league.sport === "hockey" && k.period >= 5) continue;
      last.set(k.period, { home: k.home, away: k.away });
      maxP = Math.max(maxP, k.period);
    }
    const home: number[] = [], away: number[] = [];
    let ph = 0, pa = 0;
    for (let p = 1; p <= maxP; p++) {
      const l = last.get(p) ?? { home: ph, away: pa };
      home.push(l.home - ph);
      away.push(l.away - pa);
      ph = l.home;
      pa = l.away;
    }
    return { home, away };
  }
}

// ---- the game ---------------------------------------------------------------------------------------------------------

export class ReplayGame {
  readonly league: LeagueDef;
  readonly id: string;
  readonly meta: Meta;
  readonly origin: number;
  private ev: Raw;
  private sum: Raw;
  private nhlScore?: Raw;
  private nhlPbp?: Raw;
  private tl: Timeline;
  private playWall = new Map<string, number>();
  private nhlPlayWall: number[] = [];
  private nhlGoalWall: number[] = [];
  private files = new Map<string, Raw>();
  private homeId = "";
  private awayId = "";
  readonly recordedDay: string;
  /** scenario injection: a score that appears for a while and is then taken back (an overturned/reviewed goal) */
  private phantom?: { startW: number; endW: number; side: "home" | "away" };

  constructor(readonly dir: string) {
    const rd = (f: string): Raw => JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
    this.meta = rd("meta.json");
    this.league = leagueById(this.meta.league);
    this.id = `${this.league.id}:${this.meta.espn_id}`;
    this.ev = rd("espn-event.json");
    this.sum = rd("espn-summary.json");
    for (const f of fs.readdirSync(dir)) if (/^(team-|gamelog-)/.test(f)) this.files.set(f, rd(f));
    if (fs.existsSync(path.join(dir, "nhl-pbp.json"))) {
      this.nhlPbp = rd("nhl-pbp.json");
      this.nhlScore = fs.existsSync(path.join(dir, "nhl-score-game.json")) ? rd("nhl-score-game.json") : undefined;
    }
    const comp = this.ev.competitions[0];
    const home = comp.competitors.find((c: Raw) => c.homeAway === "home");
    const away = comp.competitors.find((c: Raw) => c.homeAway === "away");
    this.homeId = String(home.team.id);
    this.awayId = String(away.team.id);
    const finalScore = { home: Number(home.score) || 0, away: Number(away.score) || 0 };
    this.recordedDay = this.meta.date;

    // wall-clock lookup for every play we have an id for
    const allPlays: Raw[] = [...(this.sum.plays ?? [])];
    for (const p of allPlays) if (p.id && p.wallclock) this.playWall.set(String(p.id), Date.parse(p.wallclock));

    const plays = this.sum.plays ?? [];
    this.tl = new PlayTimeline(this.league, plays, finalScore);
    this.origin = this.tl.first - LEAD_MS;

    if (this.nhlPbp && this.tl instanceof PlayTimeline) {
      this.nhlPlayWall = (this.nhlPbp.plays ?? []).map((p: Raw, i: number, all: Raw[]) => this.nhlWall(p, i, all));
      this.nhlGoalWall = (this.nhlScore?.goals ?? []).map((g: Raw) => this.nhlGoalWallClock(g));
    }
  }

  /** Inject an overturned goal: `side` gets +1 from virtual second `atS` for `holdS` seconds, then it disappears. */
  setPhantom(atS: number, side: "home" | "away", holdS: number): void {
    this.phantom = { startW: this.origin + atS * 1000, endW: this.origin + (atS + holdS) * 1000, side };
  }
  private phantomSide(w: number): "home" | "away" | undefined {
    return this.phantom && w >= this.phantom.startW && w < this.phantom.endW ? this.phantom.side : undefined;
  }
  private snapAt(w: number): Snap {
    const s = this.tl.snap(w);
    const side = this.phantomSide(w);
    if (side && s.state === "in") s[side] += 1;
    return s;
  }

  get homeTeamId(): string { return this.homeId; }
  get awayTeamId(): string { return this.awayId; }
  /** ESPN team ids of this game */
  teamIds(): string[] { return [this.homeId, this.awayId]; }
  file(name: string): Raw | undefined { return this.files.get(name); }
  get hasNhl(): boolean { return !!this.nhlPbp; }
  get nhlId(): number | undefined { return this.nhlPbp?.id; }
  /** virtual ms at which the recording ends */
  get endV(): number { return this.tl.end - this.origin; }

  // ---- NHL time mapping: NHL play-by-play has no wall clock, ESPN's has; map (period, time) -> wall via ESPN marks ----
  private nhlMarks(): Mark[] {
    return (this.tl as PlayTimeline).marks;
  }
  private markWall(type: RegExp, period: number): number | undefined {
    return this.nhlMarks().find((k) => k.period === period && type.test(k.type))?.w;
  }
  private nhlWall(p: Raw, idx: number, all: Raw[]): number {
    const per = Number(p.periodDescriptor?.number ?? 1);
    const key: string = p.typeDescKey;
    const marks = this.nhlMarks();
    if (key === "period-start") return this.markWall(/^Period Start$/, per) ?? this.tl.first;
    if (key === "period-end") return this.markWall(/^Period End$/, per) ?? this.tl.end;
    if (key === "game-end") return marks.find((k) => /^End of Game$/.test(k.type))?.w ?? this.tl.end;
    if (key === "shootout-complete") return this.markWall(/^Shootout End$/, per) ?? this.tl.end;
    if (per >= 5) {
      // shootout attempts: pair the k-th NHL goal with ESPN's k-th shootout scoring play, others spread across the SO
      const start = this.markWall(/^Period Start$/, per) ?? this.tl.first;
      const endW = this.markWall(/^Shootout End$/, per) ?? this.tl.end;
      const soMarks = marks.filter((k) => k.period >= 5 && k.scoring);
      if (key === "goal") {
        const nth = all.slice(0, idx).filter((x: Raw) => x.typeDescKey === "goal" && Number(x.periodDescriptor?.number) >= 5).length;
        return soMarks[nth]?.w ?? start + (endW - start) / 2;
      }
      return start + (endW - start) * 0.5;
    }
    return this.wallInPeriod(per, mmss(p.timeInPeriod));
  }
  private wallInPeriod(per: number, el: number): number {
    const ks = this.nhlMarks().flatMap((k) => (k.period === per && k.el !== undefined ? [{ w: k.w, el: k.el }] : []));
    const last = ks[ks.length - 1];
    if (!last) return this.tl.first;
    const j = ks.findIndex((k) => k.el >= el);
    const b = ks[j];
    if (!b) return last.w;
    const a = ks[j - 1];
    if (!a || b.el === el) return b.w;
    const f = (el - a.el) / Math.max(1, b.el - a.el);
    return Math.round(a.w + f * (b.w - a.w));
  }
  private nhlGoalWallClock(g: Raw): number {
    const per = Number(g.period ?? g.periodDescriptor?.number ?? 1);
    if (per >= 5) {
      const soMarks = this.nhlMarks().filter((k) => k.period >= 5 && k.scoring);
      return soMarks[0]?.w ?? this.tl.end;
    }
    return this.wallInPeriod(per, mmss(g.timeInPeriod));
  }

  // ---- ESPN scoreboard event ----------------------------------------------------------------------------------------
  private statusFor(s: Snap): Raw {
    const type = (id: string, name: string, state: string, description: string, detail: string, completed = false) => ({ id, name, state, completed, description, detail, shortDetail: detail });
    if (s.state === "pre") return { clock: 0, displayClock: "0:00", period: 0, type: type("1", "STATUS_SCHEDULED", "pre", "Scheduled", "Scheduled (SIM replay)") };
    const label = s.period === 4 ? "OT" : s.period >= 5 ? "SO" : `${ord(s.period)} Period`;
    if (s.intermission) {
      return { clock: 0, displayClock: "0:00", period: s.period, type: type("22", "STATUS_END_PERIOD", "in", "End of Period", `End of ${label}`) };
    }
    const disp = fmtClock(s.clockS ?? 0);
    if (s.period >= 5) return { clock: 0, displayClock: "0:00", period: s.period, type: type("2", "STATUS_IN_PROGRESS", "in", "In Progress", "Shootout") };
    return { clock: Math.round((s.clockS ?? 0) * 10) / 10, displayClock: disp, period: s.period, type: type("2", "STATUS_IN_PROGRESS", "in", "In Progress", `${disp} - ${label}`) };
  }

  /** ESPN scoreboard event as of virtual time v. `startAtMs` = the (rebased) scheduled start to report. */
  espnEvent(v: number, startAtMs: number): Raw {
    const w = this.origin + v;
    const s = this.snapAt(w);
    const ev = structuredClone(this.ev);
    const comp = ev.competitions[0];
    const iso = new Date(startAtMs).toISOString().slice(0, 16) + "Z";
    ev.date = iso;
    comp.date = iso;
    if (ev.startDate) ev.startDate = iso;
    comp.odds = [{ details: "SIM REPLAY", overUnder: 0 }];
    if (s.state !== "post") {
      const status = this.statusFor(s);
      ev.status = status;
      comp.status = structuredClone(status);
      const ls = this.tl.linescores(w);
      for (const c of comp.competitors) {
        const side = c.homeAway === "home" ? "home" : "away";
        c.score = String(side === "home" ? s.home : s.away);
        c.winner = false;
        c.linescores = ls[side].map((value) => ({ value }));
        if (s.state === "pre") delete c.linescores;
      }
    } else {
      comp.status = structuredClone(ev.status);
    }
    return ev;
  }

  /** ESPN summary as of virtual time v (plays/keyEvents/scoringPlays up to v; boxscore scaled by elapsed time). */
  espnSummary(v: number): Raw {
    const w = this.origin + v;
    const sum = structuredClone(this.sum);
    const s = this.snapAt(w);
    const vis = (p: Raw) => {
      const t = p.wallclock ? Date.parse(p.wallclock) : this.playWall.get(String(p.id));
      return t !== undefined && t <= w;
    };
    if (sum.plays) sum.plays = sum.plays.filter(vis);
    if (sum.scoringPlays) sum.scoringPlays = sum.scoringPlays.filter(vis);
    if (sum.drives) sum.drives.previous = sum.drives.previous.map((d: Raw) => ({ ...d, plays: (d.plays ?? []).filter(vis) })).filter((d: Raw) => d.plays.length);
    if (sum.keyEvents) sum.keyEvents = sum.keyEvents.filter(vis);
    const f = s.state === "post" ? 1 : s.state === "pre" ? 0 : Math.min(1, Math.max(0, (w - this.tl.first) / Math.max(1, this.tl.end - this.tl.first)));
    if (f < 1) scaleBoxscore(sum.boxscore, f);
    const hc = sum.header?.competitions?.[0];
    if (hc && s.state !== "post") {
      hc.status = this.statusFor(s);
      for (const c of hc.competitors ?? []) c.score = String(c.homeAway === "home" ? s.home : s.away);
    }
    return sum;
  }

  // ---- NHL feed -----------------------------------------------------------------------------------------------------
  private nhlClock(s: Snap): Raw {
    if (s.state === "pre") return { timeRemaining: "20:00", secondsRemaining: 1200, running: false, inIntermission: false };
    if (s.intermission) return { timeRemaining: fmtClock2(s.breakLeftS ?? 0), secondsRemaining: Math.round(s.breakLeftS ?? 0), running: false, inIntermission: true };
    return { timeRemaining: fmtClock2(s.clockS ?? 0), secondsRemaining: Math.round(s.clockS ?? 0), running: s.running, inIntermission: false };
  }
  private nhlPeriod(p: number): Raw {
    return { number: p, periodType: p <= 3 ? "REG" : p === 4 ? "OT" : "SO", maxRegulationPeriods: 3 };
  }
  private nhlState(s: Snap): string {
    return s.state === "pre" ? "FUT" : s.state === "in" ? "LIVE" : "FINAL";
  }

  /** the score/now `games[]` entry as of v */
  nhlScoreGame(v: number, startAtMs: number): Raw | undefined {
    if (!this.nhlScore) return undefined;
    const w = this.origin + v;
    const s = this.snapAt(w);
    const g = structuredClone(this.nhlScore);
    g.startTimeUTC = new Date(startAtMs).toISOString().replace(/\.\d+Z$/, "Z");
    g.gameState = this.nhlState(s);
    if (s.state !== "post") {
      g.goals = (g.goals ?? []).filter((_: Raw, i: number) => (this.nhlGoalWall[i] ?? Infinity) <= w);
      const reg = (g.goals as Raw[]).filter((x) => Number(x.period) <= 4);
      g.homeTeam.score = reg.filter((x) => x.teamAbbrev === g.homeTeam.abbrev).length;
      g.awayTeam.score = reg.filter((x) => x.teamAbbrev === g.awayTeam.abbrev).length;
      const ph = this.phantomSide(w);
      if (ph && s.state === "in") (ph === "home" ? g.homeTeam : g.awayTeam).score += 1;
      if (s.state === "pre") {
        delete g.periodDescriptor;
        delete g.period;
      } else {
        g.periodDescriptor = this.nhlPeriod(s.period);
        g.period = s.period;
      }
    }
    g.clock = this.nhlClock(s);
    return g;
  }

  /** gamecenter/<id>/play-by-play as of v */
  nhlPbpAt(v: number, startAtMs: number): Raw | undefined {
    if (!this.nhlPbp) return undefined;
    const w = this.origin + v;
    const s = this.snapAt(w);
    const d = structuredClone(this.nhlPbp);
    d.startTimeUTC = new Date(startAtMs).toISOString().replace(/\.\d+Z$/, "Z");
    d.gameState = this.nhlState(s);
    const all: Raw[] = d.plays;
    d.plays = all.filter((_: Raw, i: number) => (this.nhlPlayWall[i] ?? Infinity) <= w);
    if (s.state !== "post") {
      const homeId = d.homeTeam.id;
      const regGoals = (d.plays as Raw[]).filter((p) => p.typeDescKey === "goal" && Number(p.periodDescriptor?.number) <= 4);
      d.homeTeam.score = regGoals.filter((p) => p.details?.eventOwnerTeamId === homeId).length;
      d.awayTeam.score = regGoals.length - d.homeTeam.score;
      const ph = this.phantomSide(w);
      if (ph && s.state === "in") d[ph === "home" ? "homeTeam" : "awayTeam"].score += 1;
      if (s.state === "pre") delete d.periodDescriptor;
      else d.periodDescriptor = this.nhlPeriod(s.period);
      delete d.gameOutcome;
      delete d.summary;
    }
    d.clock = this.nhlClock(s);
    return d;
  }

  snapshot(v: number): Snap {
    return this.snapAt(this.origin + v);
  }

  /** things worth seeking to */
  markers(): Marker[] {
    const out: Marker[] = [{ kind: "start", label: "pre-game (virtual 0)", v: 0 }];
    const V = (w: number) => w - this.origin;
    out.push({ kind: "start", label: "game start", v: V(this.tl.first) });
    if (this.phantom) out.push({ kind: "goal", label: "phantom goal (will be overturned)", v: this.phantom.startW - this.origin });
    if (this.tl instanceof PlayTimeline) {
      const m = this.tl.marks;
      let n = 0;
      let g = 0;
      for (let i = 0; i < m.length; i++) {
        const cur = m[i];
        const prev = m[i - 1];
        const next = m[i + 1];
        if (!cur) continue;
        if (prev && cur.home + cur.away > prev.home + prev.away) out.push({ kind: "goal", label: `goal ${++g}`, v: V(cur.w) });
        if (next && next.period > cur.period) {
          n++;
          out.push({ kind: "intermission", label: `intermission ${n}`, v: V(cur.w) });
          out.push({ kind: "resume", label: `resume ${n}`, v: V(next.w) });
        }
      }
    }
    out.push({ kind: "final", label: "final", v: V(this.tl.end) });
    return out.sort((a, b) => a.v - b.v);
  }

  /** Does `espnEvent` list this game for a `dates=YYYYMMDD` request? */
  hasDate(ymd: string, todayYmd: string): boolean {
    return ymd === todayYmd || ymd === this.recordedDay;
  }
}

/** Scale count-like boxscore values by the fraction of the game played (percentages and averages are left alone). */
function scaleBoxscore(box: Raw, f: number): void {
  // anchored: "accuratePasses" must scale (it contains "rate"), "possessionPct" / "thirdDownEff" must not
  const keep = /(pct|percent|percentage|eff|avg|average|rate|ratio)$/i;
  const scale = (s: Raw) => {
    if (Array.isArray(s.stats)) return s.stats.forEach(scale);
    if (!s || typeof s.displayValue !== "string" || keep.test(s.name ?? "")) return;
    const dv: string = s.displayValue;
    let out: string | undefined;
    let m: RegExpExecArray | null;
    if ((m = /^(\d+)$/.exec(dv))) out = String(Math.round(Number(m[1]) * f));
    else if ((m = /^(\d+)([-/])(\d+)$/.exec(dv))) out = `${Math.round(Number(m[1]) * f)}${m[2]}${Math.round(Number(m[3]) * f)}`;
    else if ((m = /^(\d+):(\d{2})$/.exec(dv))) out = fmtClock(Number(m[1]) * 60 * f + Number(m[2]) * f);
    if (out !== undefined) {
      s.displayValue = out;
      if (typeof s.value === "number") s.value = Number(out) || s.value;
    }
  };
  for (const t of box?.teams ?? []) (t.statistics ?? []).forEach(scale);
}
