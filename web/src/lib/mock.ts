import type { EventPayload, FormGame, Game, Insight, PlayerWatch, ScoringPlay, StatRow, Team } from "../types";

interface Seed {
  id: string; league: string; sport: string; status: Game["status"];
  away: [string, string, string, [number, number, number], [number, number, number]];
  home: [string, string, string, [number, number, number], [number, number, number]];
  startInMin: number; period: number; clock: string; as: number; hs: number; intermission?: boolean | undefined;
  rec?: [string | undefined, string];
}

const t = (id: string, [abbr, name, city, p, s]: Seed["home"]): Team => ({
  id, abbr, name, display_name: `${city} ${name}`, score: 0,
  options: {
    primary_color_rgb: { r: p[0], g: p[1], b: p[2] },
    secondary_color_rgb: { r: s[0], g: s[1], b: s[2] },
    alternate_color_rgb: { r: 255, g: 255, b: 255 },
  },
});

const SEEDS: Seed[] = [
  { id: "nhl:m1", league: "nhl", sport: "hockey", status: "in", rec: ["4-3-1", "5-2-1"], away: ["CBJ", "Blue Jackets", "Columbus", [0, 38, 84], [206, 15, 46]], home: ["MIN", "Wild", "Minnesota", [18, 71, 52], [174, 18, 42]], startInMin: -40, period: 2, clock: "08:42", as: 1, hs: 2 },
  { id: "nhl:m2", league: "nhl", sport: "hockey", status: "in", rec: ["6-1-1", "3-4-2"], away: ["BOS", "Bruins", "Boston", [252, 181, 20], [20, 20, 20]], home: ["TOR", "Maple Leafs", "Toronto", [0, 32, 91], [60, 90, 160]], startInMin: -70, period: 3, clock: "01:47", as: 3, hs: 3 },
  { id: "nhl:m3", league: "nhl", sport: "hockey", status: "in", intermission: true, rec: ["5-3-0", "4-3-1"], away: ["EDM", "Oilers", "Edmonton", [4, 30, 66], [252, 76, 0]], home: ["VAN", "Canucks", "Vancouver", [0, 32, 91], [0, 132, 61]], startInMin: -50, period: 2, clock: "00:00", as: 2, hs: 3 },
  { id: "nhl:m5", league: "nhl", sport: "hockey", status: "post", rec: ["3-5-1", "6-2-0"], away: ["SEA", "Kraken", "Seattle", [0, 22, 40], [153, 217, 217]], home: ["NJD", "Devils", "New Jersey", [206, 17, 38], [0, 0, 0]], startInMin: -170, period: 3, clock: "00:00", as: 2, hs: 4 },
  { id: "nfl:m1", league: "nfl", sport: "football", status: "in", rec: ["3-2", "2-3"], away: ["GB", "Packers", "Green Bay", [24, 48, 40], [255, 184, 28]], home: ["CHI", "Bears", "Chicago", [11, 22, 42], [200, 56, 3]], startInMin: -100, period: 3, clock: "07:15", as: 14, hs: 17 },
  { id: "nba:m1", league: "nba", sport: "basketball", status: "in", rec: ["62-20", "53-29"], away: ["LAL", "Lakers", "Los Angeles", [85, 37, 130], [253, 185, 39]], home: ["BOS", "Celtics", "Boston", [0, 122, 51], [20, 20, 20]], startInMin: -60, period: 4, clock: "03:21", as: 98, hs: 101 },
  { id: "mlb:m1", league: "mlb", sport: "baseball", status: "in", rec: ["88-74", "78-84"], away: ["NYY", "Yankees", "New York", [12, 35, 64], [200, 200, 210]], home: ["BOS", "Red Sox", "Boston", [189, 48, 57], [12, 35, 64]], startInMin: -120, period: 6, clock: "Top", as: 2, hs: 1 },
  { id: "epl:m1", league: "epl", sport: "soccer", status: "in", away: ["ARS", "Arsenal", "London", [239, 1, 7], [255, 255, 255]], home: ["MCI", "City", "Man", [108, 171, 221], [28, 44, 91]], startInMin: -55, period: 2, clock: "67'", as: 1, hs: 1 },
  { id: "nhl:m4", league: "nhl", sport: "hockey", status: "pre", rec: ["5-2-1", "4-3-2"], away: ["COL", "Avalanche", "Colorado", [111, 38, 61], [35, 97, 146]], home: ["DAL", "Stars", "Dallas", [0, 104, 71], [143, 143, 140]], startInMin: 40, period: 0, clock: "20:00", as: 0, hs: 0 },
  { id: "nba:m2", league: "nba", sport: "basketball", status: "pre", rec: ["44-38", "51-31"], away: ["MIA", "Heat", "Miami", [152, 0, 46], [249, 160, 27]], home: ["NYK", "Knicks", "New York", [0, 107, 182], [245, 132, 38]], startInMin: 95, period: 0, clock: "12:00", as: 0, hs: 0 },
  { id: "nhl:m6", league: "nhl", sport: "hockey", status: "pre", away: ["PIT", "Penguins", "Pittsburgh", [252, 181, 20], [0, 0, 0]], home: ["PHI", "Flyers", "Philadelphia", [247, 73, 2], [0, 0, 0]], startInMin: 150, period: 0, clock: "20:00", as: 0, hs: 0 },
  { id: "mlb:m2", league: "mlb", sport: "baseball", status: "pre", away: ["LAD", "Dodgers", "Los Angeles", [0, 90, 156], [239, 62, 66]], home: ["SF", "Giants", "San Francisco", [253, 90, 30], [39, 37, 31]], startInMin: 200, period: 0, clock: "", as: 0, hs: 0 },
  { id: "epl:m2", league: "epl", sport: "soccer", status: "pre", away: ["LIV", "Liverpool", "Liverpool", [200, 16, 46], [0, 178, 169]], home: ["CHE", "Chelsea", "Chelsea", [3, 70, 148], [209, 211, 212]], startInMin: 300, period: 0, clock: "", as: 0, hs: 0 },
  { id: "nfl:m2", league: "nfl", sport: "football", status: "post", away: ["DAL", "Cowboys", "Dallas", [0, 53, 148], [134, 147, 151]], home: ["PHI", "Eagles", "Philadelphia", [0, 76, 84], [165, 172, 175]], startInMin: -240, period: 4, clock: "00:00", as: 24, hs: 27 },
];

