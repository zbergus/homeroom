import { describe, expect, it, vi } from "vitest";
import { Engine } from "../src/engine/engine.js";
import { Poller } from "../src/engine/poller.js";
import { Store } from "../src/store.js";
import type { Game, Insight, StatRow, Team } from "../src/types.js";

const rgb = { r: 1, g: 2, b: 3 };
const team = (abbr: string): Team => ({ id: abbr, abbr, name: abbr, display_name: abbr, logo: "", score: 0, options: { primary_color_rgb: rgb, secondary_color_rgb: rgb, alternate_color_rgb: rgb } });
const game = (o: Partial<Game> = {}): Game => ({
  id: "nhl:1", league: "nhl", sport: "hockey", status: "in", start_time: new Date().toISOString(), period: 1, period_label: "", clock: "10:00", intermission: false,
  home: team("MIN"), away: team("CBJ"), linescores: { home: [], away: [] }, stats: { home: {}, away: {} }, goals: [], ...o,
});
const row = (key: string): StatRow => ({ key, label: key, home: "1", away: "2", home_n: 1, away_n: 2 });

function setup(deps: ConstructorParameters<typeof Engine>[2], synced = ["nhl:1"]) {
  const store = new Store(":memory:");
  store.setSyncedGames(synced);
  const engine = new Engine(store, undefined, { retryMs: 1, ...deps });
  const seen: Game[] = [];
  engine.on("game", (g) => seen.push(g));
  return { engine, seen };
}

describe("engine enrichment", () => {
  it("refreshSummary stores boxscore rows and publishes the enriched game", async () => {
    const { engine, seen } = setup({ fetchSummary: async () => ({ plays: [], rows: [row("shots")] }) });
    engine.ingestEspn(game());
    seen.length = 0;
    await engine.refreshSummary("nhl:1");
    expect(engine.games.get("nhl:1")!.stat_rows?.map((r) => r.key)).toEqual(["shots"]);
    expect(seen.at(-1)?.stat_rows).toHaveLength(1);
  });

  it("empty rows never wipe rows we already have, and unchanged data is not republished", async () => {
    let rows = [row("shots")];
    const { engine, seen } = setup({ fetchSummary: async () => ({ plays: [], rows }) });
    engine.ingestEspn(game());
    await engine.refreshSummary("nhl:1");
    rows = [];
    seen.length = 0;
    await engine.refreshSummary("nhl:1");
    expect(engine.games.get("nhl:1")!.stat_rows).toHaveLength(1);
    expect(seen).toHaveLength(0);
  });

  it("a later ESPN scoreboard poll keeps the enrichment (rows, insight, goals)", async () => {
    const insight: Insight = { updated_at: 1, form: { home: { games: [] }, away: { games: [] }, rows: [row("gf")] } };
    const { engine } = setup({ fetchSummary: async () => ({ plays: [], rows: [row("shots")] }), buildInsight: async () => insight });
    engine.ingestEspn(game());
    await engine.refreshSummary("nhl:1");
    await engine.refreshInsight("nhl:1");
    engine.ingestEspn(game({ clock: "9:58" })); // fresh scoreboard object has none of that
    const g = engine.games.get("nhl:1")!;
    expect(g.clock).toBe("9:58");
    expect(g.stat_rows).toHaveLength(1);
    expect(g.insight).toEqual(insight);
  });

  it("refreshInsight tolerates a failing builder and an unknown game", async () => {
    const { engine } = setup({ buildInsight: async () => { throw new Error("boom"); } });
    engine.ingestEspn(game());
    await expect(engine.refreshInsight("nhl:1")).resolves.toBeUndefined();
    await expect(engine.refreshInsight("nope")).resolves.toBeUndefined();
    expect(engine.games.get("nhl:1")!.insight).toBeUndefined();
  });
});

describe("poller selects the right games for enrichment", () => {
  const soon = new Date(Date.now() + 2 * 3600_000).toISOString();
  const later = new Date(Date.now() + 8 * 3600_000).toISOString();

  it("insight: synced games starting within 3 h or live, only when missing/stale", async () => {
    const buildInsight = vi.fn(async () => ({ updated_at: Date.now(), form: { home: { games: [] }, away: { games: [] }, rows: [] } }) as Insight);
    const { engine } = setup({ buildInsight }, ["nhl:soon", "nhl:later", "nhl:live"]);
    engine.ingestEspn(game({ id: "nhl:soon", status: "pre", start_time: soon }));
    engine.ingestEspn(game({ id: "nhl:later", status: "pre", start_time: later }));
    engine.ingestEspn(game({ id: "nhl:live" }));
    engine.ingestEspn(game({ id: "nhl:unsynced", status: "pre", start_time: soon }));
    const poller = new Poller(engine);
    await (poller as unknown as { tickInsight(): Promise<void> }).tickInsight();
    expect(buildInsight.mock.calls.map((c) => (c[0] as Game).id).sort()).toEqual(["nhl:live", "nhl:soon"]);
    buildInsight.mockClear();
    await (poller as unknown as { tickInsight(): Promise<void> }).tickInsight();
    expect(buildInsight).not.toHaveBeenCalled(); // fresh now
  });

  it("summary: backfills a synced finished game once (not every minute) and ignores unsynced ones", async () => {
    const fetchSummary = vi.fn(async () => ({ plays: [], rows: [] }));
    const { engine } = setup({ fetchSummary }, ["nhl:done"]);
    engine.ingestEspn(game({ id: "nhl:done", status: "post" }));
    engine.ingestEspn(game({ id: "nhl:done2", status: "post" })); // not synced
    const poller = new Poller(engine) as unknown as { tickSummary(): Promise<void> };
    await poller.tickSummary();
    await poller.tickSummary();
    expect(fetchSummary.mock.calls.map((c) => c[0])).toEqual(["nhl:done"]);
  });

  it("summary: live synced games only", async () => {
    const fetchSummary = vi.fn(async () => ({ plays: [], rows: [row("shots")] }));
    const { engine } = setup({ fetchSummary }, ["nhl:live", "nhl:pre"]);
    engine.ingestEspn(game({ id: "nhl:live" }));
    engine.ingestEspn(game({ id: "nhl:pre", status: "pre", start_time: soon }));
    engine.ingestEspn(game({ id: "nhl:other" }));
    await (new Poller(engine) as unknown as { tickSummary(): Promise<void> }).tickSummary();
    expect(fetchSummary.mock.calls.map((c) => c[0])).toEqual(["nhl:live"]);
  });
});
