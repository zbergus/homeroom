import { afterEach, describe, expect, it, vi } from "vitest";
import { Engine } from "../src/engine/engine.js";
import { matchesAny, MANUAL_SPECS, TRIGGERS, triggersFor } from "../src/engine/triggers.js";
import { Dispatcher } from "../src/outputs/dispatch.js";
import { Store, migrateAction } from "../src/store.js";
import type { EventPayload, Game, ScoringPlay, Team } from "../src/types.js";

const rgb = { r: 1, g: 2, b: 3 };
const team = (abbr: string, name: string, score = 0): Team => ({
  id: abbr, abbr, name, display_name: `City ${name}`, logo: "", score,
  options: { primary_color_rgb: rgb, secondary_color_rgb: rgb, alternate_color_rgb: rgb },
});
const mk = (o: Partial<Game> & { h?: number; a?: number } = {}): Game => {
  const { h = 0, a = 0, ...rest } = o;
  return {
    id: "nhl:1", league: "nhl", sport: "hockey", status: "in", start_time: new Date().toISOString(),
    period: 1, period_label: "1st period", clock: "10:00", intermission: false,
    home: team("MIN", "Wild", h), away: team("CBJ", "Blue Jackets", a),
    linescores: { home: [], away: [] }, stats: { home: {}, away: {} }, goals: [], ...rest,
  };
};
const play = (abbr: string): ScoringPlay => ({ key: `p-${abbr}`, period: 1, period_label: "1st", clock: "1:00", team_abbr: abbr, scorer: "A", assists: [], home_score: 0, away_score: 0 });

const baseEvent = (): EventPayload => ({ event_id: "e", type: "goal", emitted_at: 0, delay_s: 0, league: "nhl", sport: "hockey", game: mk(), natural_text: "" });

function setup(opts: { synced?: string[]; favorites?: string[] } = {}) {
  const store = new Store(":memory:");
  store.setSyncedGames(opts.synced ?? ["nhl:1"]);
  store.setFavorites((opts.favorites ?? []).map((a) => ({ league: "nhl", abbr: a })));
  const engine = new Engine(store, () => Date.now(), { fetchSummary: async () => ({ plays: [play("MIN"), play("CBJ")], rows: [] }), retryMs: 1 });
  const events: EventPayload[] = [];
  engine.on("event", (e) => events.push(e));
  const settle = () => new Promise((r) => setTimeout(r, 25));
  return { store, engine, events, settle };
}

afterEach(() => vi.useRealTimers());

describe("triggers", () => {
  const goalEv = (sport: string, label: string, delta: number): EventPayload =>
    ({ type: "goal", sport, league: "x", scoring: { label, delta, assists: [], home_score: 0, away_score: 0 }, game: mk(), natural_text: "", event_id: "e", emitted_at: 0, delay_s: 0 });
  const ctx = { favorites: new Set(["nhl:MIN"]) };

  it("labels and basketball deltas map to the right triggers", () => {
    expect(triggersFor(goalEv("football", "TOUCHDOWN", 7), ctx)).toEqual(expect.arrayContaining(["any_score", "touchdown"]));
    expect(triggersFor(goalEv("football", "FIELD GOAL", 3), ctx)).toContain("field_goal");
    expect(triggersFor(goalEv("football", "FIELD GOAL", 3), ctx)).not.toContain("touchdown");
    const t3 = triggersFor(goalEv("basketball", "BASKET", 3), ctx);
    expect(t3).toEqual(expect.arrayContaining(["basket", "basket_3"]));
    expect(t3).not.toContain("basket_2");
    expect(triggersFor(goalEv("baseball", "HOME RUN", 1), ctx)).toEqual(expect.arrayContaining(["run", "home_run"]));
    expect(triggersFor(goalEv("baseball", "RUN", 1), ctx)).not.toContain("home_run");
  });

  it("win only matches when a favourite team won", () => {
    const end = (winner: string): EventPayload => ({ ...baseEvent(), type: "game_end", league: "nhl", winner });
    expect(matchesAny(["win"], end("MIN"), ctx)).toBe(true);
    expect(matchesAny(["win"], end("CBJ"), ctx)).toBe(false);
    expect(matchesAny(["win"], end("tie"), ctx)).toBe(false);
    expect(matchesAny(["win"], end("MIN"), { favorites: new Set() })).toBe(false);
  });

  it("a manual press of 'win' fires even without a favourite", () => {
    const ev: EventPayload = { ...baseEvent(), type: "game_end", league: "nhl", winner: "CBJ", manual: true, trigger: "win" };
    expect(matchesAny(["win"], ev, { favorites: new Set() })).toBe(true);
  });

  it("unknown ids never match; every manual spec has a matching trigger id", () => {
    expect(matchesAny(["nope"], goalEv("hockey", "GOAL", 1), ctx)).toBe(false);
    const ids = new Set(TRIGGERS.map((t) => t.id));
    for (const id of Object.keys(MANUAL_SPECS)) expect(ids.has(id)).toBe(true);
  });

  it("legacy actions migrate from on[] to triggers[] once", () => {
    const a = migrateAction({ id: "a", enabled: true, on: ["goal", "period_end"], team_scope: "any", entities: [], effect: "flash", duration: 3, speed: 5, colors: "team", restore: true });
    expect(a.triggers).toEqual(["any_score", "period_end"]);
    expect("on" in a).toBe(false);
    expect(migrateAction(a)).toBe(a);
  });
});

