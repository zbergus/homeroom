import { leagueById, periodLabel } from "../leagues.js";
import type { Game, Rgb, Team } from "../types.js";

/** Synthetic NHL game id for the in-app dashboard simulation (never sticky across restarts). */
export const SIM_GAME_ID = "nhl:sim";

/** Wall-clock hard stop even if the scripted sequence has not finished. */
export const SIM_MAX_MS = 10 * 60_000;

/** Gap between scripted alert steps. */
export const SIM_STEP_MS = 6_000;

export type SimulationState = {
  active: boolean;
  game_id?: string | undefined;
  started_at?: number | undefined;
  ends_at?: number | undefined;
  step_index?: number | undefined;
};

export type SimStep =
  | { type: "game_start" }
  | { type: "period_start"; period: number }
  | { type: "powerplay" }
  | { type: "goal"; side: "home" | "away" }
  | { type: "period_end"; period: number }
  | { type: "game_end" };

/** Scripted fake live NHL sequence through the real alert path. */
export const SIM_STEPS: readonly SimStep[] = [
  { type: "game_start" },
  { type: "period_start", period: 1 },
  { type: "powerplay" },
  { type: "goal", side: "home" },
  { type: "period_end", period: 1 },
  { type: "period_start", period: 2 },
  { type: "goal", side: "away" },
  { type: "game_end" },
];

const WHITE: Rgb = { r: 255, g: 255, b: 255 };

function mkTeam(abbr: string, name: string, color: Rgb): Team {
  return {
    id: abbr,
    abbr,
    name,
    display_name: name,
    logo: "",
    score: 0,
    options: { primary_color_rgb: color, secondary_color_rgb: WHITE, alternate_color_rgb: WHITE },
  };
}

/** Build the synthetic NHL game; prefer a favourite team's branding when available. */
export function buildSimGame(fav?: { abbr: string; name?: string | undefined } | undefined): Game {
  const league = leagueById("nhl");
  const homeAbbr = (fav?.abbr || "HOME").toUpperCase();
  const homeName = fav?.name || (homeAbbr === "MTL" ? "Montreal Canadiens" : homeAbbr === "HOME" ? "Home Team" : homeAbbr);
  return {
    id: SIM_GAME_ID,
    league: "nhl",
    sport: "hockey",
    status: "in",
    start_time: new Date().toISOString(),
    period: 1,
    period_label: periodLabel(league, 1),
    clock: "12:00",
    intermission: false,
    home: mkTeam(homeAbbr, homeName, { r: 175, g: 30, b: 45 }),
    away: mkTeam("SJS", "San Jose Sharks", { r: 0, g: 98, b: 114 }),
    linescores: { home: [], away: [] },
    stats: { home: {}, away: {} },
    goals: [],
  };
}

export function idleSimulationState(): SimulationState {
  return { active: false };
}
