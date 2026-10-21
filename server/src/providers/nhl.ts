import type { ScoringPlay } from "../types.js";
import { digits, getJson as fetchJson, namespacedId, optStr, type Raw, str } from "./raw.js";
import { normStrength, parseSituation, strengthFromSituation } from "./strength.js";

const BASE = process.env.NHL_BASE ?? "https://api-web.nhle.com/v1";

export interface NhlGame {
  id: number;
  date: string; // YYYY-MM-DD (NHL game date, ET)
  start_utc: string;
  homeNick: string;
  awayNick: string;
  homeAbbr: string;
  awayAbbr: string;
  state: "pre" | "in" | "post";
  period: number;
  clock: string;
  /** seconds left on the period clock, and whether it is running */
  clockS?: number | undefined;
  clockRunning?: boolean | undefined;
  inIntermission: boolean;
  homeScore: number;
  awayScore: number;
  goals: ScoringPlay[];
  /** from the latest play-by-play event (only the play-by-play feed carries it) */
  situation?: { advantage: "home" | "away" | null; home_skaters: number; away_skaters: number } | undefined;
}

/** Skater situation as of the most recent play that carries a situationCode. */
export function latestSituation(plays: Raw[] | undefined): NhlGame["situation"] {
  for (let i = (plays?.length ?? 0) - 1; i >= 0; i--) {
    const p = parseSituation(plays![i].situationCode);
    if (p) return { advantage: p.advantage, home_skaters: p.home_skaters, away_skaters: p.away_skaters };
  }
  return undefined;
}

// score/now redirects to /score/YYYY-MM-DD; fetch follows redirects by default
const getJson = (url: string): Promise<Raw> => fetchJson(url, 6000);

const stateOf = (s: string): NhlGame["state"] => {
  if (s === "LIVE" || s === "CRIT") return "in";
  if (s === "FINAL" || s === "OFF") return "post";
  return "pre"; // FUT, PRE
};

const ord = (n: number) => (n === 1 ? "1st" : n === 2 ? "2nd" : n === 3 ? "3rd" : n === 4 ? "OT" : n === 5 ? "SO" : `${n}`);
const scorerId = (v: unknown) => namespacedId("nhl", v);

export function normalizeNhl(g: Raw): NhlGame {
  const goals: ScoringPlay[] = (g.goals ?? []).map((x: Raw): ScoringPlay => ({
    key: `nhl-${g.id}-${x.period}-${x.timeInPeriod}-${x.homeScore}-${x.awayScore}`,
    period: Number(x.period ?? 0),
    period_label: ord(Number(x.period ?? 0)),
    clock: String(x.timeInPeriod ?? ""),
    team_abbr: String(x.teamAbbrev ?? ""),
    scorer: [str(x.firstName?.default), str(x.lastName?.default)].filter(Boolean).join(" ") || optStr(x.name?.default),
    scorer_id: scorerId(x.playerId),
    scorer_number: digits(x.sweaterNumber),
    assists: (x.assists ?? []).flatMap((a: Raw) => optStr(a.name?.default) ?? []),
    strength: normStrength(x.strength, x.goalModifier === "empty-net"),
    home_score: Number(x.homeScore ?? 0),
    away_score: Number(x.awayScore ?? 0),
  }));
  return {
    id: Number(g.id),
    date: str(g.gameDate),
    start_utc: str(g.startTimeUTC),
    homeNick: str(g.homeTeam?.name?.default).toLowerCase(),
    awayNick: str(g.awayTeam?.name?.default).toLowerCase(),
    homeAbbr: str(g.homeTeam?.abbrev),
    awayAbbr: str(g.awayTeam?.abbrev),
    state: stateOf(g.gameState),
    period: Number(g.periodDescriptor?.number ?? g.period ?? 0),
    clock: String(g.clock?.timeRemaining ?? ""),
    clockS: typeof g.clock?.secondsRemaining === "number" ? g.clock.secondsRemaining : undefined,
    clockRunning: !!g.clock?.running,
    inIntermission: !!g.clock?.inIntermission,
    homeScore: Number(g.homeTeam?.score ?? 0),
    awayScore: Number(g.awayTeam?.score ?? 0),
    goals,
  };
}

/** `date` = YYYY-MM-DD, or omit for /score/now. */
export async function fetchNhlScores(date?: string): Promise<NhlGame[]> {
  const data = await getJson(`${BASE}/score/${date ?? "now"}`);
  return (data.games ?? []).map(normalizeNhl);
}

