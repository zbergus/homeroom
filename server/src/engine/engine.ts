import { EventEmitter } from "node:events";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { isShootout, leagueById, periodLabel } from "../leagues.js";
import { fetchSummary, type Summary } from "../providers/espn.js";
import { buildInsight } from "../providers/insight.js";
import type { NhlGame } from "../providers/nhl.js";
import { MEDIA_DIR, type Store } from "../store.js";
import type { EventPayload, Game, Insight, Rgb, ScoringPlay, Settings, Team, UiEventType } from "../types.js";
import { DelayBuffer } from "./delay.js";
import { diffGame, type Detected } from "./diff.js";
import { naturalText, scoringLabel } from "./text.js";
import { MANUAL_SPECS } from "./triggers.js";

type Out = { kind: "game"; game: Game } | { kind: "event"; payload: EventPayload };

const NHL_AUTHORITY_MS = 10_000;
const FLAP_WINDOW_MS = 120_000;
const OVERTURN_WINDOW_MS = 5 * 60_000;
const OVERTURN_CONFIRM_MS = 20_000;
const POWERPLAY_REPEAT_MS = 20_000;
/** a restored `shown` snapshot older than this is dropped (the game state it shows would be misleading) */
const SHOWN_MAX_AGE_MS = 10 * 60_000;
const SHOWN_PERSIST_EVERY_MS = 5_000;

/** every event type that has a built payload (goal_overturned is built separately) */
type BuildType = Exclude<UiEventType, "goal_overturned">;
const WHITE: Rgb = { r: 255, g: 255, b: 255 };

export interface EngineEvents {
  event: [EventPayload];
  game: [Game];
}

export class Engine extends EventEmitter<EngineEvents> {
  /** raw, real-time state */
  readonly games = new Map<string, Game>();
  /** what viewers are allowed to see (post delay) */
  readonly shown = new Map<string, Game>();

  private buffer: DelayBuffer<Out>;
  private chains = new Map<string, Promise<void>>();
  private nhlSeen = new Map<string, number>();
  private lastDecrease = new Map<string, { home: number; away: number; at: number }>();
  private settingsCache?: Settings;
  private synced?: Set<string>;
  private favs?: Set<string>;
  private updatedAt = new Map<string, number>();
  private ppLast = new Map<string, number>();
  private goalTimes = new Map<string, { abbr: string; at: number }[]>();
  private overrides = new Map<string, Partial<Team["options"]>>();
  private shownSaved = new Map<string, { at: number; status: string }>();
  private restoredAt = new Map<string, number>();
  private restoreGraceMs: number;

  /** the poller listens here to track provider health (enrichment calls swallow their own errors) */
  providerReport: (id: string, ok: boolean, err?: unknown) => void = () => {};

  private fetchSummary: typeof fetchSummary;
  private buildInsight: (g: Game) => Promise<Insight | undefined>;
  private retryMs: number;

  constructor(
    readonly store: Store,
    private now: () => number = () => Date.now(),
    deps: { fetchSummary?: typeof fetchSummary; buildInsight?: (g: Game) => Promise<Insight | undefined>; retryMs?: number; restoreGraceMs?: number } = {},
  ) {
    super();
    this.fetchSummary = deps.fetchSummary ?? fetchSummary;
    this.buildInsight = deps.buildInsight ?? ((g) => buildInsight(g));
    this.retryMs = deps.retryMs ?? 1500;
    this.restoreGraceMs = deps.restoreGraceMs ?? 10_000;
    this.buffer = new DelayBuffer<Out>((o) => this.release(o), now);
  }

  /** Stop timers without touching persisted state (process shutdown; tests simulate a crash with it). */
  stop(): void {
    this.buffer.clear();
  }

