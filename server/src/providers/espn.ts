import { isShootout, leagueById, periodLabel, type LeagueDef } from "../leagues.js";
import type { Game, GameStatus, LeaderRef, Rgb, ScoringPlay, StartingGoalie, StatRow, Team } from "../types.js";
import { fetchAhlGameSummary, fetchAhlScoreboard } from "./ahl.js";
import { buildStatRows } from "./boxscore.js";
import { digits, finite, getJson, namespacedId, optStr, type Raw, str } from "./raw.js";
import { normStrength } from "./strength.js";

const BASE = process.env.ESPN_BASE ?? "https://site.api.espn.com/apis/site/v2/sports";
const WEB_BASE = process.env.ESPN_WEB_BASE ?? "https://site.web.api.espn.com/apis/common/v3/sports";

function hexToRgb(hex: string | undefined, fallback: Rgb): Rgb {
  if (!hex || !/^[0-9a-f]{6}$/i.test(hex)) return fallback;
  return { r: parseInt(hex.slice(0, 2), 16), g: parseInt(hex.slice(2, 4), 16), b: parseInt(hex.slice(4, 6), 16) };
}

const GREY: Rgb = { r: 90, g: 98, b: 110 };
const WHITE: Rgb = { r: 255, g: 255, b: 255 };

function toTeam(c: Raw): Team {
  const t = c.team ?? {};
  const primary = hexToRgb(t.color, GREY);
  return {
    id: String(t.id ?? c.id ?? ""),
    abbr: String(t.abbreviation ?? t.shortDisplayName ?? "???").toUpperCase(),
    name: str(t.name ?? t.shortDisplayName ?? t.displayName),
    display_name: str(t.displayName ?? t.name),
    logo: str(t.logo),
    score: Number(c.score ?? 0) || 0,
    record: optStr((c.records ?? []).find((r: Raw) => r.type === "total" || r.name === "overall")?.summary),
    options: {
      primary_color_rgb: primary,
      secondary_color_rgb: hexToRgb(t.alternateColor, WHITE),
      alternate_color_rgb: WHITE,
    },
  };
}

function statusOf(type: Raw): { status: GameStatus; intermission: boolean } {
  const name: string = type?.name ?? "";
  const state: string = type?.state ?? "pre";
  const intermission = /END_PERIOD|STATUS_BREAK/i.test(name) || /^(end of|intermission)/i.test(type?.detail ?? "");
  return { status: (state === "in" || state === "post" ? state : "pre") as GameStatus, intermission: state === "in" && intermission };
}

/** Top "points" (else "goals") leader of a competitor, as shown on the scoreboard payload. */
export function pickLeader(c: Raw): LeaderRef | undefined {
  const cats: Raw[] = c.leaders ?? [];
  const cat = cats.find((l) => l.name === "points") ?? cats.find((l) => l.name === "goals") ?? cats.find((l) => l.name === "pointsPerGame");
  const a = cat?.leaders?.[0]?.athlete;
  if (!a?.id) return undefined;
  const name = str(a.displayName ?? a.fullName);
  const i = name.indexOf(" ");
  return {
    id: String(a.id),
    name,
    first: i > 0 ? name.slice(0, i) : "",
    last: i > 0 ? name.slice(i + 1) : name,
    jersey: a.jersey ? String(a.jersey) : undefined,
    position: optStr(typeof a.position === "string" ? a.position : a.position?.abbreviation),
    headshot: optStr(typeof a.headshot === "string" ? a.headshot : a.headshot?.href),
  };
}

export function pickGoalie(c: Raw): StartingGoalie | undefined {
  const pList: Raw[] = c.probables ?? [];
  const p = pList.find((x) => x.name === "probableStartingGoalie") ?? pList[0];
  if (!p?.athlete?.id && !p?.athlete?.displayName && !p?.athlete?.fullName) return undefined;
  const a = p.athlete;
  const name = str(a.displayName ?? a.fullName);
  if (!name) return undefined;
  const i = name.indexOf(" ");
  const statusName = optStr(p.status?.name ?? p.status?.type);
  const confirmed = statusName ? /confirm/i.test(statusName) : undefined;
  let gaa: string | undefined;
  let save_pct: string | undefined;
  for (const s of p.statistics ?? []) {
    if (s.name === "goalsAgainstAverage" || s.abbreviation === "GAA") gaa = String(s.displayValue ?? s.value);
    if (s.name === "savePct" || s.abbreviation === "SV%") save_pct = String(s.displayValue ?? s.value);
  }
  return {
    id: a.id ? String(a.id) : undefined,
    name,
    first: i > 0 ? name.slice(0, i) : undefined,
    last: i > 0 ? name.slice(i + 1) : name,
    jersey: a.jersey ? String(a.jersey) : undefined,
    headshot: optStr(typeof a.headshot === "string" ? a.headshot : a.headshot?.href),
    confirmed,
    status: statusName,
    record: optStr(p.record),
    gaa,
    save_pct,
  };
}

