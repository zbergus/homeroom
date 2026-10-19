import { describe, expect, it } from "vitest";
import { elapsed, parseClock, suggestDelay } from "../src/engine/calibrate.js";

describe("calibration", () => {
  it("parses TV clock text", () => {
    expect(parseClock("12:34")).toBe(754);
    expect(parseClock(" 0:42.5 ")).toBe(42.5);
    expect(parseClock("5:07")).toBe(307);
    expect(parseClock("abc")).toBeUndefined();
    expect(parseClock("12:7")).toBeUndefined();
  });

  it("converts (period, clock) to elapsed time per sport", () => {
    expect(elapsed("nhl", 1, 1200, "down")).toBe(0);
    expect(elapsed("nhl", 2, 754, "down")).toBe(1200 + 446);
    expect(elapsed("nba", 3, 720, "down")).toBe(1440);
    expect(elapsed("nfl", 2, 0, "down")).toBe(1800);
    expect(elapsed("epl", 2, 3010, "up")).toBe(3010);
  });

  it("hockey: feed at 2nd 12:34 (running, 0 s old), TV shows 2nd 12:50 => 16 s delay", () => {
    const s = suggestDelay({ league: "nhl", period: 2, clock_s: 754, clock_running: true, clock_dir: "down", age_s: 0 }, { period: 2, clock_s: 770 });
    expect(s.delay_s).toBe(16);
    expect(s.warning).toBeUndefined();
  });

  it("advances a running feed clock by its age (a 2 s old snapshot is 2 s further on)", () => {
    const s = suggestDelay({ league: "nhl", period: 2, clock_s: 754, clock_running: true, clock_dir: "down", age_s: 2 }, { period: 2, clock_s: 770 });
    expect(s.delay_s).toBe(18);
  });

  it("works across a period boundary", () => {
    // feed: 2nd 19:50 left => elapsed 1210; TV still in 1st with 0:10 left => elapsed 1190... delay 20
    const s = suggestDelay({ league: "nhl", period: 2, clock_s: 1190, clock_running: true, clock_dir: "down", age_s: 0 }, { period: 1, clock_s: 10 });
    expect(s.delay_s).toBe(20);
  });

  it("soccer counts up", () => {
    const s = suggestDelay({ league: "epl", period: 1, clock_s: 1500, clock_running: true, clock_dir: "up", age_s: 0 }, { period: 1, clock_s: 1480 });
    expect(s.delay_s).toBe(20);
  });

  it("warns on a stopped clock, a TV ahead of the feed, and an out-of-range result; clamps to 0..120 in 0.5 steps", () => {
    const stopped = suggestDelay({ league: "nhl", period: 1, clock_s: 600, clock_running: false, clock_dir: "down", age_s: 0 }, { period: 1, clock_s: 610 });
    expect(stopped.warning).toMatch(/stopped/);
    const ahead = suggestDelay({ league: "nhl", period: 1, clock_s: 600, clock_running: true, clock_dir: "down", age_s: 0 }, { period: 1, clock_s: 500 });
    expect(ahead.delay_s).toBe(0);
    expect(ahead.warning).toMatch(/ahead of the data feed/);
    const huge = suggestDelay({ league: "nhl", period: 2, clock_s: 100, clock_running: true, clock_dir: "down", age_s: 0 }, { period: 1, clock_s: 1000 });
    expect(huge.delay_s).toBe(120);
    expect(huge.warning).toMatch(/over 120/);
    const odd = suggestDelay({ league: "nhl", period: 1, clock_s: 600, clock_running: true, clock_dir: "down", age_s: 0.3 }, { period: 1, clock_s: 610.4 });
    expect(Number.isInteger(odd.delay_s * 2)).toBe(true);
  });
});