  // ---- config caches -------------------------------------------------------------------------
  get settings(): Settings {
    return (this.settingsCache ??= this.store.getSettings());
  }
  invalidateSettings(): void {
    this.settingsCache = undefined;
  }
  invalidateSync(): void {
    this.synced = undefined;
    this.favs = undefined;
  }
  /** favourites as "league:ABBR" */
  favoriteSet(): Set<string> {
    return (this.favs ??= new Set(this.store.getFavorites().map((f) => `${f.league}:${f.abbr.toUpperCase()}`)));
  }
  invalidateOverrides(): void {
    this.overrides.clear();
  }
  /** A game is synced if the user ticked it, or (auto-sync) it contains a favourite team, unless excluded. */
  isSynced(gameId: string): boolean {
    const s = this.settings;
    if (s.sync_excluded.includes(gameId)) return false;
    if ((this.synced ??= new Set(this.store.getSyncedGames())).has(gameId)) return true;
    if (!s.auto_sync_favorites) return false;
    const g = this.games.get(gameId);
    if (!g) return false;
    const favs = this.favoriteSet();
    return favs.has(`${g.league}:${g.home.abbr}`) || favs.has(`${g.league}:${g.away.abbr}`);
  }
  /** resolves by_game ?? by_league ?? global */
  delayMs(gameId: string): number {
    const s = this.settings;
    const league = gameId.split(":")[0];
    return Math.round((s.delay_by_game[gameId] ?? s.delay_by_league[league] ?? s.delay_global_s) * 1000);
  }

  // ---- ingest --------------------------------------------------------------------------------
  /** Feed a fresh ESPN snapshot of a game. */
  ingestEspn(incoming: Game): void {
    const prev = this.games.get(incoming.id);
    let next = incoming;
    if (prev) {
      next = {
        ...incoming,
        nhl_id: prev.nhl_id,
        // soccer's scoreboard already lists goals with scorers; for other sports they come from enrichment
        goals: incoming.goals.length ? incoming.goals : prev.goals,
        stat_rows: prev.stat_rows,
        insight: prev.insight,
        situation: prev.situation,
        authority: "espn",
      };
      const fresh = prev.authority === "nhl" && this.now() - (this.nhlSeen.get(prev.id) ?? 0) < NHL_AUTHORITY_MS;
      if (fresh) {
        // NHL feed owns the live fields; ESPN only contributes presentation data
        next = {
          ...next,
          status: prev.status,
          period: prev.period,
          period_label: prev.period_label,
          clock: prev.clock,
          clock_s: prev.clock_s,
          clock_running: prev.clock_running,
          clock_dir: prev.clock_dir,
          intermission: prev.intermission,
          home: { ...next.home, score: prev.home.score },
          away: { ...next.away, score: prev.away.score },
          authority: "nhl",
        };
      }
    }
    this.commit(prev, next);
  }

  /** Overlay a (faster) NHL feed snapshot on top of the ESPN-derived game. */
  ingestNhl(gameId: string, n: NhlGame): void {
    const prev = this.games.get(gameId);
    if (!prev) return;
    this.nhlSeen.set(gameId, this.now());
    const league = leagueById(prev.league);
    const abbr = (a: string) => (a === n.homeAbbr ? prev.home.abbr : a === n.awayAbbr ? prev.away.abbr : a);
    const status = n.state === "pre" ? prev.status : n.state;
    const next: Game = {
      ...prev,
      status,
      period: status === "pre" ? 0 : n.period,
      period_label: status === "pre" ? "" : periodLabel(league, n.period),
      clock: status === "in" && !isShootout(league, n.period) ? n.clock : "",
      clock_s: status === "in" && !isShootout(league, n.period) ? n.clockS : undefined,
      clock_running: status === "in" && !isShootout(league, n.period) ? n.clockRunning : false,
      clock_dir: "down",
      intermission: status === "in" && n.inIntermission,
      home: { ...prev.home, score: n.homeScore },
      away: { ...prev.away, score: n.awayScore },
      goals: n.goals.length >= prev.goals.length ? n.goals.map((g) => ({ ...g, team_abbr: abbr(g.team_abbr) })) : prev.goals,
      situation: status === "in" ? (n.situation ?? prev.situation) : undefined,
      authority: "nhl",
      nhl_id: n.id,
    };
    this.commit(prev, next);
  }

