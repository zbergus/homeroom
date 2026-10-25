export interface LeagueDef {
  id: string;
  name: string;
  sport: "hockey";
  espn: string; // "<sport>/<league>"
  /** Extra tournament endpoints for international events (Olympics, World Juniors, World Championships) */
  espnTournaments?: string[] | undefined;
  /** noun for a period of play, used in TTS and labels */
  periodNoun: string;
  /** regulation periods, for ordinal labels */
  regulation: number;
  minDelta: number;
  /** off by default: enable it in the dashboard's league settings */
  optIn?: boolean | undefined;
}

export const LEAGUES: LeagueDef[] = [
  { id: "nhl", name: "NHL", sport: "hockey", espn: "hockey/nhl", periodNoun: "period", regulation: 3, minDelta: 1 },
  {
    id: "iihf",
    name: "IIHF",
    sport: "hockey",
    espn: "hockey/olympics-mens-ice-hockey",
    espnTournaments: [
      "hockey/olympics-mens-ice-hockey",
      "hockey/olympics-womens-ice-hockey",
      "hockey/hockey-world-cup",
    ],
    periodNoun: "period",
    regulation: 3,
    minDelta: 1,
    optIn: false,
  },
  { id: "ahl", name: "AHL", sport: "hockey", espn: "hockey/ahl", periodNoun: "period", regulation: 3, minDelta: 1, optIn: true },
];

/** Regulation period length in seconds (20 min = 1200), and overtime length (5 min = 300). */
export function periodSeconds(_league: LeagueDef, period: number): number {
  return period <= 3 ? 1200 : 300;
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
  if (n <= 3) return `${ordinal(n)} ${league.periodNoun}`;
  return n === 4 ? "overtime" : n === 5 ? "shootout" : `${n - 3}OT`;
}

/** A hockey shootout (period 5+) has no continuous game clock. */
export const isShootout = (_league: LeagueDef, period: number): boolean => period >= 5;
