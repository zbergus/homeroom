import type { Game } from "../types.js";

type Clock = Pick<Game, "id" | "period" | "clock_s" | "clock_running" | "clock_dir" | "status" | "intermission">;
interface Observation extends Clock {
  at: number;
}

interface Reading {
  period: number;
  clock_s: number;
}

/** "12:34" / "5:07" / "0:42.5" -> seconds. */
export function parseClock(text: string): number | undefined {
  const m = /^\s*(\d{1,3}):(\d{2})(?:\.(\d))?\s*$/.exec(text);
  if (!m || Number(m[2]) >= 60) return undefined;
  return Number(m[1]) * 60 + Number(m[2]) + (m[3] ? Number(m[3]) / 10 : 0);
}

export interface Suggestion {
  delay_s: number;
  /** Wall-clock delay before rounding/clamping. */
  measured_s: number;
  /** Sampling, clock quantization and rounding error; not a provider-latency measurement. */
  uncertainty_s: number;
  warning?: string;
}

const RETENTION_MS = 150_000;
const MAX_OBSERVATIONS = 1024;
const MAX_GAP_S = 10;
const CLOCK_TOLERANCE_S = 1;
const MAX_MATCH_SPAN_S = 2.5;

function usable(o: Clock): o is Clock & { clock_s: number; clock_dir: "up" | "down" } {
  return o.status === "in" && !o.intermission && o.period >= 1
    && o.clock_s !== undefined && Number.isFinite(o.clock_s) && o.clock_s >= 0
    && (o.clock_dir === "up" || o.clock_dir === "down");
}

/** Timestamped provider observations, never extrapolated across stoppages or missing polls. */
export class ClockHistory {
  private readonly games = new Map<string, Observation[]>();

  delete(gameId: string): void {
    this.games.delete(gameId);
  }

  record(game: Clock, now: number): void {
    if (!Number.isFinite(now)) return;
    this.prune(now);
    const history = this.games.get(game.id) ?? [];
    const last = history.at(-1);
    if (last && now < last.at) return;
    const observation: Observation = {
      id: game.id, period: game.period, clock_s: game.clock_s, clock_dir: game.clock_dir,
      clock_running: game.clock_running, status: game.status, intermission: game.intermission, at: now,
    };
    if (last?.at === now) history[history.length - 1] = observation;
    else history.push(observation);
    if (history.length > MAX_OBSERVATIONS) history.splice(0, history.length - MAX_OBSERVATIONS);
    this.games.set(game.id, history);
  }

  suggest(gameId: string, tv: Reading, now: number): Suggestion | undefined {
    if (!Number.isFinite(now) || !Number.isInteger(tv.period) || tv.period < 1 || !Number.isFinite(tv.clock_s) || tv.clock_s < 0) return undefined;
    this.prune(now);
    const history = this.games.get(gameId) ?? [];
    let earliest = Infinity;
    let latest = -Infinity;
    let sampling = 0;
    let runningMatch = false;
    const match = (from: number, to: number) => {
      earliest = Math.min(earliest, from);
      latest = Math.max(latest, to);
    };
    for (let i = 0; i < history.length; i++) {
      const b = history[i];
      if (!b || b.at > now || b.period !== tv.period) continue;
      // Repeated stopped readings must widen the match, not masquerade as one instant.
      if (b.status === "in" && b.clock_s !== undefined && Math.abs(b.clock_s - tv.clock_s) <= CLOCK_TOLERANCE_S) match(b.at, b.at);
      if (!usable(b)) continue;
      const a = history[i - 1];
      if (!a || !usable(a) || !a.clock_running || !b.clock_running || a.period !== b.period || a.clock_dir !== b.clock_dir) continue;
      const gap = (b.at - a.at) / 1000;
      const direction = b.clock_dir === "up" ? 1 : -1;
      const movement = (b.clock_s - a.clock_s) * direction;
      if (gap <= 0 || gap > MAX_GAP_S || movement <= 0 || Math.abs(movement - gap) > CLOCK_TOLERANCE_S) continue;
      const target = (tv.clock_s - a.clock_s) * direction;
      const from = Math.max(0, (target - CLOCK_TOLERANCE_S) / movement);
      const to = Math.min(1, (target + CLOCK_TOLERANCE_S) / movement);
      if (from > to) continue;
      match(a.at + from * gap * 1000, a.at + to * gap * 1000);
      sampling = Math.max(sampling, gap / 2);
      runningMatch = true;
    }
    if (!runningMatch || (latest - earliest) / 1000 > MAX_MATCH_SPAN_S) return undefined;
    const measured = (now - (earliest + latest) / 2) / 1000;
    const suggestion: Suggestion = {
      delay_s: Math.min(120, Math.max(0, Math.round(measured * 2) / 2)),
      measured_s: measured,
      uncertainty_s: Math.ceil(Math.max((latest - earliest) / 2000, sampling + CLOCK_TOLERANCE_S + 0.25) * 2) / 2,
    };
    if (measured > 120) suggestion.warning = "Measured delay is over 120 s; the maximum is 120 s. Check the period and clock you typed.";
    return suggestion;
  }

  private prune(now: number): void {
    for (const [id, history] of this.games) {
      const first = history.findIndex((o) => o.at >= now - RETENTION_MS);
      if (first === -1) this.games.delete(id);
      else if (first > 0) history.splice(0, first);
    }
  }
}