  private commit(prev: Game | undefined, incoming: Game): void {
    // work on a copy: callers (and tests) keep their own objects, and later polls must not see our edits
    const next = structuredClone(incoming);
    this.inferClock(prev, next);
    this.updatedAt.set(next.id, this.now());
    this.applyOverrides(next);
    const league = leagueById(next.league);
    let dets = diffGame(prev, next, league.minDelta);
    if (prev) dets = this.suppressFlaps(prev, next, dets);
    if (prev) this.watchOverturn(prev, next);
    this.games.set(next.id, next);
    this.pushOut({ kind: "game", game: next }, this.delayMs(next.id), next.id);
    if (dets.length && this.isSynced(next.id)) this.enqueue(next, dets);
  }

  /** A score drop followed by a return to the old score soon after is almost always a provider flap. */
  private suppressFlaps(prev: Game, next: Game, dets: Detected[]): Detected[] {
    if (next.home.score < prev.home.score || next.away.score < prev.away.score) {
      this.lastDecrease.set(next.id, { home: prev.home.score, away: prev.away.score, at: this.now() });
      return dets;
    }
    const d = this.lastDecrease.get(next.id);
    if (d && this.now() - d.at < FLAP_WINDOW_MS && next.home.score === d.home && next.away.score === d.away) {
      this.lastDecrease.delete(next.id);
      return dets.filter((x) => x.type !== "goal");
    }
    return dets;
  }

  /** seconds since the live fields of this game were last refreshed from a provider */
  rawAgeS(gameId: string): number {
    return Math.max(0, (this.now() - (this.updatedAt.get(gameId) ?? this.now())) / 1000);
  }

  /** ESPN reports a clock value but not whether it is running: running = the value moved since the last poll. */
  private inferClock(prev: Game | undefined, next: Game): void {
    if (next.clock_running !== undefined || next.clock_s === undefined) return;
    next.clock_running = next.status === "in" && !next.intermission && prev?.clock_s !== undefined && Math.abs(next.clock_s - prev.clock_s) > 0.5;
  }

  /**
   * A score drop shortly after we announced a goal for that team may be a review that overturned it.
   * We cannot recall a horn already played, but we can tell the screen and HA automations (UI + REST only;
   * the integration has no handler for it). Confirmed 20 s later so a provider flap that corrects itself stays silent.
   */
  private watchOverturn(prev: Game, next: Game): void {
    if (!this.isSynced(next.id)) return;
    for (const side of ["home", "away"] as const) {
      if (next[side].score >= prev[side].score) continue;
      const abbr = next[side].abbr;
      const recent = (this.goalTimes.get(next.id) ?? []).some((g) => g.abbr === abbr && this.now() - g.at < OVERTURN_WINDOW_MS);
      if (!recent) continue;
      const lowered = next[side].score;
      const detectedAt = this.now();
      setTimeout(() => {
        const cur = this.games.get(next.id);
        if (!cur || cur[side].score > lowered) return; // came back: flap
        const team = cur[side];
        const payload = this.buildOverturned(cur, team);
        const delay = this.delayMs(next.id);
        payload.delay_s = delay / 1000;
        this.pushOut({ kind: "event", payload }, Math.max(0, delay - (this.now() - detectedAt)), next.id);
      }, OVERTURN_CONFIRM_MS).unref();
    }
  }

  private noteGoal(gameId: string, abbr: string): void {
    const list = (this.goalTimes.get(gameId) ?? []).filter((g) => this.now() - g.at < OVERTURN_WINDOW_MS);
    list.push({ abbr, at: this.now() });
    this.goalTimes.set(gameId, list);
  }

  private buildOverturned(game: Game, team: Team): EventPayload {
    const label = scoringLabel(game.sport, 1);
    return {
      event_id: `evt_${randomUUID()}`,
      type: "goal_overturned",
      emitted_at: this.now() / 1000,
      delay_s: 0,
      league: game.league,
      sport: game.sport,
      game,
      team,
      scoring: { label, assists: [], delta: -1, home_score: game.home.score, away_score: game.away.score },
      natural_text: `The ${label.toLowerCase()} for ${team.display_name} was overturned. ${game.home.name} ${game.home.score}, ${game.away.name} ${game.away.score}.`,
    };
  }

