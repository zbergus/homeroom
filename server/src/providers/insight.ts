import { leagueById } from "../leagues.js";
import type { FormGame, Game, Insight, LeaderRef, PlayerWatch, StatRow, TeamForm } from "../types.js";
import { espnJson } from "./espn.js";
import { optStr, type Raw, str, strArr } from "./raw.js";


// ---- team form (recent results) -------------------------------------------------------------------

/** Last `max` completed games from ESPN's team schedule, oldest first. */
export function parseSchedule(json: Raw, teamId: string, sport: string, max = 10): FormGame[] {
  const games: FormGame[] = [];
  for (const ev of json?.events ?? []) {
    const comp = ev.competitions?.[0];
    if (!comp?.status?.type?.completed) continue;
    const me = comp.competitors?.find((c: Raw) => String(c.team?.id) === String(teamId));
    const opp = comp.competitors?.find((c: Raw) => c !== me);
    const gf = Number(me?.score?.value ?? me?.score?.displayValue), ga = Number(opp?.score?.value ?? opp?.score?.displayValue);
    if (!me || !opp || !Number.isFinite(gf) || !Number.isFinite(ga)) continue;
    const overtime = /\b(OT|SO)\b/i.test(comp.status.type.detail ?? "");
    games.push({
      opp_abbr: String(opp.team?.abbreviation ?? "").toUpperCase(),
      opp_logo: optStr(opp.team?.logos?.find((l: Raw) => l.rel?.includes("default"))?.href ?? opp.team?.logos?.[0]?.href),
      venue: me.homeAway === "home" ? "H" : "A",
      gf,
      ga,
      result: gf === ga ? "T" : me.winner || gf > ga ? "W" : sport === "hockey" && overtime ? "OTL" : "L",
      date: String(ev.date ?? ""),
    });
  }
  games.sort((a, b) => a.date.localeCompare(b.date));
  return games.slice(-max);
}

/** "W-L-OTL" style summary of the games we have, e.g. "3-1-1" for the last five. */
export function formSummary(games: FormGame[], sport: string): string {
  const n = (r: FormGame["result"]) => games.filter((g) => g.result === r).length;
  return sport === "hockey" ? `${n("W")}-${n("L")}-${n("OTL")}` : n("T") ? `${n("W")}-${n("L")}-${n("T")}` : `${n("W")}-${n("L")}`;
}

type Stat = { value: number; perGame?: number | undefined };
/** name -> value for every stat in ESPN's team statistics (all categories). */
export function parseTeamStats(json: Raw): Map<string, Stat> {
  const m = new Map<string, Stat>();
  for (const cat of json?.results?.stats?.categories ?? []) {
    for (const s of cat.stats ?? []) if (typeof s.value === "number") m.set(s.name, { value: s.value, perGame: typeof s.perGameValue === "number" ? s.perGameValue : undefined });
  }
  return m;
}

const NOUN: Record<string, string> = { hockey: "Goals" };
const f1 = (n: number) => n.toFixed(1);

/** Mirrored comparison rows for the "recent form" screen. Hockey uses season team stats; every sport gets last-5 scoring. */
export function buildFormRows(sport: string, home: { games: FormGame[]; stats?: Map<string, Stat> | undefined }, away: { games: FormGame[]; stats?: Map<string, Stat> | undefined }): StatRow[] {
  const rows: StatRow[] = [];
  const add = (key: string, label: string, h: number | undefined, a: number | undefined, fmt: (n: number) => string, lower = false) => {
    if (h === undefined || a === undefined || !Number.isFinite(h) || !Number.isFinite(a)) return;
    rows.push({ key, label, home: fmt(h), away: fmt(a), home_n: h, away_n: a, ...(lower ? { lower_is_better: true } : {}) });
  };
  const pg = (st: Map<string, Stat> | undefined, name: string): number | undefined => {
    const s = st?.get(name);
    if (!s) return undefined;
    if (s.perGame !== undefined) return s.perGame;
    const gp = st?.get("games")?.value;
    return gp ? s.value / gp : undefined;
  };
  if (sport === "hockey" && home.stats?.size && away.stats?.size) {
    add("gf", "Goals for / game", pg(home.stats, "goals"), pg(away.stats, "goals"), f1);
    add("ga", "Goals against / game", pg(home.stats, "goalsAgainst"), pg(away.stats, "goalsAgainst"), f1, true);
    add("sf", "Shots for / game", pg(home.stats, "shotsTotal"), pg(away.stats, "shotsTotal"), f1);
    add("sa", "Shots against / game", pg(home.stats, "shotsAgainst"), pg(away.stats, "shotsAgainst"), f1, true);
    add("sv", "Save %", home.stats.get("savePct")?.value, away.stats.get("savePct")?.value, (n) => n.toFixed(3).replace(/^0/, ""));
    add("fo", "Faceoff %", home.stats.get("faceoffPercent")?.value, away.stats.get("faceoffPercent")?.value, (n) => `${n.toFixed(1)}%`);
  }
  if (!rows.length && home.games.length && away.games.length) {
    const last = (g: FormGame[]) => g.slice(-5);
    const avg = (g: FormGame[], k: "gf" | "ga") => (last(g).length ? last(g).reduce((s, x) => s + x[k], 0) / last(g).length : undefined);
    const noun = NOUN[sport] ?? "Points";
    add("gf", `${noun} for / game (last 5)`, avg(home.games, "gf"), avg(away.games, "gf"), f1);
    add("ga", `${noun} against / game (last 5)`, avg(home.games, "ga"), avg(away.games, "ga"), f1, true);
  }
  return rows;
}

