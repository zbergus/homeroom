import { leagueById, periodSeconds } from "../leagues.js";

export interface RawClock {
  league: string;
  period: number;
  clock_s: number;
  clock_running: boolean;
  clock_dir: "down" | "up";
  /** how long ago (s) the provider value was received; the clock is advanced by this much if it is running */
  age_s: number;
}

export interface Reading {
  period: number;
  /** seconds on the game clock as the TV shows them (down: remaining, up: elapsed) */
  clock_s: number;
}

/** Total elapsed game time in seconds for a (period, clock) reading. */
export function elapsed(league: string, period: number, clock_s: number, dir: "down" | "up"): number {
  if (dir === "up") return clock_s; // soccer: cumulative
  const l = leagueById(league);
  let before = 0;
  for (let p = 1; p < period; p++) before += periodSeconds(l, p);
  return before + (periodSeconds(l, period) - clock_s);
}

/** "12:34" / "5:07" / "0:42.5" -> seconds. Returns undefined when it is not a clock. */
export function parseClock(text: string): number | undefined {
  const m = /^\s*(\d{1,3}):(\d{2})(?:\.(\d))?\s*$/.exec(text);
  if (!m) return undefined;
  return Number(m[1]) * 60 + Number(m[2]) + (m[3] ? Number(m[3]) / 10 : 0);
}

export interface Suggestion {
  delay_s: number;
  /** raw delay before rounding/clamping, for display */
  measured_s: number;
  /** honest error bar: provider latency plus poll interval */
  uncertainty_s: number;
  warning?: string;
}

/**
 * The live game is ahead of what you see on TV by `delay`: delay = elapsed(now, live feed) - elapsed(TV reading).
 * Only meaningful while play is live, because the feed's clock is a snapshot that we advance by its age.
 */
export function suggestDelay(raw: RawClock, tv: Reading): Suggestion {
  const live_clock = raw.clock_running ? (raw.clock_dir === "down" ? raw.clock_s - raw.age_s : raw.clock_s + raw.age_s) : raw.clock_s;
  const live = elapsed(raw.league, raw.period, Math.max(0, live_clock), raw.clock_dir);
  const seen = elapsed(raw.league, tv.period, tv.clock_s, raw.clock_dir);
  const measured = live - seen;
  const delay = Math.min(120, Math.max(0, Math.round(measured * 2) / 2));
  const out: Suggestion = { delay_s: delay, measured_s: measured, uncertainty_s: 2.5 };
  if (!raw.clock_running) out.warning = "The game clock is stopped right now, so this reading is less reliable. Try again while play is live.";
  else if (measured < -2) out.warning = "Your TV is ahead of the data feed, which cannot be corrected with a delay. Re-check the clock you typed.";
  else if (measured > 120) out.warning = "Measured delay is over 120 s; the maximum is 120 s. Check the period and clock you typed.";
  return out;
}