/** Element `i` of a constant list, wrapping around, so the demo data never indexes out of range. */
const pick = <T,>(list: readonly T[], i: number): T => list[((i % list.length) + list.length) % list.length] as T;

const PERIOD_LABEL: Record<string, (n: number, clock: string) => string> = {
  hockey: (n) => (n <= 3 ? `${["", "1st", "2nd", "3rd"][n]} period` : "OT"),
  football: (n) => `${["", "1st", "2nd", "3rd", "4th"][n] ?? "OT"} quarter`,
  basketball: (n) => `${["", "1st", "2nd", "3rd", "4th"][n] ?? "OT"} quarter`,
  baseball: (n) => `${n}th inning`,
  soccer: (n) => (n === 1 ? "1st half" : "2nd half"),
};

const periodLabel = (sport: string, n: number, clock: string): string => (PERIOD_LABEL[sport] ?? ((k: number) => `period ${k}`))(n, clock);

const LABEL: Record<string, string> = { hockey: "GOAL", soccer: "GOAL", basketball: "BASKET", baseball: "RUN", football: "TOUCHDOWN" };
const DELTA: Record<string, () => number> = {
  hockey: () => 1, soccer: () => 1, baseball: () => 1,
  basketball: () => (Math.random() < 0.7 ? 2 : 3),
  football: () => (Math.random() < 0.6 ? 7 : 3),
};
const deltaFor = (sport: string): number => (DELTA[sport] ?? (() => 1))();
const POSITIONS = ["C", "RW", "LW", "D"];
const SCORERS = ["A. Moreau", "S. Okafor", "J. Lindqvist", "D. Reyes", "M. Tanaka", "K. Abbott", "R. Novak", "T. Greene"];

