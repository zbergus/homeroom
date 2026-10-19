export type Strength = "ev" | "pp" | "sh" | "en";

/** Normalise provider strings ("even-strength", "power-play", "Short Handed", "pp", ...) to ev | pp | sh | en. */
export function normStrength(raw?: string, emptyNet = false): Strength | undefined {
  if (emptyNet) return "en";
  const r = (raw ?? "").toLowerCase().replace(/[^a-z]/g, "");
  if (!r) return undefined;
  if (r === "ev" || r.startsWith("even")) return "ev";
  if (r === "pp" || r.startsWith("power")) return "pp";
  if (r === "sh" || r.startsWith("short")) return "sh";
  if (r === "en" || r.includes("empty")) return "en";
  return undefined;
}

/**
 * NHL situationCode is 4 digits: [away goalie][away skaters][home skaters][home goalie] (1 = goalie in net).
 * Strength from the scoring team's point of view.
 */
export function strengthFromSituation(code: string | undefined, scorerIsHome: boolean): Strength | undefined {
  if (!code || !/^\d{4}$/.test(code)) return undefined;
  const [ag, as, hs, hg] = code.split("").map(Number);
  const own = scorerIsHome ? hs : as;
  const opp = scorerIsHome ? as : hs;
  const ownGoalie = scorerIsHome ? hg : ag;
  const oppGoalie = scorerIsHome ? ag : hg;
  if (oppGoalie === 0) return "en";
  // the scorer pulled its own goalie for an extra attacker (e.g. a delayed penalty): that is not a power-play goal
  if (ownGoalie === 0) return "ev";
  if (own > opp) return "pp";
  if (own < opp) return "sh";
  return "ev";
}

export interface ParsedSituation {
  home_skaters: number;
  away_skaters: number;
  home_goalie: boolean;
  away_goalie: boolean;
  /** side with more skaters while both goalies are in net; a pulled goalie (extra attacker) is not a power play */
  advantage: "home" | "away" | null;
}

/** Full read of an NHL situationCode ([away goalie][away skaters][home skaters][home goalie]). */
export function parseSituation(code: string | undefined): ParsedSituation | undefined {
  if (!code || !/^\d{4}$/.test(code)) return undefined;
  const [ag, as, hs, hg] = code.split("").map(Number);
  const bothGoalies = ag > 0 && hg > 0;
  return {
    home_skaters: hs,
    away_skaters: as,
    home_goalie: hg > 0,
    away_goalie: ag > 0,
    advantage: bothGoalies && hs > as ? "home" : bothGoalies && as > hs ? "away" : null,
  };
}
