import { LEAGUES } from "../leagues.js";
import { fetchScoreboard, fetchScoreboardDay } from "../providers/espn.js";
import { fetchMlbGame, fetchMlbScores, matchMlb } from "../providers/mlb.js";
import { fetchNhlGame, fetchNhlScores, matchNhl, withOfficialStrength } from "../providers/nhl.js";
import type { Game } from "../types.js";
import type { Engine } from "./engine.js";
import { ProviderHealth } from "./health.js";
import { errMsg } from "../security.js";

const WARM_WINDOW_MS = 10 * 60_000;
const WARM_INTERVAL_MS = 30_000;
const MAX_BACKOFF_MS = 60_000;
const SCHEDULE_TTL_MS = 10 * 60_000;
const DEFAULT_REFRESH_MS = 5 * 60_000;
const SUMMARY_INTERVAL_MS = 60_000;
const BACKFILL_RETRY_MS = 30 * 60_000;
const INSIGHT_INTERVAL_MS = 5 * 60_000;
const INSIGHT_LEAD_MS = 3 * 3600_000;
const INSIGHT_STALE_MS = 30 * 60_000;
const INSIGHT_MAX_PER_CYCLE = 12;

const log = (...a: unknown[]) => console.log("[poller]", ...a);

/**
 * Adaptive polling. Per league: live (every poll_live_s) while a relevant game is in progress,
 * warm (30 s) shortly before a relevant start, otherwise idle (poll_idle_s, default 30 min) --
 * but never sleeping past the warm window of the next relevant start.
 * "Relevant" = synced game, or any game in a league shown on the grid.
 */
export class Poller {
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  private failures = new Map<string, number>();
  private stopped = true;
  private scheduleCache = new Map<string, { at: number; games: Game[] }>();
  private gcTimer?: ReturnType<typeof setInterval>;

  /** leagues whose undated ESPN scoreboard is on a different day than the real "today" */
  private lagging = new Set<string>();
  private lastDefault = new Map<string, number>();
  private backfilled = new Map<string, number>();

  /** per-provider success/failure tracking, exposed through /api/status */
  readonly health = new ProviderHealth();

  constructor(
    private engine: Engine,
    private fetchDay: typeof fetchScoreboardDay = fetchScoreboardDay,
    private todayET: () => string = easternToday,
  ) {
    // enrichment calls (summary, insight) live in the engine; it reports their outcome here
    engine.providerReport = (id, ok, err) => (ok ? this.health.success(id) : this.health.failure(id, err));
  }

  /** provider ids a game in progress depends on right now */
  liveProviders(): Set<string> {
    const ids = new Set<string>();
    for (const g of this.engine.games.values()) {
      if (g.status !== "in" || !this.relevant(g)) continue;
      ids.add(`espn:${g.league}`);
      if (g.league === "nhl") ids.add("nhl");
      if (g.league === "mlb") ids.add("mlb");
      if (this.engine.isSynced(g.id)) ids.add("summary");
    }
    return ids;
  }

  providerRows() {
    return this.health.snapshot(this.liveProviders());
  }

  providerWarnings(): string[] {
    return this.health.warnings(this.liveProviders(), (id) =>
      id.startsWith("espn:")
        ? `The ESPN ${id.slice(5).toUpperCase()} feed`
        : id === "nhl"
        ? "The NHL feed"
        : id === "mlb"
        ? "The MLB Stats API feed"
        : id === "summary"
        ? "The ESPN game summary feed"
        : `The ${id} feed`,
    );
  }

  start(): void {
    this.stopped = false;
    for (const l of LEAGUES) this.loop(`espn:${l.id}`, () => this.tickEspn(l.id), () => this.espnInterval(l.id));
    this.loop("nhl", () => this.tickNhl(), () => this.nhlInterval());
    this.loop("mlb", () => this.tickMlb(), () => this.mlbInterval());
    this.loop("summary", () => this.tickSummary(), () => SUMMARY_INTERVAL_MS);
    this.loop("insight", () => this.tickInsight(), () => INSIGHT_INTERVAL_MS);
    this.gcTimer = setInterval(() => {
      this.engine.gc();
      this.engine.store.pruneEmitted();
    }, 30 * 60_000);
  }

  stop(): void {
    this.stopped = true;
    for (const t of this.timers.values()) clearTimeout(t);
    this.timers.clear();
    if (this.gcTimer) clearInterval(this.gcTimer);
  }

  /** wake a league loop now (e.g. after the user syncs a game) */
  poke(): void {
    this.stop();
    this.start();
  }

  private loop(key: string, tick: () => Promise<void>, interval: () => number): void {
    const run = async () => {
      if (this.stopped) return;
      try {
        await tick();
        this.failures.set(key, 0);
      } catch (err) {
        this.failures.set(key, (this.failures.get(key) ?? 0) + 1);
        log(key, "failed:", errMsg(err));
      }
      if (this.stopped) return;
      const base = interval();
      const f = this.failures.get(key) ?? 0;
      const wait = f ? Math.min(base * 2 ** f, Math.max(base, MAX_BACKOFF_MS)) : base;
      this.timers.set(key, setTimeout(run, wait));
    };
    // stagger leagues by a little so a restart doesn't hit ESPN with 9 simultaneous requests
    this.timers.set(key, setTimeout(run, 50 + this.timers.size * 150));
  }

