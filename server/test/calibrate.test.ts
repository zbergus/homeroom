import { describe, expect, it } from "vitest";
import { ClockHistory, parseClock } from "../src/engine/calibrate.js";
import type { Game } from "../src/types.js";

type Clock = Parameters<ClockHistory["record"]>[0];
const clock = (clock_s: number, over: Partial<Game> = {}): Clock => ({
  id: "nhl:7", period: 2, clock_s, clock_running: true, clock_dir: "down",
  status: "in", intermission: false, ...over,
});
const reading = (clock_s: number, period = 2) => ({ period, clock_s });

describe("calibration", () => {
  it("parses valid TV clock text and rejects invalid seconds", () => {
    expect(parseClock("12:34")).toBe(754);
    expect(parseClock(" 0:42.5 ")).toBe(42.5);
    expect(parseClock("5:07")).toBe(307);
    expect(parseClock("105:59")).toBe(6359);
    for (const text of ["abc", "12:7", "1:60", "12:99.5", "-1:20", "1:23.45"]) expect(parseClock(text)).toBeUndefined();
  });

  it("measures a real 36 second delay across a whistle, long stoppage and restart", () => {
    const history = new ClockHistory();
    for (const [at, value] of [[0, 800], [4, 796], [8, 792]] as const) {
      history.record(clock(value), at * 1000);
    }
    for (const at of [10, 14, 20, 30, 40]) history.record(clock(790, { clock_running: false }), at * 1000);
    for (const [at, value] of [[44, 786], [48, 782], [52, 778]] as const) history.record(clock(value), at * 1000);
    // The live clock is stopped, but the TV is still ticking before the whistle.
    expect(history.suggest("nhl:7", reading(794), 42_000)?.measured_s).toBe(36);
    // The same offset remains correct after play resumes.
    expect(history.suggest("nhl:7", reading(782), 84_000)?.delay_s).toBe(36);
    expect(history.suggest("nhl:7", reading(790), 84_000)).toBeUndefined();
  });

  it("interpolates only short, confirmed running observations and reports sampling uncertainty", () => {
    const history = new ClockHistory();
    history.record(clock(800), 0);
    history.record(clock(796), 4000);
    const suggestion = history.suggest("nhl:7", reading(798), 38_000);
    expect(suggestion?.delay_s).toBe(36);
    expect(suggestion?.uncertainty_s).toBeGreaterThanOrEqual(3);
    expect(suggestion?.warning).toBeUndefined();
  });

  it("handles upward clocks and matches the historical period rather than the current period", () => {
    const history = new ClockHistory();
    history.record(clock(1496, { clock_dir: "up", period: 1 }), 0);
    history.record(clock(1500, { clock_dir: "up", period: 1 }), 4000);
    history.record(clock(2700, { clock_dir: "up", period: 2 }), 10_000);
    expect(history.suggest("nhl:7", reading(1498, 1), 38_000)?.delay_s).toBe(36);
    expect(history.suggest("nhl:7", reading(1498, 2), 38_000)).toBeUndefined();
  });

  it("rejects missing, insufficient, future and unmatched history instead of subtracting clocks", () => {
    const history = new ClockHistory();
    expect(history.suggest("nhl:7", reading(798), 38_000)).toBeUndefined();
    history.record(clock(800), 0);
    expect(history.suggest("nhl:7", reading(800), 38_000)).toBeUndefined();
    history.record(clock(796), 4000);
    expect(history.suggest("nhl:other", reading(798), 38_000)).toBeUndefined();
    expect(history.suggest("nhl:7", reading(700), 38_000)).toBeUndefined();
    expect(history.suggest("nhl:7", reading(798), 1000)).toBeUndefined();
    expect(history.suggest("nhl:7", reading(Number.NaN), 38_000)).toBeUndefined();
  });

  it.each([
    ["long gap", 11, clock(789)],
    ["provider jump", 4, clock(700)],
    ["wrong direction", 4, clock(804)],
    ["direction change", 4, clock(796, { clock_dir: "up" })],
    ["period change", 4, clock(796, { period: 3 })],
    ["stopped", 4, clock(796, { clock_running: false })],
    ["unknown running", 4, clock(796, { clock_running: undefined })],
    ["intermission", 4, clock(796, { intermission: true })],
    ["postgame", 4, clock(796, { status: "post" })],
  ])("does not bridge a %s", (_label, seconds, next) => {
    const history = new ClockHistory();
    history.record(clock(800), 0);
    history.record(next, seconds * 1000);
    expect(history.suggest("nhl:7", reading(798), 38_000)).toBeUndefined();
  });

  it("retains missing-clock observations as interpolation barriers", () => {
    const history = new ClockHistory();
    history.record(clock(800), 0);
    history.record(clock(798, { clock_s: undefined }), 2000);
    history.record(clock(796), 4000);
    expect(history.suggest("nhl:7", reading(798), 38_000)).toBeUndefined();
  });

  it("rejects repeated stopped readings even if a running segment also matches", () => {
    const history = new ClockHistory();
    history.record(clock(802), 0);
    history.record(clock(798), 4000);
    history.record(clock(798, { clock_running: false }), 5000);
    history.record(clock(798, { clock_running: false }), 30_000);
    expect(history.suggest("nhl:7", reading(798), 40_000)).toBeUndefined();
  });

  it("treats an intermission's repeated clock as ambiguous, not a unique period-end instant", () => {
    const history = new ClockHistory();
    history.record(clock(4), 0);
    history.record(clock(0), 4000);
    history.record(clock(0, { intermission: true, clock_running: false }), 20_000);
    expect(history.suggest("nhl:7", reading(0), 40_000)).toBeUndefined();
  });

  it("rejects separate matching instants after a clock correction", () => {
    const history = new ClockHistory();
    for (const [at, value] of [[0, 800], [4, 796], [10, 800], [14, 796]] as const) history.record(clock(value), at * 1000);
    expect(history.suggest("nhl:7", reading(798), 40_000)).toBeUndefined();
  });

  it("accepts normal one-second quantization without accepting long plateaus", () => {
    const history = new ClockHistory();
    for (let i = 0; i <= 20; i++) history.record(clock(800 - Math.floor(i / 2)), i * 500);
    const suggestion = history.suggest("nhl:7", reading(795), 41_250);
    expect(suggestion?.delay_s).toBe(36);
    expect(suggestion?.uncertainty_s).toBeGreaterThanOrEqual(1);
    for (let i = 21; i <= 30; i++) history.record(clock(790), i * 500);
    expect(history.suggest("nhl:7", reading(790), 41_250)).toBeUndefined();
  });

  it("keeps half-second steps, clamps over 120 seconds with a warning, and expires old history", () => {
    const history = new ClockHistory();
    history.record(clock(800), 0);
    history.record(clock(796), 4000);
    const rounded = history.suggest("nhl:7", reading(798), 38_300);
    expect(rounded?.measured_s).toBeCloseTo(36.3);
    expect(rounded?.delay_s).toBe(36.5);
    const capped = history.suggest("nhl:7", reading(798), 132_000);
    expect(capped?.delay_s).toBe(120);
    expect(capped?.warning).toMatch(/over 120/);
    expect(history.suggest("nhl:7", reading(798), 155_000)).toBeUndefined();
  });

  it("copies observations and ignores out-of-order timestamps", () => {
    const history = new ClockHistory();
    const first = clock(800);
    history.record(first, 0);
    first.clock_s = 700;
    history.record(clock(796), 4000);
    history.record(clock(100), 1000);
    expect(history.suggest("nhl:7", reading(798), 38_000)?.delay_s).toBe(36);
    history.delete("nhl:7");
    expect(history.suggest("nhl:7", reading(798), 38_000)).toBeUndefined();
  });
});
