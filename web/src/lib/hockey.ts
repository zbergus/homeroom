import type { Game, SkaterStats } from "../types";
import { shortPeriod } from "./format";

/**
 * Power play text label for a given side: "PP 5v4", "PP 5v3", "PP 4v3", or "PP".
 * Supports either side as "away"|"home" or scoreboard left/right "l"|"r".
 */
export function powerPlayFor(g: Game, side: "away" | "home" | "l" | "r"): string | null {
  if (g.status !== "in" || !g.situation) return null;
  const isAway = side === "away" || side === "l";
  const mySide = isAway ? "away" : "home";
  const isAdv = g.situation.advantage === mySide;
  if (!isAdv) return null;
  const skAdv = isAway ? g.situation.away_skaters : g.situation.home_skaters;
  const skOpp = isAway ? g.situation.home_skaters : g.situation.away_skaters;
  if (skAdv && skOpp && skAdv > skOpp) return `PP ${skAdv}v${skOpp}`;
  return "PP";
}

/**
 * Single-team perspective situation: returns PP or PK indicator with strength (e.g. PP 5v4 or PK 4v5).
 */
export function singleTeamSituation(g: Game, isHome: boolean): { type: "pp" | "pk"; text: string } | null {
  if (g.status !== "in" || !g.situation) return null;
  const mySide = isHome ? "home" : "away";
  const oppSide = isHome ? "away" : "home";
  const myAdv = g.situation.advantage === mySide;
  const oppAdv = g.situation.advantage === oppSide;
  const mySk = isHome ? g.situation.home_skaters : g.situation.away_skaters;
  const oppSk = isHome ? g.situation.away_skaters : g.situation.home_skaters;

  if (myAdv) {
    if (mySk && oppSk && mySk > oppSk) return { type: "pp", text: `PP ${mySk}v${oppSk}` };
    return { type: "pp", text: "POWER PLAY" };
  }
  if (oppAdv) {
    if (mySk && oppSk && oppSk > mySk) return { type: "pk", text: `PK ${mySk}v${oppSk}` };
    return { type: "pk", text: "PENALTY KILL" };
  }
  return null;
}

/**
 * Shots on goal extractor across all provider variations (sog, stat_rows, or legacy stats).
 */
export function findShots(g: Game): { away: string | number; home: string | number } | null {
  if (typeof g.sog?.away === "number" && typeof g.sog?.home === "number") {
    return { away: g.sog.away, home: g.sog.home };
  }
  const row = g.stat_rows?.find(
    (r) => r.key === "shots" || r.key === "SOG" || r.key === "S" || r.key === "sh" || r.label?.toLowerCase() === "shots",
  );
  if (row) return { away: row.away, home: row.home };
  const as = g.stats?.away?.["SOG"] ?? g.stats?.away?.["S"] ?? g.stats?.away?.["shots"];
  const hs = g.stats?.home?.["SOG"] ?? g.stats?.home?.["S"] ?? g.stats?.home?.["shots"];
  if (as != null && hs != null) return { away: as, home: hs };
  return null;
}

export type AlertKind = "pp" | "empty_net" | "strength" | "intermission";

export interface TickerAlert {
  kind: AlertKind;
  text: string;
  teamAbbr?: string | undefined;
  side?: "away" | "home" | undefined;
}

/**
 * High-priority broadcast situation alert for tickers and banners (Empty Net, Power Play, Intermission).
 */
export function getTickerAlert(game: Game): TickerAlert | null {
  if (game.intermission) {
    const p = shortPeriod(game.period_label).toUpperCase() || "PERIOD";
    const clockText = game.clock && game.clock !== "00:00" && game.clock !== "0:00" ? ` · ${game.clock}` : "";
    return {
      kind: "intermission",
      text: `END ${p}${clockText}`,
    };
  }

  if (game.status !== "in") return null;

  const sit = game.situation;
  if (!sit) return null;

  // Empty net detection
  if (sit.empty_net === "away" || sit.away_skaters === 6) {
    return {
      kind: "empty_net",
      text: "EMPTY NET",
      teamAbbr: game.away.abbr,
      side: "away",
    };
  }
  if (sit.empty_net === "home" || sit.home_skaters === 6) {
    return {
      kind: "empty_net",
      text: "EMPTY NET",
      teamAbbr: game.home.abbr,
      side: "home",
    };
  }
  if (sit.empty_net) {
    return {
      kind: "empty_net",
      text: "EMPTY NET",
    };
  }

  // Power play detection
  if (sit.advantage === "away") {
    const adv = sit.away_skaters;
    const opp = sit.home_skaters;
    const strength = adv && opp && adv > opp ? ` ${adv}v${opp}` : "";
    return {
      kind: "pp",
      text: `PP${strength}`,
      teamAbbr: game.away.abbr,
      side: "away",
    };
  }
  if (sit.advantage === "home") {
    const adv = sit.home_skaters;
    const opp = sit.away_skaters;
    const strength = adv && opp && adv > opp ? ` ${adv}v${opp}` : "";
    return {
      kind: "pp",
      text: `PP${strength}`,
      teamAbbr: game.home.abbr,
      side: "home",
    };
  }

  // Even strength special (4v4, 3v3)
  if (sit.away_skaters === 4 && sit.home_skaters === 4) {
    return {
      kind: "strength",
      text: "4v4",
    };
  }
  if (sit.away_skaters === 3 && sit.home_skaters === 3) {
    return {
      kind: "strength",
      text: "3v3 OT",
    };
  }

  return null;
}

/**
 * Parses MM:SS time-on-ice strings into total seconds.
 */
export function parseToiSeconds(toi: string): number {
  const parts = toi.split(":");
  if (parts.length === 2) {
    const m = Number(parts[0]) || 0;
    const s = Number(parts[1]) || 0;
    return m * 60 + s;
  }
  return 0;
}

export type SkaterSortField = "pts" | "g" | "a" | "sog" | "pm" | "toi";

/**
 * Sorts hockey skaters with intelligent tie-breakers.
 */
export function compareSkaters(
  a: SkaterStats,
  b: SkaterStats,
  field: SkaterSortField,
  dir: "asc" | "desc",
): number {
  let diff = 0;
  if (field === "pts") diff = b.points - a.points || b.goals - a.goals || b.sog - a.sog;
  else if (field === "g") diff = b.goals - a.goals || b.points - a.points || b.sog - a.sog;
  else if (field === "a") diff = b.assists - a.assists || b.points - a.points;
  else if (field === "sog") diff = b.sog - a.sog || b.points - a.points;
  else if (field === "pm") diff = b.plus_minus - a.plus_minus || b.points - a.points;
  else if (field === "toi") diff = parseToiSeconds(b.toi) - parseToiSeconds(a.toi);
  return dir === "asc" ? -diff : diff;
}
