import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Engine } from "../src/engine/engine.js";
import { Store } from "../src/store.js";
import type { EventPayload, Game, Team } from "../src/types.js";

const rgb = { r: 1, g: 2, b: 3 };
const team = (abbr: string, score = 0): Team => ({
  id: abbr, abbr, name: abbr, display_name: `City ${abbr}`, logo: "", score,
  options: { primary_color_rgb: rgb, secondary_color_rgb: rgb, alternate_color_rgb: rgb },
});
const mk = (id: string, h = 0, a = 0): Game => ({
  id, league: "nhl", sport: "hockey", status: "in", start_time: new Date().toISOString(),
  period: 1, period_label: "1st period", clock: "10:00", intermission: false,
  home: team("MIN", h), away: team("CBJ", a),
  linescores: { home: [], away: [] }, stats: { home: {}, away: {} }, goals: [],
});
const scorer = { key: "p1", period: 1, period_label: "1st", clock: "1:00", team_abbr: "MIN", scorer: "A. Player", assists: [], home_score: 1, away_score: 0 };

let dir: string;
let file: string;
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-19T20:00:00Z"));
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "hr-restart-"));
  file = path.join(dir, "homeroom.db");
});
afterEach(() => {
  vi.useRealTimers();
  fs.rmSync(dir, { recursive: true, force: true });
});

function boot(grace = 10_000) {
  const store = new Store(file);
  store.setSyncedGames(["nhl:1", "nhl:2"]);
  const engine = new Engine(store, () => Date.now(), { fetchSummary: async () => ({ plays: [scorer], rows: [] }), retryMs: 1, restoreGraceMs: grace });
  const events: EventPayload[] = [];
  const games: Game[] = [];
  engine.on("event", (e) => events.push(e));
  engine.on("game", (g) => games.push(g));
  return { store, engine, events, games };
}
const advance = (ms: number) => vi.advanceTimersByTimeAsync(ms);

describe("delay buffer survives a restart", () => {
  it("delivers a pending goal at its ORIGINAL release time, once", async () => {
    const a = boot();
    a.store.patchSettings({ delay_global_s: 30 });
    a.engine.invalidateSettings();
    a.engine.ingestEspn(mk("nhl:1"));
    a.engine.ingestEspn(mk("nhl:1", 1));
    await advance(10_000); // goal detected at T0, due at T0+30 s
    expect(a.events).toEqual([]);
    expect(a.store.listPending()).toHaveLength(1);
    a.engine.stop(); // "crash"
    a.store.db.close();

    const b = boot();
    expect(b.engine.restore()).toMatchObject({ requeued: 1, dropped: 0 });
    await advance(19_000); // T0+29 s: not yet
    expect(b.events).toEqual([]);
    await advance(2_000); // T0+31 s
    expect(b.events.map((e) => e.type)).toEqual(["goal"]);
    expect(b.events[0].scoring?.scorer).toBe("A. Player");
    expect(b.store.listPending()).toHaveLength(0);
    await advance(60_000);
    expect(b.events).toHaveLength(1);
  });

  it("overdue within grace goes out at once; stale is dropped with its row; order per game never goes backwards", async () => {
    const a = boot();
    a.store.patchSettings({ delay_global_s: 20 });
    a.engine.invalidateSettings();
    a.engine.ingestEspn(mk("nhl:1"));
    a.engine.ingestEspn(mk("nhl:1", 1));
    await advance(1_000);
    a.engine.ingestEspn(mk("nhl:1", 2));
    await advance(1_000);
    a.engine.ingestEspn(mk("nhl:2"));
    a.engine.ingestEspn(mk("nhl:2", 0, 1));
    await advance(1_000);
    expect(a.store.listPending()).toHaveLength(3);
    a.engine.stop();
    a.store.db.close();

    // down for 24 s: goal 1 (due T+20) is 4 s late -> grace; goal 2 (due T+21) 3 s late -> grace; game 2 (due T+22) 2 s late -> grace
    vi.setSystemTime(Date.now() + 22_000);
    const b = boot();
    expect(b.engine.restore().requeued).toBe(3);
    await advance(10);
    expect(b.events.filter((e) => e.game.id === "nhl:1").map((e) => e.game.home.score)).toEqual([1, 2]);
    expect(b.events.map((e) => e.game.id).sort()).toEqual(["nhl:1", "nhl:1", "nhl:2"]);
    b.engine.stop();
    b.store.db.close();

    // a stale row (minutes late) is dropped, not replayed
    const c0 = new Store(file);
    c0.savePending("evt_old", "nhl:1", Date.now() - 5 * 60_000, JSON.stringify({ event_id: "evt_old", type: "goal", game: mk("nhl:1", 9) }));
    c0.db.close();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const c = boot();
    expect(c.engine.restore()).toMatchObject({ requeued: 0, dropped: 1 });
    await advance(60_000);
    expect(c.events).toEqual([]);
    expect(c.store.listPending()).toHaveLength(0);
    expect(warn).toHaveBeenCalled();
  });

  it("re-seeds shown from the last released snapshot, then raw state silently (no events)", async () => {
    const a = boot();
    a.engine.ingestEspn(mk("nhl:1", 1)); // delay 0: released at once, persisted
    expect(a.engine.shown.get("nhl:1")?.home.score).toBe(1);
    a.engine.stop();
    a.store.db.close();

    await vi.advanceTimersByTimeAsync(30_000);
    const b = boot();
    expect(b.engine.shown.size).toBe(0);
    expect(b.engine.restore()).toMatchObject({ shown: 1 });
    expect(b.engine.shown.get("nhl:1")?.home.score).toBe(1);
    // the first poll after the restart finds the score at 3: seed silently, no replayed goals
    b.engine.ingestEspn(mk("nhl:1", 3));
    await advance(100);
    expect(b.events).toEqual([]);
    expect(b.engine.games.get("nhl:1")?.home.score).toBe(3);
    expect(b.engine.shown.get("nhl:1")?.home.score).toBe(3); // delay 0 here; with a delay this lands after it
    b.engine.stop();
    b.store.db.close();

    // a snapshot older than 10 minutes is not shown again
    await vi.advanceTimersByTimeAsync(11 * 60_000);
    const c = boot();
    expect(c.engine.restore().shown).toBe(0);
    expect(c.engine.shown.size).toBe(0);
  });

  it("with a delay, viewers keep seeing the pre-restart state until the delayed raw state arrives", async () => {
    const a = boot();
    a.store.patchSettings({ delay_global_s: 30 });
    a.engine.invalidateSettings();
    a.engine.ingestEspn(mk("nhl:1", 1));
    await advance(31_000);
    a.engine.stop();
    a.store.db.close();
    const b = boot();
    b.engine.restore();
    b.engine.ingestEspn(mk("nhl:1", 2));
    await advance(10_000);
    expect(b.engine.shown.get("nhl:1")?.home.score).toBe(1);
    await advance(21_000);
    expect(b.engine.shown.get("nhl:1")?.home.score).toBe(2);
    expect(b.events).toEqual([]);
  });
});