// ---- players to watch -----------------------------------------------------------------------------

const HOCKEY_TILES: [string, string][] = [["GOALS", "goals"], ["ASSISTS", "assists"], ["POINTS", "points"], ["SHOTS", "shotsTotal"]];

/** Season tiles + points-per-game chart for a hockey skater from ESPN's athlete game log. */
export function buildPlayerWatch(leader: LeaderRef, gamelog: Raw, teamAbbr: string): PlayerWatch | undefined {
  const names = strArr(gamelog?.names);
  const idx = (n: string) => names.indexOf(n);
  const totalsRaw = gamelog?.seasonTypes?.[0]?.summary?.stats?.[0]?.stats;
  const totals = Array.isArray(totalsRaw) ? totalsRaw.map((t) => str(t)) : undefined;
  if (!names.length || !totals) return undefined;
  const tiles = HOCKEY_TILES.flatMap(([label, name]) => (idx(name) >= 0 && totals[idx(name)] !== undefined ? [{ label, value: String(totals[idx(name)]) }] : []));
  if (!tiles.length) return undefined;
  const entries: { date: string; opp: string; pts: number }[] = [];
  for (const cat of gamelog.seasonTypes?.[0]?.categories ?? []) {
    for (const e of cat.events ?? []) {
      const meta = gamelog.events?.[e.eventId];
      const pts = Number(e.stats?.[idx("points")]);
      if (!meta || !Number.isFinite(pts)) continue;
      entries.push({ date: String(meta.gameDate ?? ""), opp: `${meta.atVs === "@" ? "@" : ""}${String(meta.opponent?.abbreviation ?? "").toUpperCase()}`, pts });
    }
  }
  entries.sort((a, b) => a.date.localeCompare(b.date));
  return {
    id: leader.id,
    name: leader.name,
    first: leader.first,
    last: leader.last,
    jersey: leader.jersey,
    position: leader.position,
    headshot: leader.headshot,
    team_abbr: teamAbbr,
    tiles,
    log: entries.slice(-5).map((e) => ({ opp_abbr: e.opp, value: e.pts })),
    log_label: "Points per game",
  };
}

// ---- orchestration --------------------------------------------------------------------------------

interface InsightDeps {
  teamSchedule: (league: string, teamId: string) => Promise<Raw>;
  teamStats: (league: string, teamId: string) => Promise<Raw>;
  gamelog: (league: string, athleteId: string) => Promise<Raw>;
  now?: () => number;
}

const TTL_MS = 6 * 3600_000;
const cache = new Map<string, { at: number; value: unknown }>();
async function cached<T>(key: string, now: number, load: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && now - hit.at < TTL_MS) return hit.value as T;
  const value = await load();
  cache.set(key, { at: now, value });
  return value;
}
export const clearInsightCache = () => cache.clear();

/**
 * Break-screen context for a game. Each part is independent: if one feed fails or has nothing, that part is
 * omitted and the TV simply skips the screen that needed it.
 */
export async function buildInsight(game: Game, deps: InsightDeps = espnJson): Promise<Insight | undefined> {
  const now = (deps.now ?? Date.now)();
  const sport = leagueById(game.league).sport;
  const out: Insight = { updated_at: now };

  const team = async (t: Game["home"]) => {
    const [sched, stats] = await Promise.all([
      cached(`sched:${game.league}:${t.id}`, now, () => deps.teamSchedule(game.league, t.id)).catch(() => undefined),
      sport === "hockey" ? cached(`stats:${game.league}:${t.id}`, now, () => deps.teamStats(game.league, t.id)).catch(() => undefined) : Promise.resolve(undefined),
    ]);
    const games = sched ? parseSchedule(sched, t.id, sport) : [];
    return { games, stats: stats ? parseTeamStats(stats) : undefined };
  };
  const [h, a] = await Promise.all([team(game.home), team(game.away)]);
  if (h.games.length || a.games.length) {
    const rows = buildFormRows(sport, h, a);
    out.form = {
      home: { record: game.home.record, games: h.games },
      away: { record: game.away.record, games: a.games },
      rows,
    } satisfies { home: TeamForm; away: TeamForm; rows: StatRow[] };
  }

  if (sport === "hockey" && game.leaders) {
    const watch = async (l: LeaderRef | undefined, abbr: string) => {
      if (!l) return undefined;
      const log = await cached(`log:${game.league}:${l.id}`, now, () => deps.gamelog(game.league, l.id)).catch(() => undefined);
      return log ? buildPlayerWatch(l, log, abbr) : undefined;
    };
    const [ph, pa] = await Promise.all([watch(game.leaders.home, game.home.abbr), watch(game.leaders.away, game.away.abbr)]);
    if (ph || pa) out.players = { home: ph, away: pa };
  }
  return out.form || out.players ? out : undefined;
}