describe("Dispatcher gates", () => {
  const fakes = () => {
    const calls = { ui: 0, pusher: 0, rest: 0, lights: 0 };
    const ui = { event: () => calls.ui++ };
    const ha = { publishPusher: () => (calls.pusher++, 1), publishRest: async () => void calls.rest++ };
    const lights = { handle: () => (calls.lights++, 1) };
    return { calls, ui, ha, lights };
  };
  const ev = (o: Partial<EventPayload>): EventPayload =>
    ({ event_id: "e", type: "goal", league: "nhl", sport: "hockey", delay_s: 0, emitted_at: 0, natural_text: "", game: mk(), team: team("MIN", "Wild"), ...o }) as EventPayload;
  const build = (patch: Record<string, unknown>, favorites: string[]) => {
    const { engine, store } = setup({ favorites });
    store.patchSettings(patch);
    engine.invalidateSettings();
    engine.invalidateSync();
    const f = fakes();
    const d = new Dispatcher(engine, f.ui as never, f.ha as never, f.lights as never);
    return { d, ...f };
  };

  it("my_team_only: favourite goal delivered, opponent goal filtered, TV always sees both", () => {
    const { d, calls } = build({ my_team_only: true }, ["MIN"]);
    expect(d.handle(ev({ team: team("MIN", "Wild") })).outcome).toBe("delivered");
    const r = d.handle(ev({ team: team("CBJ", "Blue Jackets") }));
    expect(r.outcome).toBe("filtered");
    expect(r.reason).toMatch(/my team only/);
    expect(calls.ui).toBe(2);
    expect(calls.pusher).toBe(1);
    expect(calls.lights).toBe(1);
  });

  it("my_team_only: non-goal events need a favourite in the game; with no favourites nothing fires", () => {
    const withFav = build({ my_team_only: true }, ["MIN"]);
    expect(withFav.d.handle(ev({ type: "game_start", team: undefined })).outcome).toBe("delivered");
    const other = ev({ type: "game_start", team: undefined, game: mk({ home: team("TOR", "Leafs"), away: team("BOS", "Bruins") }) });
    expect(withFav.d.handle(other).outcome).toBe("filtered");
    const none = build({ my_team_only: true }, []);
    expect(none.d.handle(ev({})).reason).toMatch(/no favourite/);
  });

  it("automations disabled blocks game events but not manual ones", () => {
    const { d, calls } = build({ automations_enabled: false }, []);
    expect(d.handle(ev({})).outcome).toBe("filtered");
    expect(d.handle(ev({ manual: true, trigger: "goal" })).outcome).toBe("delivered");
    expect(calls.pusher).toBe(1);
  });

  it("goal_overturned never goes to the HA integration or lights", () => {
    const { d, calls } = build({}, []);
    d.handle(ev({ type: "goal_overturned" }));
    expect(calls.pusher).toBe(0);
    expect(calls.rest).toBe(1); // REST path may carry it (it only posts when configured)
    expect(calls.ui).toBe(1);
  });

  it("every event is recorded with an outcome", () => {
    const { d } = build({ my_team_only: true }, ["MIN"]);
    d.handle(ev({ team: team("CBJ", "Blue Jackets") }));
    d.handle(ev({ team: team("MIN", "Wild") }));
    expect(d.log.recent().map((r) => r.outcome)).toEqual(["delivered", "filtered"]);
  });
});