  // ---- relevance -----------------------------------------------------------------------------
  private relevant(g: Game): boolean {
    return this.engine.isSynced(g.id) || this.engine.settings.grid_leagues.includes(g.league);
  }

  /** live | warm | idle, and ms until the next relevant game enters its warm window */
  private leagueState(leagueId: string): { state: "live" | "warm" | "idle"; untilWarmMs: number } {
    const now = Date.now();
    let warm = false;
    let until = Infinity;
    for (const g of this.engine.games.values()) {
      if (g.league !== leagueId || !this.relevant(g)) continue;
      if (g.status === "in") return { state: "live", untilWarmMs: 0 };
      if (g.status === "pre") {
        const d = Date.parse(g.start_time) - now;
        if (d <= WARM_WINDOW_MS && d > -2 * 3600e3) warm = true;
        else if (d > WARM_WINDOW_MS) until = Math.min(until, d - WARM_WINDOW_MS);
      }
    }
    return { state: warm ? "warm" : "idle", untilWarmMs: until };
  }

  private espnInterval(leagueId: string): number {
    const s = this.engine.settings;
    const { state, untilWarmMs } = this.leagueState(leagueId);
    if (state === "live") return Math.round(s.poll_live_s * 1000);
    if (state === "warm") return WARM_INTERVAL_MS;
    return Math.max(WARM_INTERVAL_MS, Math.min(s.poll_idle_s * 1000, untilWarmMs));
  }

  /**
   * ESPN's undated scoreboard keeps showing the previous day for hours after midnight ET, so a game you synced
   * for this afternoon would not exist yet. When the default payload is on another day we ask for today explicitly
   * (every tick) and still re-read the default every 5 minutes so a late game from last night keeps finishing.
   */
  /** One poll pass for a league. Public so tests can drive it without timers. */
  async tickEspn(leagueId: string): Promise<void> {
    if (!this.engine.settings.enabled_leagues.includes(leagueId)) return;
    const now = Date.now();
    const today = this.todayET();
    const needDefault = !this.lagging.has(leagueId) || now - (this.lastDefault.get(leagueId) ?? 0) > DEFAULT_REFRESH_MS;
    if (needDefault) {
      const { games, day } = await this.health.track(`espn:${leagueId}`, () => this.fetchDay(leagueId));
      this.lastDefault.set(leagueId, now);
      for (const g of games) this.engine.ingestEspn(g);
      if (day && day !== today) this.lagging.add(leagueId);
      else this.lagging.delete(leagueId);
    }
    if (this.lagging.has(leagueId)) {
      for (const g of (await this.health.track(`espn:${leagueId}`, () => this.fetchDay(leagueId, today.replace(/-/g, "")))).games) this.engine.ingestEspn(g);
    }
  }

  // ---- NHL fast poller -----------------------------------------------------------------------
  private nhlActive(): boolean {
    if (!this.engine.settings.enabled_leagues.includes("nhl")) return false;
    const now = Date.now();
    for (const g of this.engine.games.values()) {
      if (g.league !== "nhl" || !this.relevant(g)) continue;
      if (g.status === "in") return true;
      if (g.status === "pre" && Date.parse(g.start_time) - now < 3 * 60_000 && Date.parse(g.start_time) - now > -3600e3) return true;
    }
    return false;
  }

  private nhlInterval(): number {
    return this.nhlActive() ? this.engine.settings.nhl_fast_poll_ms : 5_000;
  }

  private async tickNhl(): Promise<void> {
    if (!this.nhlActive()) return;
    const nhl = await this.health.track("nhl", () => fetchNhlScores());
    for (const g of this.engine.games.values()) {
      if (g.league !== "nhl" || !this.relevant(g)) continue;
      if (!g.nhl_id) {
        const m = matchNhl(g, nhl);
        if (m) g.nhl_id = m.id;
      }
      const n = nhl.find((x) => x.id === g.nhl_id);
      if (!n) continue;
      if (g.status === "post" && n.state === "post") continue;
      let feed = n;
      // score/now has no skater situation and can lag the goal list; the play-by-play feed has both.
      // Fetch it for synced live games every tick (it also names scorers), and for any game whose goals lag.
      if (n.state === "in" && (this.engine.isSynced(g.id) || n.goals.length < n.homeScore + n.awayScore)) {
        try {
          const full = await this.health.track("nhl", () => fetchNhlGame(n.id), false);
          feed = { ...n, goals: full.goals.length >= n.goals.length ? withOfficialStrength(full.goals, n.goals) : n.goals, situation: full.situation };
        } catch (err) {
          // the play-by-play feed is the secondary source here: keep the score/now version (health already counted the failure)
          log("nhl", "play-by-play unavailable, using score/now:", errMsg(err));
        }
      }
      this.engine.ingestNhl(g.id, feed);
    }
  }