  private applyOverrides(g: Game): void {
    for (const t of [g.home, g.away]) {
      const key = `${g.league}:${t.abbr}`;
      let o = this.overrides.get(key);
      if (!o) {
        o = (this.store.getTeamOverride(g.league, t.abbr) ?? {}) as Partial<Team["options"]>;
        this.overrides.set(key, o);
      }
      t.options = { ...t.options, ...o };
    }
  }

  // ---- event building -------------------------------------------------------------------------
  private enqueue(game: Game, dets: Detected[]): void {
    const detectedAt = this.now();
    const prior = this.chains.get(game.id) ?? Promise.resolve();
    const run = prior
      .then(() => this.buildAndPush(game, dets, detectedAt))
      .catch((err) => console.error("[engine] event build failed", err));
    this.chains.set(game.id, run);
  }

  private async buildAndPush(game: Game, dets: Detected[], detectedAt: number): Promise<void> {
    for (const det of dets) {
      if (det.type !== "goal" && !det.volatile) {
        const key = det.key ?? `${game.id}:${det.type}:${det.period ?? ""}`;
        if (!this.store.markEmitted(key)) continue;
      }
      if (det.type === "powerplay") {
        // the same advantage re-reported a moment later (a stoppage re-reads the situation) is not a new power play
        const k = `${game.id}:${det.team?.abbr}`;
        if (this.now() - (this.ppLast.get(k) ?? -Infinity) < POWERPLAY_REPEAT_MS) continue;
        this.ppLast.set(k, this.now());
      }
      let play = det.play;
      if (det.type === "goal" && !play?.scorer) play = (await this.findPlay(game, det)) ?? play;
      if (det.type === "period_end" || det.type === "game_end") this.refreshAfterBreak(game.id);
      // state as of detection (a second goal may already have changed the live score), plus the freshest goal list
      const snapshot: Game = { ...game, goals: this.games.get(game.id)?.goals ?? game.goals };
      const payload = this.buildEvent(det.type as BuildType, snapshot, { team: det.team, delta: det.delta, play, period: det.period, incident: det.incident });
      const delay = this.delayMs(game.id);
      payload.delay_s = delay / 1000;
      if (det.type === "goal" && det.team) this.noteGoal(game.id, det.team.abbr);
      this.pushOut({ kind: "event", payload }, Math.max(0, delay - (this.now() - detectedAt)), game.id);
    }
  }

  buildEvent(
    type: BuildType,
    game: Game,
    o: { team?: Team; delta?: number; play?: ScoringPlay; period?: number; test?: boolean; incident?: { kind: "yellow" | "red"; player?: string; clock: string } } = {},
  ): EventPayload {
    const payload: EventPayload = {
      event_id: `evt_${randomUUID()}`,
      type,
      emitted_at: this.now() / 1000,
      delay_s: 0,
      league: game.league,
      sport: game.sport,
      game,
      natural_text: "",
    };
    if (o.test) payload.test = true;
    if (type === "goal" && o.team) {
      const delta = o.delta ?? 1;
      const label = scoringLabel(game.sport, delta, o.play?.text);
      payload.team = o.team;
      payload.scoring = {
        label,
        scorer: o.play?.scorer,
        assists: o.play?.assists ?? [],
        strength: o.play?.strength,
        delta,
        home_score: game.home.score,
        away_score: game.away.score,
      };
      payload.natural_text = naturalText("goal", { game, team: o.team, label, scorer: o.play?.scorer });
      payload.goal_horn = this.hornUrl(game, o.team);
    } else if (type === "card" && o.incident) {
      payload.team = o.team;
      payload.card = { kind: o.incident.kind, player: o.incident.player, clock: o.incident.clock };
      payload.natural_text = naturalText("card", { game, team: o.team, card: payload.card });
    } else if (type === "powerplay") {
      payload.team = o.team;
      payload.natural_text = naturalText("powerplay", { game, team: o.team });
    } else {
      payload.natural_text = naturalText(type, { game, period: o.period });
      if (type === "game_end") {
        const { home, away } = game;
        payload.winner = home.score === away.score ? "tie" : home.score > away.score ? home.abbr : away.abbr;
      }
    }
    return payload;
  }