/** Per-game feed used for the fast goal poller: score, clock, goals with scorer names. */
export async function fetchNhlGame(id: number): Promise<NhlGame> {
  return parsePbp(await getJson(`${BASE}/gamecenter/${id}/play-by-play`));
}

/**
 * Prefer the NHL's own `strength` (score/now) over the one we derive from situation codes, matching goals by key.
 * The derived value is only a fallback for goals score/now has not listed yet.
 */
export function withOfficialStrength(pbpGoals: ScoringPlay[], official: ScoringPlay[]): ScoringPlay[] {
  const byKey = new Map(official.map((g) => [g.key, g.strength]));
  return pbpGoals.map((g) => ({ ...g, strength: byKey.get(g.key) ?? g.strength }));
}

/** Pure parse of a play-by-play payload (score, clock, goals with scorers, current skater situation). */
export function parsePbp(d: Raw): NhlGame {
  const roster = new Map<number, string>();
  const numbers = new Map<number, string>();
  for (const r of d.rosterSpots ?? []) {
    roster.set(Number(r.playerId), `${str(r.firstName?.default)} ${str(r.lastName?.default)}`.trim());
    const number = digits(r.sweaterNumber);
    if (number !== undefined) numbers.set(Number(r.playerId), number);
  }
  const abbrById = new Map<number, string>([[Number(d.homeTeam?.id), str(d.homeTeam?.abbrev)], [Number(d.awayTeam?.id), str(d.awayTeam?.abbrev)]]);
  const goals: ScoringPlay[] = (d.plays ?? [])
    .filter((p: Raw) => p.typeDescKey === "goal")
    .map((p: Raw): ScoringPlay => {
      const x = p.details ?? {};
      const per = Number(p.periodDescriptor?.number ?? 0);
      return {
        key: `nhl-${d.id}-${per}-${p.timeInPeriod}-${x.homeScore}-${x.awayScore}`,
        period: per,
        period_label: ord(per),
        clock: String(p.timeInPeriod ?? ""),
        team_abbr: abbrById.get(Number(x.eventOwnerTeamId)) ?? "",
        scorer: roster.get(Number(x.scoringPlayerId)),
        scorer_id: scorerId(x.scoringPlayerId),
        scorer_number: numbers.get(Number(x.scoringPlayerId)),
        assists: [x.assist1PlayerId, x.assist2PlayerId].flatMap((i: number) => (i ? (roster.get(i) ?? []) : [])),
        strength: strengthFromSituation(p.situationCode, x.eventOwnerTeamId === d.homeTeam?.id),
        home_score: Number(x.homeScore ?? 0),
        away_score: Number(x.awayScore ?? 0),
      };
    });
  return {
    id: Number(d.id),
    date: str(d.gameDate),
    start_utc: str(d.startTimeUTC),
    homeNick: str(d.homeTeam?.commonName?.default ?? d.homeTeam?.name?.default).toLowerCase(),
    awayNick: str(d.awayTeam?.commonName?.default ?? d.awayTeam?.name?.default).toLowerCase(),
    homeAbbr: str(d.homeTeam?.abbrev),
    awayAbbr: str(d.awayTeam?.abbrev),
    state: stateOf(d.gameState),
    period: Number(d.periodDescriptor?.number ?? 0),
    clock: String(d.clock?.timeRemaining ?? ""),
    clockS: typeof d.clock?.secondsRemaining === "number" ? d.clock.secondsRemaining : undefined,
    clockRunning: !!d.clock?.running,
    inIntermission: !!d.clock?.inIntermission,
    homeScore: Number(d.homeTeam?.score ?? 0),
    awayScore: Number(d.awayTeam?.score ?? 0),
    goals,
    situation: latestSituation(d.plays),
  };
}

/** Match an ESPN-sourced hockey game to its NHL counterpart: same start (±3 h) and same team nicknames. */
export function matchNhl(espn: { start_time: string; home: { name: string }; away: { name: string } }, nhl: NhlGame[]): NhlGame | undefined {
  const t = Date.parse(espn.start_time);
  const hn = espn.home.name.toLowerCase();
  const an = espn.away.name.toLowerCase();
  return nhl.find((g) => Math.abs(Date.parse(g.start_utc) - t) < 3 * 3600e3 && g.homeNick === hn && g.awayNick === an);
}
