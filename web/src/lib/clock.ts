// Game clock helper (stable API, also used by the dashboard calibrator).
//
//   interpolateClock(game, receivedAtMs, nowMs) -> { seconds: number | null, text: string }
//     Pure. If clock_running is true and clock_s is a number, returns clock_s moved by
//     time since its replay anchor in clock_dir ("down" default / "up"), with soft deceleration past 12 s
//     and a 21 s cap (12 s linear + 9 s at half speed), formatted
//     M:SS (H:MM:SS from one hour for count-down; count-up clocks stay M:SS, e.g. soccer 67:13). Otherwise returns the server's `clock` string unchanged
//     (seconds = clock_s ?? null).
//   useGameClock(game, tickMs = 250) -> { seconds, text, running }
//     Hook. Records the moment the clock fields (clock, clock_s, clock_running, clock_dir) last
//     changed, and re-renders every tickMs while the clock is running. Safe with undefined game.
import { useEffect, useRef, useState } from "react";
import type { Game } from "../types";

type ClockFields = Pick<Game, "clock"> & Partial<Pick<Game, "id" | "period" | "clock_s" | "clock_running" | "clock_dir" | "clock_at_ms">>;

const LINEAR_ADVANCE_S = 12;
const MAX_ADVANCE_S = 30;

/** Preserve snapshot age without requiring the kiosk's clock to match the server's. */
export function localClock(game: Game, serverNowMs: number | undefined, receivedAtMs: number): Game {
  if (!Number.isFinite(serverNowMs) || !Number.isFinite(game.clock_at_ms)) return game;
  return { ...game, clock_at_ms: receivedAtMs - ((serverNowMs ?? 0) - (game.clock_at_ms ?? 0)) };
}

interface ClockReading { seconds: number | null; text: string }

function formatClock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60;
  const p = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${p(m)}:${p(ss)}` : `${m}:${p(ss)}`;
}

export function interpolateClock(game: ClockFields, receivedAtMs: number, nowMs: number): ClockReading {
  const base = game.clock_s;
  if (!game.clock_running || typeof base !== "number" || !Number.isFinite(base)) {
    return { seconds: typeof base === "number" && Number.isFinite(base) ? base : null, text: game.clock ?? "" };
  }
  const anchor = typeof game.clock_at_ms === "number" && Number.isFinite(game.clock_at_ms) ? game.clock_at_ms : receivedAtMs;
  const rawElapsed = Math.max(0, nowMs - anchor) / 1000;
  // Soft deceleration when polling lags:
  // - 0s to 12s (LINEAR_ADVANCE_S): 1.0x real-time speed (dt advances 1s per wall-clock second)
  // - 12s to 30s (MAX_ADVANCE_S): gently decelerates (0.5x) so clock slows down instead of freezing abruptly
  // - Max advance capped at 21s total (12s + 18s*0.5)
  const dt = rawElapsed <= LINEAR_ADVANCE_S
    ? rawElapsed
    : LINEAR_ADVANCE_S + Math.min(MAX_ADVANCE_S - LINEAR_ADVANCE_S, rawElapsed - LINEAR_ADVANCE_S) * 0.5;
  const seconds = Math.max(0, base - dt);
  return { seconds, text: formatClock(Math.ceil(seconds)) };
}

/**
 * Seconds to blend out after a re-anchor: where the old snapshot said the clock was, minus
 * where the new one says it is. `prev` must be the previous snapshot; comparing a snapshot to
 * itself always yields zero (the bug that made the 1.2 s slew inert).
 */
export function reanchorSlew(prev: ClockFields | undefined, next: ClockFields | undefined, prevReceivedAt: number, nowMs: number): number {
  if (!prev || !next || !next.clock_running || typeof next.clock_s !== "number") return 0;
  const before = interpolateClock(prev, prevReceivedAt, nowMs).seconds;
  const after = interpolateClock(next, nowMs, nowMs).seconds;
  if (before === null || after === null) return 0;
  const diff = before - after;
  return Math.abs(diff) > 0.05 && Math.abs(diff) <= 2.5 ? diff : 0;
}

export function useGameClock(game: ClockFields | undefined, tickMs = 250): ClockReading & { running: boolean } {
  // Sig deliberately excludes `clock` (the formatted string) because that changes every server
  // poll tick and would reset the local anchor, causing the displayed clock to stutter/jump back
  // on each update. We only re-anchor when the underlying numeric state changes (new period,
  // clock_s value, running flag, direction, or the server's clock_at_ms anchor).
  const sig = game ? `${game.id}|${game.period}|${game.clock_s}|${game.clock_running}|${game.clock_dir}|${game.clock_at_ms}` : "";
  const at = useRef({ sig, t: Date.now() });

  // Slewing/smoothing ref across anchor transitions
  // If the new target clock differs slightly (e.g. <= 2.5s) from where we currently are,
  // we smoothly blend the difference over ~1.2s instead of snapping instantly.
  const slew = useRef<{ offset: number; startedAt: number; durationMs: number }>({ offset: 0, startedAt: 0, durationMs: 0 });
  /** Previous snapshot, needed to know where the clock was before this re-anchor. */
  const prevGame = useRef<ClockFields | undefined>(undefined);

  const running = !!game?.clock_running && typeof game?.clock_s === "number";
  const [now, setNow] = useState(() => Date.now());

  if (at.current.sig !== sig) {
    if (game && running) {
      const t = Date.now();
      const offset = reanchorSlew(prevGame.current, game, at.current.t, t);
      at.current = { sig, t };
      // If small difference (between -2.5s and +2.5s), blend smoothly over 1200ms
      slew.current = offset !== 0 ? { offset, startedAt: t, durationMs: 1200 } : { offset: 0, startedAt: 0, durationMs: 0 };
    } else {
      at.current = { sig, t: Date.now() };
      slew.current = { offset: 0, startedAt: 0, durationMs: 0 };
    }
  }
  prevGame.current = game;

  useEffect(() => {
    if (!running) return;
    const i = setInterval(() => setNow(Date.now()), tickMs);
    return () => clearInterval(i);
  }, [running, tickMs]);

  if (!game) return { seconds: null, text: "", running: false };

  const reading = interpolateClock(game, at.current.t, Math.max(now, at.current.t));
  if (reading.seconds === null || !running || slew.current.offset === 0) {
    return { ...reading, running };
  }

  // Apply decayed slew offset
  const elapsedSlew = Math.max(0, now - slew.current.startedAt);
  if (elapsedSlew >= slew.current.durationMs) {
    slew.current.offset = 0;
    return { ...reading, running };
  }

  const factor = 1 - elapsedSlew / slew.current.durationMs;
  const smoothedSeconds = Math.max(0, reading.seconds + slew.current.offset * factor);
  return { seconds: smoothedSeconds, text: formatClock(Math.ceil(smoothedSeconds)), running };
}