  private idsOf(g: Game): Record<string, string> {
    return { [g.home.id]: g.home.abbr, [g.away.id]: g.away.abbr };
  }

  /** Scorer lookup: ESPN summary lags the score by a few seconds, so retry briefly. */
  private async findPlay(game: Game, det: Detected): Promise<ScoringPlay | undefined> {
    for (let i = 0; i < 3; i++) {
      try {
        const summary = await this.fetchSummary(game.id, this.idsOf(game));
        this.providerReport("summary", true);
        const known = new Set((this.games.get(game.id)?.goals ?? []).map((g) => g.key));
        this.applySummary(game.id, summary);
        const fresh = summary.plays.filter((p) => p.team_abbr === det.team?.abbr && !known.has(p.key));
        const hit = fresh[fresh.length - 1];
        if (hit) return hit;
      } catch (err) {
        this.providerReport("summary", false, err);
      }
      await new Promise((r) => setTimeout(r, this.retryMs));
    }
    return undefined;
  }

  /** Refresh scoring plays + boxscore rows from one summary call (best effort). */
  async refreshSummary(gameId: string): Promise<void> {
    const g = this.games.get(gameId);
    if (!g) return;
    try {
      const summary = await this.fetchSummary(gameId, this.idsOf(g));
      this.providerReport("summary", true);
      this.applySummary(gameId, summary);
    } catch (err) {
      this.providerReport("summary", false, err);
    }
  }

  /** The boxscore settles a little after the horn: refresh now, then again shortly after. */
  private refreshAfterBreak(gameId: string): void {
    for (const ms of [0, 15_000, 45_000]) setTimeout(() => void this.refreshSummary(gameId), ms).unref();
  }

  private applySummary(gameId: string, s: Summary): void {
    const g = this.games.get(gameId);
    if (!g) return;
    const goals = s.plays.length >= g.goals.length ? s.plays : g.goals;
    const stat_rows = s.rows.length ? s.rows : g.stat_rows;
    const sameGoals = goals.length === g.goals.length && goals.every((p, i) => p.key === g.goals[i].key && p.scorer === g.goals[i].scorer);
    const sameRows = JSON.stringify(stat_rows) === JSON.stringify(g.stat_rows);
    if (sameGoals && sameRows) return; // nothing new: do not push an identical snapshot to every screen
    this.setGame({ ...g, goals, stat_rows });
  }

  /** Team form and players to watch, for the pre-game / side-panel screens. */
  async refreshInsight(gameId: string): Promise<void> {
    const g = this.games.get(gameId);
    if (!g) return;
    try {
      const insight = await this.buildInsight(g);
      this.providerReport("insight", true);
      const cur = this.games.get(gameId);
      if (insight && cur) this.setGame({ ...cur, insight });
    } catch (err) {
      this.providerReport("insight", false, err);
    }
  }

  /** Replace a game's stored state with an enriched copy and publish it (delayed) to viewers. */
  private setGame(next: Game): void {
    this.games.set(next.id, next);
    this.pushOut({ kind: "game", game: next }, this.delayMs(next.id), next.id);
  }

  // ---- horns ---------------------------------------------------------------------------------
  hornUrl(game: Game, team: Team): string | undefined {
    const s = this.settings;
    const base = s.public_base_url.replace(/\/$/, "");
    if (!base) return undefined;
    const favs = this.store.getFavorites().filter((f) => f.league === game.league).map((f) => f.abbr);
    const gameHasFav = [game.home.abbr, game.away.abbr].some((a) => favs.includes(a));
    if (s.horn_scope === "home" && team.abbr !== game.home.abbr) return undefined;
    if (s.horn_scope === "favorites" && gameHasFav && !favs.includes(team.abbr)) return undefined;
    const dir = path.join(MEDIA_DIR, "horns", game.league);
    for (const name of [team.abbr.toUpperCase(), "default"]) {
      if (fs.existsSync(path.join(dir, `${name}.mp3`))) return `${base}/media/horns/${game.league}/${name}.mp3`;
    }
    return undefined;
  }