const pad = (n: number) => String(n).padStart(2, "0");


/* ---------- deterministic fake context data ---------- */
const rng = (seed: string) => {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) { h = Math.imul(h ^ seed.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); }
  let a = h >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let x = a; x = Math.imul(x ^ (x >>> 15), x | 1); x ^= x + Math.imul(x ^ (x >>> 7), x | 61); return ((x ^ (x >>> 14)) >>> 0) / 4294967296; };
};
const OPPS = ["RIV", "COL", "NOR", "BAY", "PIN", "SEA", "VGK", "CGY", "LAK", "ANA"];
const FIRST = ["Alex", "Sam", "Jordan", "Rae", "Luis", "Mika", "Dmitri", "Noah"];
const LAST = ["Moreau", "Okafor", "Vale", "Chen", "Duarte", "Lindqvist", "Reyes", "Tanaka"];

function mkGames(abbr: string, n: number): FormGame[] {
  const r = rng(`form:${abbr}`);
  return Array.from({ length: n }, (_, i) => {
    const roll = r();
    const result: FormGame["result"] = roll < 0.55 ? "W" : roll < 0.8 ? "L" : "OTL";
    const lo = Math.floor(r() * 3), win = lo + 1 + Math.floor(r() * 2);
    const gf = result === "W" ? win : result === "OTL" ? lo + 1 : lo;
    const ga = result === "W" ? lo : result === "OTL" ? lo + 2 : lo + 1 + Math.floor(r() * 2);
    const d = new Date(Date.now() - (n - i) * 2 * 86400_000);
    return { opp_abbr: pick(OPPS, i + abbr.length), venue: r() < 0.5 ? "H" : "A", gf: result === "OTL" ? ga - 1 : gf, ga, result, date: d.toISOString() };
  });
}
const recOf = (g: FormGame[]) => `${g.filter((x) => x.result === "W").length}-${g.filter((x) => x.result === "L").length}-${g.filter((x) => x.result === "OTL").length}`;
const avg = (g: FormGame[], k: "gf" | "ga") => g.reduce((a, x) => a + x[k], 0) / Math.max(1, g.length);

function mkPlayer(abbr: string, side: number): PlayerWatch {
  const r = rng(`pl:${abbr}`);
  const first = pick(FIRST, Math.floor(r() * FIRST.length)), last = pick(LAST, Math.floor(r() * LAST.length) + side);
  const log = Array.from({ length: 5 }, (_, i) => ({ opp_abbr: `${i % 2 ? "@" : ""}${pick(OPPS, i * 3 + side)}`, value: Math.floor(r() * 4) }));
  const g = Math.floor(r() * 6) + 2, a = Math.floor(r() * 6) + 1;
  return {
    id: `${abbr}-p`, name: `${first} ${last}`, first, last, jersey: String(Math.floor(r() * 80) + 2), position: pick(POSITIONS, Math.floor(r() * 3)), team_abbr: abbr,
    tiles: [{ label: "Goals", value: String(g) }, { label: "Assists", value: String(a) }, { label: "Points", value: String(g + a) }, { label: "Shots", value: String(g * 4 + 3) }],
    log, log_label: "Points per game",
  };
}

const row = (key: string, label: string, away: string, home: string, an: number, hn: number, lower?: boolean): StatRow =>
  ({ key, label, away, home, away_n: an, home_n: hn, ...(lower ? { lower_is_better: true } : {}) });