describe("Engine: sync, delay tiers, manual triggers, winner, overturns", () => {
  it("auto-syncs games with a favourite team; exclusions and the switch both opt out", async () => {
    const run = async (prep: (s: ReturnType<typeof setup>) => void) => {
      const s = setup({ synced: [], favorites: ["MIN"] });
      prep(s);
      s.engine.ingestEspn(mk());
      s.engine.ingestEspn(mk({ h: 1 }));
      await s.settle();
      return s.events.filter((e) => e.type === "goal").length;
    };
    expect(await run(() => {})).toBe(1);
    expect(await run((s) => { s.store.patchSettings({ sync_excluded: ["nhl:1"] }); s.engine.invalidateSettings(); })).toBe(0);
    expect(await run((s) => { s.store.patchSettings({ auto_sync_favorites: false }); s.engine.invalidateSettings(); })).toBe(0);
  });

  it("delay resolves by_game ?? by_league ?? global", () => {
    const { engine, store } = setup();
    store.patchSettings({ delay_global_s: 5, delay_by_league: { nhl: 2 }, delay_by_game: { "nhl:9": 0.5 } });
    engine.invalidateSettings();
    expect(engine.delayMs("nhl:1")).toBe(2000);
    expect(engine.delayMs("nhl:9")).toBe(500);
    expect(engine.delayMs("nba:1")).toBe(5000);
  });

  it("opt-in leagues exist but are off by default, and can be enabled", () => {
    const { store } = setup();
    const on = store.getSettings().enabled_leagues;
    expect(on).toEqual(expect.arrayContaining(["nhl", "nfl", "nba", "mlb", "epl"]));
    for (const id of ["wnba", "ncaaf", "ncaah"]) expect(on).not.toContain(id);
    expect(store.patchSettings({ enabled_leagues: [...on, "wnba"] })).toBeUndefined();
    expect(store.getSettings().enabled_leagues).toContain("wnba");
  });

  it("rejects out-of-range or unknown delay presets", () => {
    const { store } = setup();
    expect(store.patchSettings({ delay_by_league: { nhl: 121 } })).toMatch(/0\.\.120/);
    expect(store.patchSettings({ delay_by_league: { xyz: 1 } })).toMatch(/unknown league/);
    expect(store.patchSettings({ delay_by_league: { nhl: 12.5 } })).toBeUndefined();
  });

  it("fireTrigger: touchdown, basket 3 and win synthesise the right event; bypasses delay by default", () => {
    const { engine, events, store } = setup();
    store.patchSettings({ delay_global_s: 30 });
    engine.invalidateSettings();
    const td = engine.fireTrigger({ trigger: "touchdown" });
    expect(td).toMatchObject({ type: "goal", manual: true, trigger: "touchdown", delay_s: 0 });
    expect(td.scoring).toMatchObject({ label: "TOUCHDOWN", delta: 7 });
    expect(engine.fireTrigger({ trigger: "basket_3" }).scoring).toMatchObject({ label: "BASKET", delta: 3 });
    const win = engine.fireTrigger({ trigger: "win", league: "nhl", team_abbr: "CBJ" });
    expect(win).toMatchObject({ type: "game_end", winner: "CBJ" });
    expect(events).toHaveLength(3);
    expect(engine.fireTrigger({ trigger: "goal", apply_delay: true }).delay_s).toBe(30);
    expect(() => engine.fireTrigger({ trigger: "bogus" })).toThrow(/unknown trigger/);
  });

  it("game_end carries the winner abbreviation (or tie)", async () => {
    const { engine, events, settle } = setup();
    engine.ingestEspn(mk({ h: 3, a: 2 }));
    engine.ingestEspn(mk({ h: 3, a: 2, status: "post", period: 3 }));
    await settle();
    expect(events.find((e) => e.type === "game_end")?.winner).toBe("MIN");
    const t = setup();
    t.engine.ingestEspn(mk({ h: 2, a: 2 }));
    t.engine.ingestEspn(mk({ h: 2, a: 2, status: "post" }));
    await t.settle();
    expect(t.events.find((e) => e.type === "game_end")?.winner).toBe("tie");
  });

  it("overturned goal: confirmed drop emits goal_overturned; a self-correcting flap stays silent", async () => {
    vi.useFakeTimers();
    const confirmed = setup();
    confirmed.engine.ingestEspn(mk({ h: 0 }));
    confirmed.engine.ingestEspn(mk({ h: 1 }));
    await vi.advanceTimersByTimeAsync(50);
    confirmed.engine.ingestEspn(mk({ h: 0 })); // review: no goal
    await vi.advanceTimersByTimeAsync(19_000);
    expect(confirmed.events.some((e) => e.type === "goal_overturned")).toBe(false);
    await vi.advanceTimersByTimeAsync(2_000);
    const o = confirmed.events.find((e) => e.type === "goal_overturned");
    expect(o?.team?.abbr).toBe("MIN");
    expect(o?.natural_text).toMatch(/overturned/);

    const flap = setup();
    flap.engine.ingestEspn(mk({ h: 0 }));
    flap.engine.ingestEspn(mk({ h: 1 }));
    await vi.advanceTimersByTimeAsync(50);
    flap.engine.ingestEspn(mk({ h: 0 }));
    await vi.advanceTimersByTimeAsync(5_000);
    flap.engine.ingestEspn(mk({ h: 1 })); // came back
    await vi.advanceTimersByTimeAsync(30_000);
    expect(flap.events.filter((e) => e.type === "goal_overturned")).toHaveLength(0);
    expect(flap.events.filter((e) => e.type === "goal")).toHaveLength(1);
  });
});