  // ---- test goal -----------------------------------------------------------------------------
  /**
   * Fire a synthetic event for a trigger through the real pipeline (TV overlay, lights, horn, TTS).
   * Manual events bypass the automation gates. Default is immediate: a person pressing a button has
   * already seen the play on their screen. `apply_delay` routes it through the stream-sync buffer.
   */
  fireTrigger(opts: { trigger?: string; league?: string; team_abbr?: string; game_id?: string; apply_delay?: boolean } = {}): EventPayload {
    const trigger = opts.trigger ?? "goal";
    const spec = MANUAL_SPECS[trigger];
    if (!spec) throw new Error(`unknown trigger "${trigger}"`);
    const leagueId = opts.league ?? opts.game_id?.split(":")[0] ?? spec.league;
    const league = leagueById(leagueId);
    const abbr = opts.team_abbr?.toUpperCase();
    const known = [...this.games.values()].filter((g) => g.league === league.id);
    let game =
      (opts.game_id ? this.games.get(opts.game_id) : undefined) ??
      known.find((g) => g.home.abbr === abbr || g.away.abbr === abbr) ??
      known.find((g) => g.status === "in") ??
      known[0] ??
      this.syntheticGame(league.id, abbr);
    game = structuredClone(game);
    const side = abbr && game.away.abbr === abbr ? game.away : game.home;
    const other = side === game.home ? game.away : game.home;
    let delta: number | undefined;
    let play: ScoringPlay | undefined;
    if (spec.type === "goal") {
      delta = spec.delta ?? (league.sport === "football" ? 7 : 1);
      side.score += delta;
      play = { key: "test", period: game.period, period_label: game.period_label, clock: game.clock, team_abbr: side.abbr, scorer: "Test Player", assists: [], text: spec.playText, home_score: game.home.score, away_score: game.away.score };
    } else if (spec.type === "game_end" && side.score <= other.score) {
      side.score = other.score + 1; // "win" / game end: make the chosen team the winner
    }
    const incident = spec.card ? { kind: spec.card, player: "Test Player", clock: game.clock || "45'" } : undefined;
    const payload = this.buildEvent(spec.type as BuildType, game, { team: side, delta, play, period: game.period || 1, test: true, incident });
    payload.manual = true;
    payload.trigger = trigger;
    const delay = opts.apply_delay ? this.delayMs(game.id) : 0;
    payload.delay_s = delay / 1000;
    this.pushOut({ kind: "event", payload }, delay, `manual:${game.id}`);
    return payload;
  }

  /** @deprecated kept for the existing /api/test/goal callers */
  fireTest(opts: { league?: string; team_abbr?: string; bypass_delay?: boolean } = {}): EventPayload {
    return this.fireTrigger({ trigger: "goal", league: opts.league, team_abbr: opts.team_abbr, apply_delay: opts.bypass_delay === false });
  }

  private syntheticGame(leagueId: string, abbr = "HOME"): Game {
    const league = leagueById(leagueId);
    const mk = (a: string, n: string, c: Rgb): Team => ({
      id: a, abbr: a, name: n, display_name: n, logo: "", score: 0,
      options: { primary_color_rgb: c, secondary_color_rgb: WHITE, alternate_color_rgb: WHITE },
    });
    return {
      id: `${leagueId}:test`, league: leagueId, sport: league.sport, status: "in", start_time: new Date().toISOString(),
      period: 1, period_label: periodLabel(league, 1), clock: "10:00", intermission: false,
      home: mk(abbr, "Home Team", { r: 200, g: 30, b: 45 }),
      away: mk("AWAY", "Away Team", { r: 20, g: 70, b: 160 }),
      linescores: { home: [], away: [] }, stats: { home: {}, away: {} }, goals: [],
    };
  }

  // ---- delivery ------------------------------------------------------------------------------
  private release(o: Out): void {
    if (o.kind === "game") {
      this.shown.set(o.game.id, o.game);
      this.persistShown(o.game);
      this.emit("game", o.game);
    } else {
      this.dropPending(o.payload.event_id);
      this.emit("event", o.payload);
    }
  }

  // ---- persistence (restart survival) --------------------------------------------------------
  // Only what a viewer could be waiting on is persisted: events still inside the delay window, and the last
  // *released* (post-delay) snapshot of each game. Raw state is never persisted: it is re-read from the providers.

