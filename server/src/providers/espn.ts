import { isShootout, leagueById, periodLabel, type LeagueDef } from "../leagues.js";
import type { Game, GameStatus, Incident, LeaderRef, Rgb, ScoringPlay, StatRow, Team } from "../types.js";
import { buildStatRows } from "./boxscore.js";
import { normStrength } from "./strength.js";

const BASE = process.env.ESPN_BASE ?? "https://site.api.espn.com/apis/site/v2/sports";
const WEB_BASE = process.env.ESPN_WEB_BASE ?? "https://site.web.api.espn.com/apis/common/v3/sports";

type J = any; // ESPN payloads are undocumented and wide; we pick fields defensively.

export function hexToRgb(hex: string | undefined, fallback: Rgb): Rgb {
  if (!hex || !/^[0-9a-f]{6}$/i.test(hex)) return fallback;
  return { r: parseInt(hex.slice(0, 2), 16), g: parseInt(hex.slice(2, 4), 16), b: parseInt(hex.slice(4, 6), 16) };
}

const GREY: Rgb = { r: 90, g: 98, b: 110 };
const WHITE: Rgb = { r: 255, g: 255, b: 255 };

function toTeam(c: J): Team {
  const t = c.team ?? {};
  const primary = hexToRgb(t.color, GREY);
  return {
    id: String(t.id ?? c.id ?? ""),
    abbr: String(t.abbreviation ?? t.shortDisplayName ?? "???").toUpperCase(),
    name: t.name ?? t.shortDisplayName ?? t.displayName ?? "",
    display_name: t.displayName ?? t.name ?? "",
    logo: t.logo ?? "",
    score: Number(c.score ?? 0) || 0,
    record: (c.records ?? []).find((r: J) => r.type === "total" || r.name === "overall")?.summary,
    options: {
      primary_color_rgb: primary,
      secondary_color_rgb: hexToRgb(t.alternateColor, WHITE),
      alternate_color_rgb: WHITE,
    },
  };
}

function statusOf(type: J): { status: GameStatus; intermission: boolean } {
  const name: string = type?.name ?? "";
  const state: string = type?.state ?? "pre";
  const intermission = /END_PERIOD|HALFTIME|END_OF_|END_INNING|STATUS_BREAK/i.test(name) || /^(end of|halftime|intermission)/i.test(type?.detail ?? "");
  // postponed / canceled games never start: keep as pre so no events fire
  return { status: (state === "in" || state === "post" ? state : "pre") as GameStatus, intermission: state === "in" && intermission };
}

/** Top "points" (else "goals") leader of a competitor, as shown on the scoreboard payload. */
export function pickLeader(c: J): LeaderRef | undefined {
  const cats: J[] = c.leaders ?? [];
  const cat = cats.find((l) => l.name === "points") ?? cats.find((l) => l.name === "goals") ?? cats.find((l) => l.name === "pointsPerGame");
  const a = cat?.leaders?.[0]?.athlete;
  if (!a?.id) return undefined;
  const name: string = a.displayName ?? a.fullName ?? "";
  const i = name.indexOf(" ");
  return {
    id: String(a.id),
    name,
    first: i > 0 ? name.slice(0, i) : "",
    last: i > 0 ? name.slice(i + 1) : name,
    jersey: a.jersey ? String(a.jersey) : undefined,
    position: typeof a.position === "string" ? a.position : a.position?.abbreviation,
    headshot: typeof a.headshot === "string" ? a.headshot : a.headshot?.href,
  };
}

/** Match half from the printed minute: 45'+6' is still the first half, 90'+3' the second, then extra time. */
export function soccerPeriod(clock: string): number {
  const m = parseInt(clock, 10);
  return !Number.isFinite(m) || m <= 45 ? 1 : m <= 90 ? 2 : m <= 105 ? 3 : 4;
}

/**
 * Football (soccer) match events from the scoreboard's `competitions[0].details[]`: goals (with scorer, own goals credited
 * to the team that benefits, shootout kicks excluded) and bookings. Needs no extra request.
 */
export function parseSoccerDetails(details: J[] | undefined, homeId: string, awayId: string, homeAbbr: string, awayAbbr: string, league: LeagueDef): { goals: ScoringPlay[]; incidents: Incident[] } {
  const goals: ScoringPlay[] = [];
  const incidents: Incident[] = [];
  let home = 0, away = 0;
  for (const d of details ?? []) {
    if (d.shootout) continue; // penalty-shootout kicks are not match goals
    const teamId = String(d.team?.id ?? "");
    const abbr = teamId === homeId ? homeAbbr : teamId === awayId ? awayAbbr : "";
    if (!abbr) continue;
    const clock = String(d.clock?.displayValue ?? "");
    const player: string | undefined = d.athletesInvolved?.[0]?.displayName;
    const key = `${clock}|${teamId}|${d.type?.text ?? ""}|${player ?? ""}`;
    if (d.scoringPlay) {
      if (abbr === homeAbbr) home += Number(d.scoreValue ?? 1) || 1;
      else away += Number(d.scoreValue ?? 1) || 1;
      goals.push({
        key,
        period: soccerPeriod(clock),
        period_label: "",
        clock,
        team_abbr: abbr,
        scorer: player,
        assists: [],
        text: d.type?.text,
        home_score: home,
        away_score: away,
      });
    } else if (d.redCard || d.yellowCard) {
      incidents.push({ key, kind: d.redCard ? "red" : "yellow", team_abbr: abbr, clock, player });
    }
  }
  for (const g of goals) g.period_label = periodLabel(league, g.period);
  return { goals, incidents };
}

