import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Engine } from "../src/engine/engine.js";
import { SIM_GAME_ID, SIM_STEPS } from "../src/engine/simulation.js";
import { Store } from "../src/store.js";
import type { EventPayload } from "../src/types.js";

describe("in-app NHL simulation", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function setup(stepMs = 1000, maxMs = 60_000) {
    const store = new Store(":memory:");
    store.setFavorites([{ league: "nhl", abbr: "MTL" }]);
    const engine = new Engine(store, () => Date.now(), {
      fetchSummary: async () => ({ plays: [], rows: [] }),
      retryMs: 1,
      simStepMs: stepMs,
      simMaxMs: maxMs,
    });
    const events: EventPayload[] = [];
    const refreshes: number[] = [];
    engine.on("event", (e) => events.push(e));
    engine.on("refresh", () => refreshes.push(Date.now()));
    return { engine, events, refreshes, store };
  }

  it("emits the scripted sequence in order, then stop clears the game", async () => {
    const { engine, events, refreshes } = setup(500, 60_000);
    const start = engine.startSimulation();
    expect(start.active).toBe(true);
    expect(start.game_id).toBe(SIM_GAME_ID);
    expect(engine.games.has(SIM_GAME_ID)).toBe(true);
    expect(engine.isSynced(SIM_GAME_ID)).toBe(true);
    expect(engine.games.get(SIM_GAME_ID)?.home.abbr).toBe("MTL");

    await vi.advanceTimersByTimeAsync(SIM_STEPS.length * 500);
    expect(events.map((e) => e.type)).toEqual([
      "game_start",
      "period_start",
      "powerplay",
      "goal",
      "period_end",
      "period_start",
      "goal",
      "game_end",
    ]);
    expect(events.every((e) => e.test === true && e.manual === true)).toBe(true);
    const goal = events.find((e) => e.type === "goal");
    expect(goal?.scoring?.scorer).toBe("Test Player");
    expect(goal?.natural_text).toMatch(/Test Player/);

    const stopped = engine.stopSimulation();
    expect(stopped.active).toBe(false);
    expect(engine.games.has(SIM_GAME_ID)).toBe(false);
    expect(engine.shown.has(SIM_GAME_ID)).toBe(false);
    expect(refreshes.length).toBeGreaterThanOrEqual(1);

    // second start after stop works
    const again = engine.startSimulation();
    expect(again.active).toBe(true);
    engine.stopSimulation();
  });

  it("stop cancels remaining steps", async () => {
    const { engine, events } = setup(2_000, 60_000);
    engine.startSimulation();
    await vi.advanceTimersByTimeAsync(100); // first step (t=0)
    expect(events.map((e) => e.type)).toEqual(["game_start"]);
    engine.stopSimulation();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(events.map((e) => e.type)).toEqual(["game_start"]);
    expect(engine.simulationStatus().active).toBe(false);
  });

  it("auto-expires and clears state", async () => {
    const { engine, refreshes } = setup(10_000, 3_000);
    engine.startSimulation();
    expect(engine.simulationStatus().active).toBe(true);
    await vi.advanceTimersByTimeAsync(3_000);
    expect(engine.simulationStatus().active).toBe(false);
    expect(engine.games.has(SIM_GAME_ID)).toBe(false);
    expect(refreshes.length).toBeGreaterThanOrEqual(1);
  });

  it("boot never resumes a simulation (in-memory only)", () => {
    const { engine } = setup();
    expect(engine.simulationStatus()).toEqual({ active: false });
  });

  it("rejects a second start while active", () => {
    const { engine } = setup();
    engine.startSimulation();
    expect(() => engine.startSimulation()).toThrow(/already active/);
    engine.stopSimulation();
  });
});