function statsMap(c: Raw): Record<string, string> {
  const out: Record<string, string> = {};
  for (const s of c.statistics ?? []) {
    if (s?.abbreviation && s.displayValue !== undefined) out[s.abbreviation] = String(s.displayValue);
  }
  return out;
}

export function normalizeEvent(league: LeagueDef, ev: Raw): Game | undefined {
  const comp = ev.competitions?.[0];
  if (!comp) return undefined;
  const competitors: Raw[] = comp.competitors ?? [];
  const homeC = competitors.find((c) => c.homeAway === "home");
  const awayC = competitors.find((c) => c.homeAway === "away");
  if (!homeC || !awayC) return undefined;
  const start = new Date(ev.date);
  if (Number.isNaN(start.getTime())) return undefined;
  const { status, intermission } = statusOf(ev.status?.type ?? comp.status?.type);
  const period = Number(ev.status?.period ?? 0) || 0;
  const odds = comp.odds?.[0];

  const home = toTeam(homeC);
  const away = toTeam(awayC);

  // Shots on goal from scoreboard statistics if present
  const homeStats = statsMap(homeC);
  const awayStats = statsMap(awayC);
  const hs = Number(homeStats["SOG"] ?? homeStats["S"] ?? homeStats["shots"]);
  const as = Number(awayStats["SOG"] ?? awayStats["S"] ?? awayStats["shots"]);
  const sog = Number.isFinite(hs) && Number.isFinite(as) ? { home: hs, away: as } : undefined;

  const game: Game = {
    id: `${league.id}:${ev.id}`,
    league: league.id,
    sport: "hockey",
    status,
    start_time: start.toISOString(),
    period: status === "pre" ? 0 : period,
    period_label: status === "pre" ? "" : periodLabel(league, period),
    clock: status === "in" && !isShootout(league, period) ? String(ev.status?.displayClock ?? "") : "",
    clock_s: status === "in" && !isShootout(league, period) && typeof ev.status?.clock === "number" ? ev.status.clock : undefined,
    clock_dir: "down",
    intermission,
    home,
    away,
    linescores: {
      home: (homeC.linescores ?? []).map((l: Raw) => Number(l.value ?? 0)),
      away: (awayC.linescores ?? []).map((l: Raw) => Number(l.value ?? 0)),
    },
    stats: { home: homeStats, away: awayStats },
    goals: [],
    sog,
    odds: odds ? { details: optStr(odds.details), over_under: finite(odds.overUnder) } : undefined,
    leaders: { home: pickLeader(homeC), away: pickLeader(awayC) },
    goalies: (pickGoalie(homeC) || pickGoalie(awayC)) ? { home: pickGoalie(homeC), away: pickGoalie(awayC) } : undefined,
    authority: "espn",
  };
  return game;
}

interface ScoreboardDay {
  games: Game[];
  day?: string | undefined;
}

/** date: YYYYMMDD. Omit for ESPN's notion of "today". */
export async function fetchScoreboardDay(leagueId: string, date?: string): Promise<ScoreboardDay> {
  const league = leagueById(leagueId);

  // AHL: fetched through dedicated HockeyTech provider
  if (league.id === "ahl") {
    const games = await fetchAhlScoreboard(league);
    return { games, day: date };
  }

  // IIHF: international tournaments covering Olympics, World Juniors, World Championships
  if (league.id === "iihf" && league.espnTournaments?.length) {
    const q = new URLSearchParams({ limit: "200" });
    if (date) q.set("dates", date);
    const tournamentResults = await Promise.allSettled(
      league.espnTournaments.map(async (tournamentSlug) => {
        const data = await getJson(`${BASE}/${tournamentSlug}/scoreboard?${q}`);
        return {
          games: (data.events ?? []).map((e: Raw) => normalizeEvent(league, e)).filter(Boolean) as Game[],
          day: typeof data.day?.date === "string" ? data.day.date : undefined,
        };
      }),
    );
    const allGames: Game[] = [];
    let reportDay: string | undefined = undefined;
    for (const res of tournamentResults) {
      if (res.status === "fulfilled") {
        allGames.push(...res.value.games);
        if (res.value.day) reportDay = res.value.day;
      }
    }
    const seen = new Set<string>();
    const uniqueGames = allGames.filter((g) => {
      if (seen.has(g.id)) return false;
      seen.add(g.id);
      return true;
    });
    return { games: uniqueGames, day: reportDay };
  }

  // Primary: NHL
  const q = new URLSearchParams({ limit: "200" });
  if (date) q.set("dates", date);
  const data = await getJson(`${BASE}/${league.espn}/scoreboard?${q}`);
  return {
    games: (data.events ?? []).map((e: Raw) => normalizeEvent(league, e)).filter(Boolean) as Game[],
    day: typeof data.day?.date === "string" ? data.day.date : undefined,
  };
}