function statsMap(c: J): Record<string, string> {
  const out: Record<string, string> = {};
  for (const s of c.statistics ?? []) {
    if (s?.abbreviation && s.displayValue !== undefined) out[s.abbreviation] = String(s.displayValue);
  }
  return out;
}

export function normalizeEvent(league: LeagueDef, ev: J): Game | undefined {
  const comp = ev.competitions?.[0];
  if (!comp) return undefined;
  const competitors: J[] = comp.competitors ?? [];
  const homeC = competitors.find((c) => c.homeAway === "home");
  const awayC = competitors.find((c) => c.homeAway === "away");
  if (!homeC || !awayC) return undefined;
  const { status, intermission } = statusOf(ev.status?.type ?? comp.status?.type);
  const period = Number(ev.status?.period ?? 0) || 0;
  const odds = comp.odds?.[0];
  const game: Game = {
    id: `${league.id}:${ev.id}`,
    league: league.id,
    sport: league.sport,
    status,
    start_time: new Date(ev.date).toISOString(),
    period: status === "pre" ? 0 : period,
    period_label: status === "pre" ? "" : periodLabel(league, period),
    clock: status === "in" && !isShootout(league, period) ? String(ev.status?.displayClock ?? "") : "",
    clock_s: status === "in" && !isShootout(league, period) && typeof ev.status?.clock === "number" ? ev.status.clock : undefined,
    // ESPN gives no running flag; the engine infers it from consecutive polls
    clock_dir: league.sport === "soccer" ? "up" : league.sport === "baseball" ? undefined : "down",
    intermission,
    home: toTeam(homeC),
    away: toTeam(awayC),
    linescores: {
      home: (homeC.linescores ?? []).map((l: J) => Number(l.value ?? 0)),
      away: (awayC.linescores ?? []).map((l: J) => Number(l.value ?? 0)),
    },
    stats: { home: statsMap(homeC), away: statsMap(awayC) },
    goals: [],
    odds: odds ? { details: odds.details, over_under: odds.overUnder } : undefined,
    leaders: { home: pickLeader(homeC), away: pickLeader(awayC) },
    authority: "espn",
  };
  if (league.sport === "soccer") {
    const t = parseSoccerDetails(comp.details, String(homeC.team?.id ?? homeC.id), String(awayC.team?.id ?? awayC.id), game.home.abbr, game.away.abbr, league);
    game.goals = t.goals;
    game.incidents = t.incidents;
  }
  return game;
}

async function getJson(url: string, timeoutMs = 8000): Promise<J> {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), headers: { "user-agent": "homeroom/0.1" } });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
}

export interface ScoreboardDay {
  games: Game[];
  /** the day ESPN says this payload covers, "YYYY-MM-DD" (its default "today" lags the real date for hours) */
  day?: string;
}

/** date: YYYYMMDD. Omit for ESPN's notion of "today". */
export async function fetchScoreboardDay(leagueId: string, date?: string): Promise<ScoreboardDay> {
  const league = leagueById(leagueId);
  const q = new URLSearchParams({ limit: "200" });
  if (date) q.set("dates", date);
  const data = await getJson(`${BASE}/${league.espn}/scoreboard?${q}`);
  return {
    games: (data.events ?? []).map((e: J) => normalizeEvent(league, e)).filter(Boolean) as Game[],
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
  const league = leagueById(leagueId);
  const data = await getJson(`${BASE}/${league.espn}/summary?event=${eventId}`);
  return parseSummary(league, data, homeAbbrByTeamId);
}

export function parseSummary(league: LeagueDef, data: J, homeAbbrByTeamId: Record<string, string>): Summary {
  const raw: J[] = data.scoringPlays?.length ? data.scoringPlays : (data.plays ?? []).filter((p: J) => p.scoringPlay);
  const plays = raw.map((p: J): ScoringPlay => {
    const parts: J[] = p.participants ?? [];
    const scorer = parts.find((x) => x.type === "scorer")?.athlete?.displayName;
    const assists = parts.filter((x) => x.type === "assister" || x.type === "assist").map((x) => x.athlete?.displayName).filter(Boolean);
    const teamId = String(p.team?.id ?? "");
    return {
      key: String(p.id ?? `${p.period?.number}-${p.clock?.displayValue}-${p.homeScore}-${p.awayScore}`),
      period: Number(p.period?.number ?? 0),
      period_label: periodLabel(league, Number(p.period?.number ?? 0)),
      clock: isShootout(league, Number(p.period?.number ?? 0)) ? "" : String(p.clock?.displayValue ?? ""),
      team_abbr: homeAbbrByTeamId[teamId] ?? "",
      scorer,
      assists,
      strength: normStrength(p.strength?.abbreviation ?? p.strength?.text, /empty net/i.test(p.text ?? "")),
      text: p.text,
      home_score: Number(p.homeScore ?? 0),
      away_score: Number(p.awayScore ?? 0),
    };
  });
  return { plays, rows: buildStatRows(league.sport, data.boxscore?.teams) };
}

/** Raw JSON helpers for the insight builders (kept here so every ESPN URL lives in one file). */
export const espnJson = {
  teamSchedule: (leagueId: string, teamId: string) => getJson(`${BASE}/${leagueById(leagueId).espn}/teams/${teamId}/schedule`),
  teamStats: (leagueId: string, teamId: string) => getJson(`${BASE}/${leagueById(leagueId).espn}/teams/${teamId}/statistics`),
  gamelog: (leagueId: string, athleteId: string) =>
    getJson(`${WEB_BASE}/${leagueById(leagueId).espn}/athletes/${athleteId}/gamelog`),
};
