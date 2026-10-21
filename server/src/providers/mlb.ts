import type { BaseballSituation, ScoringPlay } from "../types.js";
import { digits, getJson as fetchJson, namespacedId, optStr, type Raw, str } from "./raw.js";

const BASE = process.env.MLB_BASE ?? "https://statsapi.mlb.com/api";

export interface MlbGame {
  id: number;
  date: string;
  start_utc: string;
  homeName: string;
  awayName: string;
  homeNick: string;
  awayNick: string;
  homeAbbr: string;
  awayAbbr: string;
  state: "pre" | "in" | "post";
  inning: number;
  inningHalf?: "top" | "bottom" | undefined;
  inningState?: string | undefined;
  inIntermission: boolean;
  homeScore: number;
  awayScore: number;
  goals: ScoringPlay[];
  situation?: BaseballSituation | undefined;
}

const getJson = (url: string): Promise<Raw> => fetchJson(url, 6000);

const SUFFIX = ["th", "st", "nd", "rd"];
function ordinal(n: number): string {
  const v = n % 100;
  return n + (SUFFIX[(v - 20) % 10] || SUFFIX[v] || "th");
}

const stateOf = (abstractState: unknown, codedState: unknown): MlbGame["state"] => {
  const a = str(abstractState).toLowerCase();
  const c = str(codedState).toUpperCase();
  if (a === "live" || c === "I") return "in";
  if (a === "final" || c === "F" || c === "O") return "post";
  return "pre";
};

export function parseSituation(ls: Raw): BaseballSituation | undefined {
  if (!ls) return undefined;
  const inn = Number(ls.currentInning ?? 0);
  if (!inn) return undefined;
  const halfRaw = str(ls.inningHalf ?? (ls.isTopInning ? "top" : "bottom")).toLowerCase();
  const half: "top" | "bottom" = halfRaw === "bottom" ? "bottom" : "top";
  const inning_state = str(ls.inningState ?? (half === "bottom" ? "Bottom" : "Top"));
  return {
    inning: inn,
    half,
    inning_state,
    balls: Number(ls.balls ?? 0),
    strikes: Number(ls.strikes ?? 0),
    outs: Number(ls.outs ?? 0),
    on_first: !!ls.offense?.first,
    on_second: !!ls.offense?.second,
    on_third: !!ls.offense?.third,
    batter: optStr(ls.offense?.batter?.fullName),
    pitcher: optStr(ls.defense?.pitcher?.fullName),
  };
}

export function parseScoringPlay(p: Raw, gamePk: number, homeAbbr: string, awayAbbr: string): ScoringPlay | undefined {
  const inn = Number(p.about?.inning ?? 0);
  const half = str(p.about?.halfInning).toLowerCase();
  const teamAbbr = half === "bottom" ? homeAbbr : awayAbbr;
  const desc = optStr(p.result?.description);
  const event = optStr(p.result?.event);
  const eventType = optStr(p.result?.eventType);
  const isHr =
    /home run|homers|grand slam/i.test(event ?? "") ||
    /home run|homers|grand slam/i.test(desc ?? "") ||
    eventType === "home_run";
  const batter = optStr(p.matchup?.batter?.fullName);
  const awayScore = Number(p.result?.awayScore ?? 0);
  const homeScore = Number(p.result?.homeScore ?? 0);
  const halfLabel = half === "bottom" ? "Bot" : "Top";

  return {
    key: `mlb-${gamePk}-${inn}-${half}-${awayScore}-${homeScore}`,
    period: inn,
    period_label: `${halfLabel} ${ordinal(inn)}`,
    clock: `${halfLabel} ${inn}`,
    team_abbr: teamAbbr,
    scorer: batter,
    scorer_id: namespacedId("mlb", p.matchup?.batter?.id),
    scorer_number: digits(p.matchup?.batter?.primaryNumber ?? p.matchup?.batter?.jerseyNumber),
    assists: [],
    strength: isHr ? "HR" : undefined,
    text: desc,
    home_score: homeScore,
    away_score: awayScore,
  };
}

export function normalizeMlb(g: Raw): MlbGame {
  const gamePk = Number(g.gamePk ?? g.id ?? 0);
  const homeTeam = g.teams?.home?.team ?? {};
  const awayTeam = g.teams?.away?.team ?? {};
  const homeName = str(homeTeam.name);
  const awayName = str(awayTeam.name);
  const homeNick = str(homeTeam.teamName ?? homeTeam.clubName ?? homeName).toLowerCase();
  const awayNick = str(awayTeam.teamName ?? awayTeam.clubName ?? awayName).toLowerCase();
  const homeAbbr = str(homeTeam.abbreviation ?? g.teams?.home?.abbreviation ?? "").toUpperCase();
  const awayAbbr = str(awayTeam.abbreviation ?? g.teams?.away?.abbreviation ?? "").toUpperCase();

  const linescore = g.linescore;
  const situation = parseSituation(linescore);
  const innState = str(linescore?.inningState ?? linescore?.inningHalf);
  const inIntermission = innState === "Middle" || innState === "End";
  const inning = Number(linescore?.currentInning ?? 0);
  const inningHalf = situation?.half;

  const rawPlays = Array.isArray(g.scoringPlays) ? g.scoringPlays : [];
  const goals: ScoringPlay[] = rawPlays
    .map((p: Raw) => parseScoringPlay(p, gamePk, homeAbbr, awayAbbr))
    .filter(Boolean) as ScoringPlay[];

  return {
    id: gamePk,
    date: str(g.officialDate ?? g.gameDate?.slice(0, 10)),
    start_utc: str(g.gameDate),
    homeName,
    awayName,
    homeNick,
    awayNick,
    homeAbbr,
    awayAbbr,
    state: stateOf(g.status?.abstractGameState, g.status?.codedGameState),
    inning,
    inningHalf,
    inningState: innState || undefined,
    inIntermission,
    homeScore: Number(g.teams?.home?.score ?? 0),
    awayScore: Number(g.teams?.away?.score ?? 0),
    goals,
    situation,
  };
}