function mkInsight(s: Seed): Insight {
  const r = rng(`ins:${s.id}`);
  const ga = mkGames(s.away[0], 10), gh = mkGames(s.home[0], 10);
  const f1 = (n: number) => n.toFixed(1);
  const pct = (n: number) => `${n.toFixed(1)}%`;
  const [sfa, sfh, saa, sah] = [28 + r() * 6, 28 + r() * 6, 27 + r() * 6, 27 + r() * 6];
  const [svA, svH, foA, foH] = [89 + r() * 3, 89 + r() * 3, 47 + r() * 6, 47 + r() * 6];
  return {
    updated_at: Date.now(),
    form: {
      away: { record: recOf(ga), games: ga }, home: { record: recOf(gh), games: gh },
      rows: [
        row("gf", "Goals for / g", f1(avg(ga, "gf")), f1(avg(gh, "gf")), avg(ga, "gf"), avg(gh, "gf")),
        row("ga", "Goals against / g", f1(avg(ga, "ga")), f1(avg(gh, "ga")), avg(ga, "ga"), avg(gh, "ga"), true),
        row("sf", "Shots for / g", f1(sfa), f1(sfh), sfa, sfh),
        row("sa", "Shots against / g", f1(saa), f1(sah), saa, sah, true),
        row("sv", "Save %", pct(svA), pct(svH), svA, svH),
        row("fo", "Faceoff %", pct(foA), pct(foH), foA, foH),
      ],
    },
    players: { away: mkPlayer(s.away[0], 0), home: mkPlayer(s.home[0], 1) },
  };
}

function mkStatRows(s: Seed): StatRow[] | undefined {
  if (s.sport === "hockey") {
    const sa = 14 + s.as * 3, sh = 17 + s.hs * 2;
    return [
      row("shots", "Shots", String(sa), String(sh), sa, sh), row("hits", "Hits", "11", "15", 11, 15),
      row("fo", "Faceoffs %", "52%", "48%", 52, 48), row("pp", "Power play", "1/3", "0/2", 1 / 3, 0),
      row("tk", "Takeaways", "6", "4", 6, 4), row("gv", "Giveaways", "3", "7", 3, 7, true), row("pim", "Penalty minutes", "4", "6", 4, 6, true),
    ];
  }
  if (s.sport === "basketball") return [row("fg", "Field goal %", "46.6%", "49.2%", 46.6, 49.2), row("reb", "Rebounds", "38", "44", 38, 44), row("ast", "Assists", "21", "26", 21, 26)];
  if (s.sport === "soccer") return [row("sh", "Shots", "9", "6", 9, 6), row("pos", "Possession", "46%", "54%", 46, 54)];
  return undefined; // football: no rows at all; baseball: legacy `stats` map only
}