  /** Every buffer push goes through here so queued events are written to SQLite until they are released. */
  private pushOut(o: Out, delayMs: number, key: string): void {
    const at = this.buffer.push(o, delayMs, key);
    if (o.kind === "event" && at > this.now()) {
      try {
        this.store.savePending(o.payload.event_id, o.payload.game.id, at, JSON.stringify(o.payload));
      } catch (err) {
        console.error("[engine] could not persist pending event", (err as Error).message);
      }
    }
  }

  private dropPending(eventId: string): void {
    try {
      this.store.deletePending(eventId);
    } catch {
      /* best effort */
    }
  }

  private persistShown(g: Game): void {
    const t = this.now();
    const last = this.shownSaved.get(g.id);
    // live games release a snapshot every poll: write at most every few seconds, but always on a status change
    if (last && last.status === g.status && t - last.at < SHOWN_PERSIST_EVERY_MS) return;
    this.shownSaved.set(g.id, { at: t, status: g.status });
    try {
      this.store.saveShown(g.id, t, JSON.stringify(g));
    } catch {
      /* best effort */
    }
  }

  /**
   * Call once after the listeners are attached, before the pollers start.
   * - Pending events are re-queued for their ORIGINAL release time. One that is overdue by no more than the grace
   *   (HOMEROOM_RESTORE_GRACE_S, default 10 s) goes out immediately; anything staler is dropped and logged, so a
   *   restart never replays a goal minutes late. Order per game is preserved (the buffer never goes backwards).
   * - `shown` is seeded from the last released snapshot (if recent), so viewers see what they saw before the restart
   *   instead of an empty board for a whole delay window. Raw state is re-seeded by the first poll, silently (no
   *   events fire for anything that happened while down) and reaches viewers after the normal delay.
   */
  restore(): { requeued: number; dropped: number; shown: number } {
    const now = this.now();
    let requeued = 0;
    let dropped = 0;
    let shown = 0;
    for (const r of this.store.listShown()) {
      if (now - r.saved_at > SHOWN_MAX_AGE_MS) {
        this.store.deleteShown(r.game_id);
        continue;
      }
      try {
        const g = JSON.parse(r.json) as Game;
        if (this.shown.has(g.id)) continue;
        this.shown.set(g.id, g);
        this.restoredAt.set(g.id, now);
        shown++;
      } catch {
        this.store.deleteShown(r.game_id);
      }
    }
    for (const r of this.store.listPending()) {
      const overdue = now - r.release_at;
      let payload: EventPayload | undefined;
      try {
        payload = JSON.parse(r.json) as EventPayload;
      } catch {
        /* corrupt row */
      }
      if (!payload || overdue > this.restoreGraceMs) {
        console.warn(`[engine] dropping stale pending event ${r.event_id} (${payload?.type ?? "?"} ${r.game_id}), ${Math.round(overdue / 1000)}s overdue after restart`);
        this.dropPending(r.event_id);
        dropped++;
        continue;
      }
      this.buffer.push({ kind: "event", payload }, Math.max(0, r.release_at - now), r.game_id);
      requeued++;
    }
    return { requeued, dropped, shown };
  }

  /** drop finished games that are > 6 h old so memory stays bounded */
  gc(): void {
    const cutoff = this.now() - 6 * 3600e3;
    for (const [id, g] of this.games) {
      if (g.status === "post" && Date.parse(g.start_time) < cutoff) {
        this.games.delete(id);
        this.shown.delete(id);
        this.nhlSeen.delete(id);
        this.lastDecrease.delete(id);
        this.shownSaved.delete(id);
        this.store.deleteShown(id);
      }
    }
    // restored snapshots of games the providers no longer list
    for (const [id, at] of this.restoredAt) {
      if (!this.games.has(id) && this.now() - at > SHOWN_MAX_AGE_MS) {
        this.shown.delete(id);
        this.restoredAt.delete(id);
        this.store.deleteShown(id);
      } else if (this.games.has(id)) this.restoredAt.delete(id);
    }
  }
}