export function parseMlbLive(d: Raw): MlbGame {
  const gamePk = Number(d.gamePk ?? 0);
  const gameData = d.gameData ?? {};
  const liveData = d.liveData ?? {};
  const homeTeam = gameData.teams?.home ?? {};
  const awayTeam = gameData.teams?.away ?? {};
  const homeName = str(homeTeam.name);
  const awayName = str(awayTeam.name);
  const homeNick = str(homeTeam.teamName ?? homeTeam.clubName ?? homeName).toLowerCase();
  const awayNick = str(awayTeam.teamName ?? awayTeam.clubName ?? awayName).toLowerCase();
  const homeAbbr = str(homeTeam.abbreviation ?? "").toUpperCase();
  const awayAbbr = str(awayTeam.abbreviation ?? "").toUpperCase();

  const linescore = liveData.linescore;
  const situation = parseSituation(linescore);
  const innState = str(linescore?.inningState ?? linescore?.inningHalf);
  const inIntermission = innState === "Middle" || innState === "End";
  const inning = Number(linescore?.currentInning ?? 0);
  const inningHalf = situation?.half;

  const plays = liveData.plays ?? {};
  const allPlays = Array.isArray(plays.allPlays) ? plays.allPlays : [];
  const scoringIndexes: number[] = Array.isArray(plays.scoringPlays) ? plays.scoringPlays : [];
  const goals: ScoringPlay[] = scoringIndexes
    .map((idx: number) => {
      const p = allPlays[idx];
      return p ? parseScoringPlay(p, gamePk, homeAbbr, awayAbbr) : undefined;
    })
    .filter(Boolean) as ScoringPlay[];

  return {
    id: gamePk,
    date: str(gameData.datetime?.originalDate ?? gameData.datetime?.dateTime?.slice(0, 10)),
    start_utc: str(gameData.datetime?.dateTime),
    homeName,
    awayName,
    homeNick,
    awayNick,
    homeAbbr,
    awayAbbr,
    state: stateOf(gameData.status?.abstractGameState, gameData.status?.codedGameState),
    inning,
    inningHalf,
    inningState: innState || undefined,
    inIntermission,
    homeScore: Number(linescore?.teams?.home?.runs ?? 0),
    awayScore: Number(linescore?.teams?.away?.runs ?? 0),
    goals,
    situation,
  };
}

export async function fetchMlbScores(date?: string): Promise<MlbGame[]> {
  const d = date ? `&date=${date}` : "";
  const data = await getJson(`${BASE}/v1/schedule?sportId=1${d}&hydrate=team,linescore,scoringplays`);
  const games: MlbGame[] = [];
  for (const dateItem of data.dates ?? []) {
    for (const g of dateItem.games ?? []) {
      games.push(normalizeMlb(g));
    }
  }
  return games;
}

export async function fetchMlbGame(id: number): Promise<MlbGame> {
  return parseMlbLive(await getJson(`${BASE}/v1.1/game/${id}/feed/live`));
}

export function matchMlb(
  espn: { start_time: string; home: { name: string; abbr?: string | undefined; display_name?: string | undefined }; away: { name: string; abbr?: string | undefined; display_name?: string | undefined } },
  mlb: MlbGame[],
): MlbGame | undefined {
  const t = Date.parse(espn.start_time);
  const hn = espn.home.name.toLowerCase();
  const an = espn.away.name.toLowerCase();
  const ha = (espn.home.abbr ?? "").toUpperCase();
  const aa = (espn.away.abbr ?? "").toUpperCase();
  const hdn = (espn.home.display_name ?? "").toLowerCase();
  const adn = (espn.away.display_name ?? "").toLowerCase();

  return mlb.find((g) => {
    if (Math.abs(Date.parse(g.start_utc) - t) >= 3 * 3600e3) return false;
    const matchHome = (ha && g.homeAbbr === ha) || g.homeNick === hn || (hdn && g.homeName.toLowerCase() === hdn);
    const matchAway = (aa && g.awayAbbr === aa) || g.awayNick === an || (adn && g.awayName.toLowerCase() === adn);
    return matchHome && matchAway;
  });
}