function build(s: Seed): Game {
  const away = t(`${s.id}-a`, s.away);
  const home = t(`${s.id}-h`, s.home);
  away.score = s.as; home.score = s.hs;
  away.record = s.rec?.[0]; home.record = s.rec?.[1];
  const label = periodLabel(s.sport, s.period, s.clock);
  const g: Game = {
    id: s.id, league: s.league, sport: s.sport, status: s.status,
    start_time: new Date(Date.now() + s.startInMin * 60_000).toISOString(),
    period: s.period, period_label: s.status === "pre" ? "" : label,
    clock: s.clock, intermission: !!s.intermission, away, home,
    linescores: { home: [], away: [] },
    stats: { home: {}, away: {} }, goals: [],
  };
  const clockSecs = (c: string) => { const [m = NaN, sec = NaN] = c.split(":").map(Number); return Number.isFinite(m) && Number.isFinite(sec) ? m * 60 + sec : undefined; };
  if (s.sport === "soccer" && s.status === "in") { g.clock_s = 67 * 60 + 12; g.clock_dir = "up"; g.clock_running = true; }
  else if (s.sport !== "baseball") { g.clock_s = clockSecs(s.clock); g.clock_dir = "down"; g.clock_running = s.status === "in" && !s.intermission; }
  if (s.sport === "hockey") g.insight = mkInsight(s);
  if (s.status !== "pre") g.stat_rows = mkStatRows(s);
  if (s.status !== "pre") {
    const periods = s.sport === "hockey" ? 3 : s.sport === "baseball" ? 9 : s.sport === "soccer" ? 2 : 4;
    const upto = s.status === "post" ? periods : s.period;
    const split = (total: number) => {
      const a = new Array(upto).fill(0);
      let left = total, i = 0;
      while (left > 0) { const d = Math.min(left, s.sport === "hockey" || s.sport === "baseball" ? 1 : 7); a[i % upto] += d; left -= d; i++; }
      return a;
    };
    g.linescores = { away: split(s.as), home: split(s.hs) };
    if (s.sport === "baseball") g.stats = { away: { H: 7, R: s.as, E: 0 }, home: { H: 5, R: s.hs, E: 1 } }; // legacy map: exercises the fallback
    // synthesize goal history matching the score (hockey/soccer: 1 each, others: lumps)
    let ha = 0, aa = 0, i = 0;
    const plays: ScoringPlay[] = [];
    const seq: ("a" | "h")[] = [];
    const units = (n: number) => (s.sport === "hockey" || s.sport === "soccer" || s.sport === "baseball" ? n : Math.ceil(n / 7));
    for (let k = 0; k < units(s.as); k++) seq.push("a");
    for (let k = 0; k < units(s.hs); k++) seq.push("h");
    seq.sort(() => Math.random() - 0.5);
    for (const side of seq) {
      const per = Math.min(upto, 1 + Math.floor((i * upto) / Math.max(1, seq.length)));
      const unit = s.sport === "hockey" || s.sport === "soccer" || s.sport === "baseball" ? 1 : 7;
      if (side === "a") aa = Math.min(s.as, aa + unit); else ha = Math.min(s.hs, ha + unit);
      plays.push({
        period: per, period_label: periodLabel(s.sport, per, ""), clock: `${pad(2 + ((i * 7) % 16))}:${pad((i * 13) % 60)}`,
        team_abbr: side === "a" ? s.away[0] : s.home[0], scorer: pick(SCORERS, i * 3),
        assists: i % 2 ? [pick(SCORERS, i + 1)] : [pick(SCORERS, i + 2), pick(SCORERS, i + 4)],
        strength: i === 1 ? "pp" : i === 4 ? "en" : "ev", home_score: ha, away_score: aa,
      });
      i++;
    }
    g.goals = plays;
  }
  return g;
}

type MockSink = {
  snapshot: (g: Game[]) => void;
  game: (g: Game) => void;
  event: (e: EventPayload) => void;
};

