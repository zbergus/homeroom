import { describe, expect, it, vi } from "vitest";
import { Engine } from "../src/engine/engine.js";
import { easternToday, Poller } from "../src/engine/poller.js";
import { Store } from "../src/store.js";
import type { Game, Team } from "../src/types.js";

const rgb = { r: 1, g: 2, b: 3 };
const team = (abbr: string): Team => ({ id: abbr, abbr, name: abbr, display_name: abbr, logo: "", score: 0, options: { primary_color_rgb: rgb, secondary_color_rgb: rgb, alternate_color_rgb: rgb } });
const game = (id: string): Game => ({
  id, league: "nhl", sport: "hockey", status: "pre", start_time: new Date().toISOString(), period: 0, period_label: "", clock: "", intermission: false,
  home: team("MIN"), away: team("CBJ"), linescores: { home: [], away: [] }, stats: { home: {}, away: {} }, goals: [],
});

function setup(today: string, fetchDay: ReturnType<typeof vi.fn>) {
  const engine = new Engine(new Store(":memory:"));
  const poller = new Poller(engine, fetchDay as never, () => today);
  const tick = () => (poller as unknown as { tickEspn(l: string): Promise<void> }).tickEspn("nhl");
  return { engine, tick };
}

describe("poller: ESPN's lagging default day", () => {
  it("asks for today explicitly when the default scoreboard is on another day, so today's games exist", async () => {
    const fetchDay = vi.fn(async (_l: string, date?: string) =>
      date ? { games: [game("nhl:today")], day: "2026-10-19" } : { games: [game("nhl:yesterday")], day: "2026-10-18" });
    const { engine, tick } = setup("2026-10-19", fetchDay);
    await tick();
    expect([...engine.games.keys()].sort()).toEqual(["nhl:today", "nhl:yesterday"]);
    expect(fetchDay).toHaveBeenCalledWith("nhl", "20261019");
    // next tick: today only (the default is re-read just every few minutes)
    fetchDay.mockClear();
    await tick();
    expect(fetchDay).toHaveBeenCalledTimes(1);
    expect(fetchDay).toHaveBeenCalledWith("nhl", "20261019");
  });

  it("makes a single request when the default scoreboard is already today", async () => {
    const fetchDay = vi.fn(async () => ({ games: [game("nhl:today")], day: "2026-10-19" }));
    const { engine, tick } = setup("2026-10-19", fetchDay);
    await tick();
    await tick();
    expect(fetchDay).toHaveBeenCalledTimes(2);
    expect(fetchDay.mock.calls.every((c) => c[1] === undefined)).toBe(true);
    expect(engine.games.has("nhl:today")).toBe(true);
  });

  it("returns to single requests once ESPN rolls over", async () => {
    let day = "2026-10-18";
    const fetchDay = vi.fn(async (_l: string, date?: string) => ({ games: [game(date ? "nhl:today" : "nhl:default")], day: date ? "2026-10-19" : day }));
    const { tick } = setup("2026-10-19", fetchDay);
    await tick();
    expect(fetchDay).toHaveBeenCalledTimes(2);
    day = "2026-10-19"; // ESPN flips; the default is re-read only after the refresh window, so force it
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 6 * 60_000);
    fetchDay.mockClear();
    await tick();
    expect(fetchDay).toHaveBeenCalledTimes(1); // default re-read, now current: no explicit today call
    vi.useRealTimers();
  });

  it("easternToday formats as YYYY-MM-DD in US Eastern time", () => {
    expect(easternToday(new Date("2026-10-19T03:30:00Z"))).toBe("2026-10-18"); // 11:30 PM EDT the day before
    expect(easternToday(new Date("2026-10-19T15:00:00Z"))).toBe("2026-10-19");
  });
});
