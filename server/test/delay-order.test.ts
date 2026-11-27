import { describe, expect, it } from "vitest";
import { Engine } from "../src/engine/engine.js";
import { Store } from "../src/store.js";
import type { Game, Team } from "../src/types.js";

const rgb = { r: 1, g: 2, b: 3 };
const team = (abbr: string, score = 0): Team => ({
  id: abbr, abbr, name: abbr, display_name: abbr, logo: "", score,
  options: { primary_color_rgb: rgb, secondary_color_rgb: rgb, alternate_color_rgb: rgb },
});
const mk = (h: number): Game => ({
  id: "nhl:1", league: "nhl", sport: "hockey", status: "in", start_time: new Date().toISOString(),
  period: 1, period_label: "1st", clock: "10:00", intermission: false,
  home: team("MIN", h), away: team("CBJ", 0),
  linescores: { home: [], away: [] }, stats: { home: {}, away: {} }, goals: [],
});

describe("delay ordering", () => {
  it("a slow scorer lookup does not release a goal after its score snapshot", async () => {
    const store = new Store(":memory:");
    store.setSyncedGames(["nhl:1"]);
    store.patchSettings({ delay_global_s: 0.5 });
    const engine = new Engine(store, () => Date.now(), {
      // Three failed lookups (no plays) make enrichment ~3x slower than the delay itself.
      fetchSummary: async () => {
        await new Promise((r) => setTimeout(r, 300));
        return { plays: [], rows: [] };
      },
      retryMs: 1,
    });
    const released: { kind: string; at: number }[] = [];
    engine.on("game", (g) => released.push({ kind: `game:${g.home.score}`, at: Date.now() }));
    engine.on("event", (e) => released.push({ kind: `event:${e.type}`, at: Date.now() }));

    engine.ingestEspn(mk(0));
    engine.ingestEspn(mk(1));
    await new Promise((r) => setTimeout(r, 1500));

    const goal = released.find((r) => r.kind === "event:goal");
    const score = released.find((r) => r.kind === "game:1");
    expect(goal).toBeDefined();
    expect(score).toBeDefined();
    // Both belong to the same detection and must reach viewers together, not seconds apart.
    expect(Math.abs((goal?.at ?? 0) - (score?.at ?? 0))).toBeLessThan(100);
    expect(released.findIndex((r) => r.kind === "event:goal")).toBeGreaterThanOrEqual(
      released.findIndex((r) => r.kind === "game:1"),
    );
    engine.stop();
  });
});
