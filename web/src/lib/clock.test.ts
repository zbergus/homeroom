import { describe, expect, it } from "vitest";
import { interpolateClock, localClock } from "./clock";
import type { Game } from "../types";

describe("delayed clock playback", () => {
  it("ticks from the delayed replay anchor, not the original live observation", () => {
    const game = { clock: "10:00", clock_s: 600, clock_running: true, clock_at_ms: 36000 };
    expect(interpolateClock(game, 36000, 38000).text).toBe("9:58");
  });

  it("replays a whistle, a long pause, and a restart without consuming stopped time", () => {
    const stopped = { clock: "9:56", clock_s: 596, clock_running: false, clock_at_ms: 40000 };
    expect(interpolateClock(stopped, 40000, 65000).text).toBe("9:56");
    const resumed = { ...stopped, clock_running: true, clock_at_ms: 66000 };
    expect(interpolateClock(resumed, 66000, 68000).text).toBe("9:54");
  });

  it("does not restart an old clock when reconnecting or receiving enrichment", () => {
    const game = { clock: "9:00", clock_s: 540, clock_running: true, clock_at_ms: 37000 };
    expect(interpolateClock(game, 40000, 42000).text).toBe("8:55");
  });

  it("preserves replay age on kiosks ahead of or behind the server clock", () => {
    const game = { clock: "9:00", clock_s: 540, clock_running: true, clock_at_ms: 37000 } as Game;
    for (const skew of [-30000, 30000]) {
      const receivedAt = 40000 + skew;
      const local = localClock(game, 40000, receivedAt);
      expect(interpolateClock(local, receivedAt, receivedAt + 2000).text).toBe("8:55");
    }
    expect(game.clock_at_ms).toBe(37000);
    expect(localClock(game, undefined, 40000)).toBe(game);
  });

  it("bounds stale extrapolation and never goes below zero", () => {
    const game = { clock: "10:00", clock_s: 600, clock_running: true, clock_at_ms: 36000 };
    expect(interpolateClock(game, 36000, 360000).seconds).toBe(590);
    expect(interpolateClock({ ...game, clock_s: 2 }, 36000, 50000).seconds).toBe(0);
  });

  it("supports legacy snapshots, fractional clocks, missing data, and future anchors", () => {
    expect(interpolateClock({ clock: "1:00", clock_s: 60, clock_running: true }, 1000, 2500).text).toBe("0:59");
    expect(interpolateClock({ clock: "0:42.5", clock_s: 42.5, clock_running: false }, 0, 2000).text).toBe("0:42.5");
    expect(interpolateClock({ clock: "" }, 0, 2000).seconds).toBeNull();
    expect(interpolateClock({ clock: "1:00", clock_s: 60, clock_running: true, clock_at_ms: 5000 }, 0, 2000).text).toBe("1:00");
  });
});
