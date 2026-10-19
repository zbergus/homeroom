// Game clock helper (stable API, also used by the dashboard calibrator).
//
//   interpolateClock(game, receivedAtMs, nowMs) -> { seconds: number | null, text: string }
//     Pure. If clock_running is true and clock_s is a number, returns clock_s moved by
//     (nowMs - receivedAtMs) in clock_dir ("down" default / "up"), clamped at 0, formatted
//     M:SS (H:MM:SS from one hour for count-down; count-up clocks stay M:SS, e.g. soccer 67:13). Otherwise returns the server's `clock` string unchanged
//     (seconds = clock_s ?? null).
//   useGameClock(game, tickMs = 250) -> { seconds, text, running }
//     Hook. Records the moment the clock fields (clock, clock_s, clock_running, clock_dir) last
//     changed, and re-renders every tickMs while the clock is running. Safe with undefined game.
import { useEffect, useRef, useState } from "react";
import type { Game } from "../types";

type ClockFields = Pick<Game, "clock"> & Partial<Pick<Game, "clock_s" | "clock_running" | "clock_dir">>;

interface ClockReading { seconds: number | null; text: string }

function formatClock(totalSeconds: number, minutesOnly = false): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60;
  const p = (n: number) => String(n).padStart(2, "0");
  if (minutesOnly) return `${Math.floor(s / 60)}:${p(ss)}`; // count-up clocks (soccer): 67:13, not 1:07:13
  return h > 0 ? `${h}:${p(m)}:${p(ss)}` : `${m}:${p(ss)}`;
}

function interpolateClock(game: ClockFields, receivedAtMs: number, nowMs: number): ClockReading {
  const base = game.clock_s;
  if (!game.clock_running || typeof base !== "number" || !Number.isFinite(base)) {
    return { seconds: typeof base === "number" && Number.isFinite(base) ? base : null, text: game.clock ?? "" };
  }
  const dt = Math.max(0, nowMs - receivedAtMs) / 1000;
  const up = game.clock_dir === "up";
  const seconds = Math.max(0, up ? base + dt : base - dt);
  // down: show ceil (8:42 stays until it really hits 8:41.x); up: floor
  return { seconds, text: up ? formatClock(seconds, true) : formatClock(Math.ceil(seconds)) };
}

export function useGameClock(game: ClockFields | undefined, tickMs = 250): ClockReading & { running: boolean } {
  const sig = game ? `${game.clock}|${game.clock_s}|${game.clock_running}|${game.clock_dir}` : "";
  const at = useRef({ sig, t: Date.now() });
  if (at.current.sig !== sig) at.current = { sig, t: Date.now() };
  const running = !!game?.clock_running && typeof game?.clock_s === "number";
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return;
    const i = setInterval(() => setNow(Date.now()), tickMs);
    return () => clearInterval(i);
  }, [running, tickMs]);
  if (!game) return { seconds: null, text: "", running: false };
  return { ...interpolateClock(game, at.current.t, Math.max(now, at.current.t)), running };
}