/** Starts the fake feed. Returns a stop function. */
export function startMock(sink: MockSink, intervalMs = 15000): () => void {
  const games = SEEDS.map(build);
  sink.snapshot(structuredClone(games));
  let n = 0;
  const emit = (g: Game) => sink.game(structuredClone(g));

  const tick = setInterval(() => {
    for (const g of games) {
      if (g.status === "pre") {
        if (Date.parse(g.start_time as string) <= Date.now()) {
          g.status = "in"; g.period = 1; g.period_label = periodLabel(g.sport, 1, ""); emit(g);
          sink.event(mkEvent(g, "game_start", ++n));
        }
        continue;
      }
      if (g.status !== "in" || g.intermission) continue;
      if (g.sport === "soccer" && g.clock_s !== undefined) { g.clock_s += 1; continue; }
      if (g.sport === "hockey" || g.sport === "basketball" || g.sport === "football") {
        const [m = 0, s = 0] = g.clock.split(":").map(Number);
        let tot = m * 60 + s - 1;
        if (tot < 0) tot = 20 * 60;
        g.clock = `${pad(Math.floor(tot / 60))}:${pad(tot % 60)}`;
        g.clock_s = tot;
        // push every 3 s so the client-side interpolation is visible
        if (++n % 3 === 0) emit(g);
      }
    }
  }, 1000);

  const goal = setInterval(() => {
    const live = games.filter((g) => g.status === "in" && !g.intermission);
    if (!live.length) return;
    const g = live[Math.floor(Math.random() * live.length)];
    if (!g) return;
    const home = Math.random() < 0.5;
    const team = home ? g.home : g.away;
    const delta = deltaFor(g.sport);
    team.score = (team.score ?? 0) + delta;
    const scorer = pick(SCORERS, Math.floor(Math.random() * SCORERS.length));
    const play: ScoringPlay = {
      period: g.period, period_label: g.period_label, clock: g.clock, team_abbr: team.abbr, scorer,
      assists: [pick(SCORERS, Math.floor(Math.random() * SCORERS.length))], strength: "ev",
      home_score: g.home.score ?? 0, away_score: g.away.score ?? 0,
    };
    g.goals.push(play);
    emit(g);
    const ev = mkEvent(g, "goal", ++n);
    ev.team = structuredClone(team);
    let label = LABEL[g.sport] ?? "GOAL";
    if (g.sport === "football") label = delta === 3 ? "FIELD GOAL" : "TOUCHDOWN";
    ev.scoring = { label, scorer, assists: play.assists, strength: "ev", delta, home_score: play.home_score, away_score: play.away_score };
    ev.natural_text = `${label}, ${team.display_name}! ${scorer} scores.`;
    sink.event(ev);
  }, intervalMs);

  // first goal shortly after load so screenshots/dev see an overlay quickly
  const first = setTimeout(() => {
    const g = games[0];
    if (!g) return;
    g.home.score = (g.home.score ?? 0) + 1;
    const play: ScoringPlay = { period: g.period, period_label: g.period_label, clock: g.clock, team_abbr: g.home.abbr, scorer: "D. Yurov", assists: ["Y. Trenin"], strength: "ev", home_score: g.home.score, away_score: g.away.score ?? 0 };
    g.goals.push(play);
    emit(g);
    const ev = mkEvent(g, "goal", ++n);
    ev.team = structuredClone(g.home);
    ev.scoring = { label: "GOAL", scorer: "D. Yurov", assists: ["Y. Trenin"], strength: "ev", delta: 1, home_score: play.home_score, away_score: play.away_score };
    sink.event(ev);
  }, 4000);

  // fake VAR: take the first goal back ~10 s after it was scored
  const overturn = setTimeout(() => {
    const g = games[0];
    if (!g) return;
    const gone = g.goals.pop();
    if (!gone) return;
    g.home.score = Math.max(0, (g.home.score ?? 0) - 1);
    emit(g);
    const ev = mkEvent(g, "goal_overturned", ++n);
    ev.team = structuredClone(g.home);
    ev.scoring = { label: "GOAL", scorer: gone.scorer, delta: -1, home_score: g.home.score, away_score: g.away.score ?? 0 };
    sink.event(ev);
  }, 12000);

  return () => { clearInterval(tick); clearInterval(goal); clearTimeout(first); clearTimeout(overturn); };
}

function mkEvent(g: Game, type: EventPayload["type"], n: number): EventPayload {
  return {
    event_id: `evt_mock_${n}_${Date.now()}`, type, emitted_at: Date.now() / 1000, delay_s: 0,
    league: g.league, sport: g.sport,
    game: { id: g.id, status: g.status, period: g.period, period_label: g.period_label, clock: g.clock, home: structuredClone(g.home), away: structuredClone(g.away) },
  };
}

export const MOCK_SETTINGS = {
  delay_global_s: 12.5, delay_by_game: {}, public_base_url: "http://192.168.1.10:8080",
  ha: { url: "", token: "", fire_rest_events: false },
};

export function mockSchedule() {
  const days: { date: string; games: Game[] }[] = [];
  const base = SEEDS.map(build);
  for (let d = 0; d < 7; d++) {
    const dt = new Date(); dt.setDate(dt.getDate() + d);
    const date = `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
    const games = d === 0 ? base : base.filter((_, i) => (i + d) % 3 !== 0).map((g, i) => ({
      ...structuredClone(g), id: `${g.id}-d${d}`, status: "pre" as const,
      start_time: new Date(new Date(dt).setHours(17 + (i % 4), (i % 2) * 30, 0, 0)).toISOString(),
      home: { ...g.home, score: 0 }, away: { ...g.away, score: 0 },
    }));
    days.push({ date, games });
  }
  return { days };
}