export async function fetchScoreboard(leagueId: string, date?: string): Promise<Game[]> {
  return (await fetchScoreboardDay(leagueId, date)).games;
}

export interface Summary {
  plays: ScoringPlay[];
  rows: StatRow[];
}

/** One call, two products: scoring plays (scorer/assists) and the boxscore comparison rows. */
export async function fetchSummary(gameId: string, homeAbbrByTeamId: Record<string, string>): Promise<Summary> {
  const [leagueId, eventId] = gameId.split(":");
  if (!leagueId || !eventId) throw new Error(`bad game id "${gameId}"`);
  const league = leagueById(leagueId);

  if (league.id === "ahl") {
    const homeAbbr = Object.values(homeAbbrByTeamId)[0] ?? "HOME";
    const awayAbbr = Object.values(homeAbbrByTeamId)[1] ?? "AWAY";
    return fetchAhlGameSummary(league, gameId, homeAbbr, awayAbbr);
  }

  // IIHF tournament summaries: probe tournament paths if needed
  if (league.id === "iihf" && league.espnTournaments?.length) {
    for (const slug of league.espnTournaments) {
      try {
        const data = await getJson(`${BASE}/${slug}/summary?event=${eventId}`);
        if (data && (data.scoringPlays || data.plays || data.boxscore)) {
          return parseSummary(league, data, homeAbbrByTeamId);
        }
      } catch {
        /* try next tournament slug */
      }
    }
  }

  const data = await getJson(`${BASE}/${league.espn}/summary?event=${eventId}`);
  return parseSummary(league, data, homeAbbrByTeamId);
}

export function parseSummary(league: LeagueDef, data: Raw, homeAbbrByTeamId: Record<string, string>): Summary {
  const raw: Raw[] = data.scoringPlays?.length ? data.scoringPlays : (data.plays ?? []).filter((p: Raw) => p.scoringPlay);
  const plays = raw.map((p: Raw): ScoringPlay => {
    const parts: Raw[] = p.participants ?? [];
    const scorerAthlete = parts.find((x) => x.type === "scorer")?.athlete;
    const scorer = optStr(scorerAthlete?.displayName);
    const assists = parts.filter((x) => x.type === "assister" || x.type === "assist").flatMap((x) => optStr(x.athlete?.displayName) ?? []);
    const teamId = String(p.team?.id ?? "");
    return {
      key: String(p.id ?? `${p.period?.number}-${p.clock?.displayValue}-${p.homeScore}-${p.awayScore}`),
      period: Number(p.period?.number ?? 0),
      period_label: periodLabel(league, Number(p.period?.number ?? 0)),
      clock: isShootout(league, Number(p.period?.number ?? 0)) ? "" : String(p.clock?.displayValue ?? ""),
      team_abbr: homeAbbrByTeamId[teamId] ?? "",
      scorer,
      scorer_id: namespacedId("espn", scorerAthlete?.id),
      scorer_number: digits(scorerAthlete?.jersey),
      assists,
      strength: normStrength(p.strength?.abbreviation ?? p.strength?.text, /empty net/i.test(p.text ?? "")),
      text: optStr(p.text),
      home_score: Number(p.homeScore ?? 0),
      away_score: Number(p.awayScore ?? 0),
    };
  });
  return { plays, rows: buildStatRows(league.sport, data.boxscore?.teams) };
}

/** Raw JSON helpers for the insight builders. */
export const espnJson = {
  teamSchedule: (leagueId: string, teamId: string) => getJson(`${BASE}/${leagueById(leagueId).espn}/teams/${teamId}/schedule`),
  teamStats: (leagueId: string, teamId: string) => getJson(`${BASE}/${leagueById(leagueId).espn}/teams/${teamId}/statistics`),
  gamelog: (leagueId: string, athleteId: string) =>
    getJson(`${WEB_BASE}/${leagueById(leagueId).espn}/athletes/${athleteId}/gamelog`),
};
