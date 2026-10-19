export interface LeagueDef {
  id: string;
  name: string;
  sport: "hockey" | "football" | "basketball" | "baseball" | "soccer";
  espn: string; // "<sport>/<league>"
  /** noun for a period of play, used in TTS and labels */
  periodNoun: string;
  /** regulation periods, for ordinal labels */
  regulation: number;
  minDelta: number;
  /** off by default: enable it in the dashboard's league settings (keeps polling light for everyone else) */
  optIn?: boolean;
}

export const LEAGUES: LeagueDef[] = [
  { id: "nhl", name: "NHL", sport: "hockey", espn: "hockey/nhl", periodNoun: "period", regulation: 3, minDelta: 1 },
  { id: "nfl", name: "NFL", sport: "football", espn: "football/nfl", periodNoun: "quarter", regulation: 4, minDelta: 3 },
  { id: "nba", name: "NBA", sport: "basketball", espn: "basketball/nba", periodNoun: "quarter", regulation: 4, minDelta: 1 },
  { id: "mlb", name: "MLB", sport: "baseball", espn: "baseball/mlb", periodNoun: "inning", regulation: 9, minDelta: 1 },
  { id: "mls", name: "MLS", sport: "soccer", espn: "soccer/usa.1", periodNoun: "half", regulation: 2, minDelta: 1 },
  { id: "epl", name: "Premier League", sport: "soccer", espn: "soccer/eng.1", periodNoun: "half", regulation: 2, minDelta: 1 },
  { id: "laliga", name: "LaLiga", sport: "soccer", espn: "soccer/esp.1", periodNoun: "half", regulation: 2, minDelta: 1 },
  { id: "bundesliga", name: "Bundesliga", sport: "soccer", espn: "soccer/ger.1", periodNoun: "half", regulation: 2, minDelta: 1 },
  { id: "ucl", name: "Champions League", sport: "soccer", espn: "soccer/uefa.champions", periodNoun: "half", regulation: 2, minDelta: 1 },
  { id: "wnba", name: "WNBA", sport: "basketball", espn: "basketball/wnba", periodNoun: "quarter", regulation: 4, minDelta: 1, optIn: true },
  { id: "ncaaf", name: "NCAA Football", sport: "football", espn: "football/college-football", periodNoun: "quarter", regulation: 4, minDelta: 3, optIn: true },
  { id: "ncaah", name: "NCAA Hockey", sport: "hockey", espn: "hockey/mens-college-hockey", periodNoun: "period", regulation: 3, minDelta: 1, optIn: true },
];

/** Regulation period length in seconds, and overtime length, for converting (period, clock) into elapsed game time. */
export function periodSeconds(league: LeagueDef, period: number): number {
  switch (league.sport) {
    case "hockey":
      return period <= 3 ? 1200 : 300; // regular-season OT is 5 minutes (playoffs differ; calibration only needs consistency)
    case "basketball":
      return period <= 4 ? (league.id === "nba" ? 720 : 600) : 300;
    case "football":
      return period <= 4 ? 900 : 600;
    default:
      return 0; // soccer counts up from kickoff; baseball has no clock
  }
}

export const leagueById = (id: string): LeagueDef => {
  const l = LEAGUES.find((x) => x.id === id);
  if (!l) throw new Error(`unknown league ${id}`);
  return l;
};

const SUFFIX = ["th", "st", "nd", "rd"];
function ordinal(n: number): string {
  const v = n % 100;
  return n + (SUFFIX[(v - 20) % 10] || SUFFIX[v] || "th");
}

export function periodLabel(league: LeagueDef, n: number): string {
  if (n <= 0) return "";
  if (league.sport === "hockey") {
    if (n <= 3) return `${ordinal(n)} period`;
    return n === 4 ? "overtime" : n === 5 ? "shootout" : `${n - 3}OT`;
  }
  if (league.sport === "football" || league.sport === "basketball") {
    if (n <= 4) return `${ordinal(n)} quarter`;
    return n === 5 ? "overtime" : `${n - 4}OT`;
  }
  if (league.sport === "baseball") return `${ordinal(n)} inning`;
  if (n <= 2) return `${ordinal(n)} half`;
  return n === 3 ? "extra time" : "penalties";
}

/** A hockey shootout (period 5+) has no game clock: ESPN and the NHL feed both report a meaningless 0:00. */
export const isShootout = (league: LeagueDef, period: number): boolean => league.sport === "hockey" && period >= 5;