  // ---- MLB fast poller -----------------------------------------------------------------------
  private mlbActive(): boolean {
    if (!this.engine.settings.enabled_leagues.includes("mlb")) return false;
    const now = Date.now();
    for (const g of this.engine.games.values()) {
      if (g.league !== "mlb" || !this.relevant(g)) continue;
      if (g.status === "in") return true;
      if (g.status === "pre" && Date.parse(g.start_time) - now < 3 * 60_000 && Date.parse(g.start_time) - now > -3600e3) return true;
    }
    return false;
  }

  private mlbInterval(): number {
    return this.mlbActive() ? (this.engine.settings.mlb_fast_poll_ms ?? 2500) : 5_000;
  }

  async tickMlb(): Promise<void> {
    if (!this.mlbActive()) return;
    const mlb = await this.health.track("mlb", () => fetchMlbScores());
    for (const g of this.engine.games.values()) {
      if (g.league !== "mlb" || !this.relevant(g)) continue;
      if (!g.mlb_id) {
        const m = matchMlb(g, mlb);
        if (m) g.mlb_id = m.id;
      }
      const m = mlb.find((x) => x.id === g.mlb_id);
      if (!m) continue;
      if (g.status === "post" && m.state === "post") continue;
      let feed = m;
      // Fetch detailed live feed for synced live games every tick, and for any game whose scoring plays lag
      if (m.state === "in" && (this.engine.isSynced(g.id) || m.goals.length < m.homeScore + m.awayScore)) {
        try {
          const full = await this.health.track("mlb", () => fetchMlbGame(m.id), false);
          feed = { ...m, goals: full.goals.length >= m.goals.length ? full.goals : m.goals, situation: full.situation ?? m.situation };
        } catch (err) {
          log("mlb", "live feed unavailable, using schedule scores:", errMsg(err));
        }
      }
      this.engine.ingestMlb(g.id, feed);
    }
  }

  // ---- break-screen data ---------------------------------------------------------------------
  // Only synced games feed the break screens, so this stays a handful of requests.

  /**
   * Boxscore rows + scoring plays for synced games: every minute while live, and once (then every 30 min)
   * for a finished game that has neither, so its Summary screen is not empty when you open it after the final.
   */
  /** One summary-refresh pass. Public so tests can drive it without timers. */
  async tickSummary(): Promise<void> {
    const now = Date.now();
    for (const g of [...this.engine.games.values()]) {
      if (!this.engine.isSynced(g.id)) continue;
      if (g.status === "in") {
        await this.engine.refreshSummary(g.id);
      } else if (g.status === "post" && (!g.goals.length || !g.stat_rows?.length) && now - (this.backfilled.get(g.id) ?? 0) > BACKFILL_RETRY_MS) {
        this.backfilled.set(g.id, now);
        await this.engine.refreshSummary(g.id);
      }
    }
  }

  /** team form + players to watch, for synced games starting within 3 h or already live */
  /** One insight-refresh pass. Public so tests can drive it without timers. */
  async tickInsight(): Promise<void> {
    const now = Date.now();
    let n = 0;
    for (const g of [...this.engine.games.values()]) {
      if (n >= INSIGHT_MAX_PER_CYCLE) break;
      if (!this.engine.isSynced(g.id) || g.status === "post") continue;
      const soon = g.status === "in" || Date.parse(g.start_time) - now < INSIGHT_LEAD_MS;
      const stale = !g.insight || now - g.insight.updated_at > INSIGHT_STALE_MS;
      if (!soon || !stale) continue;
      n++;
      await this.engine.refreshInsight(g.id);
    }
  }

  // ---- 7-day schedule (calendar) -------------------------------------------------------------
  // ESPN's scoreboard rejects date ranges (HTTP 400), so this is one request per league per day,
  // cached per day and fetched through a small pool to stay polite (7 days x 9 leagues = 63 requests/refresh).
  async getSchedule(days: number): Promise<Game[]> {
    const ymd = (d: Date) => `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
    const dates = Array.from({ length: days }, (_, i) => ymd(new Date(Date.now() + i * 864e5)));
    const jobs = this.engine.settings.enabled_leagues.flatMap((l) => dates.map((d) => ({ l, d })));
    const found = new Map<string, Game>();
    let next = 0;
    const worker = async () => {
      while (next < jobs.length) {
        const job = jobs[next++];
        if (!job) break;
        const { l, d } = job;
        const key = `${l}:${d}`;
        let games = this.scheduleCache.get(key);
        if (!games || Date.now() - games.at >= SCHEDULE_TTL_MS) {
          try {
            games = { at: Date.now(), games: await this.health.track("schedule", () => fetchScoreboard(l, d)) };
            this.scheduleCache.set(key, games);
          } catch (err) {
            log("schedule", key, errMsg(err));
          }
        }
        for (const g of games?.games ?? []) found.set(g.id, g);
      }
    };
    await Promise.all(Array.from({ length: 8 }, worker));
    // prefer live state we already hold (shown = what viewers may see)
    return [...found.values()].map((g) => this.engine.shown.get(g.id) ?? g);
  }
}

/** Today's date in US Eastern ("YYYY-MM-DD"), the timezone ESPN uses to assign games to days. */
export function easternToday(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}
