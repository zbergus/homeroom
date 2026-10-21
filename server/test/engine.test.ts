import { describe, expect, it, vi } from "vitest";
import { Engine } from "../src/engine/engine.js";
import { Store } from "../src/store.js";
import { HaOutputs } from "../src/outputs/ha.js";
import { PusherHub } from "../src/outputs/pusher.js";
import type { NhlGame } from "../src/providers/nhl.js";
import type { EventPayload, Game, ScoringPlay, Team } from "../src/types.js";

const rgb = { r: 1, g: 2, b: 3 };
const team = (abbr: string, name: string, score = 0): Team => ({
  id: abbr, abbr, name, display_name: `City ${name}`, logo: "", score,
  options: { primary_color_rgb: rgb, secondary_color_rgb: rgb, alternate_color_rgb: rgb },
});
const mk = (over: Partial<Game> & { h?: number; a?: number } = {}): Game => {
  const { h = 0, a = 0, ...rest } = over;
  return {
    id: "nhl:1", league: "nhl", sport: "hockey", status: "in", start_time: new Date().toISOString(),
    period: 1, period_label: "1st period", clock: "10:00", intermission: false,
    home: team("MIN", "Wild", h), away: team("CBJ", "Blue Jackets", a),
    linescores: { home: [], away: [] }, stats: { home: {}, away: {} }, goals: [], ...rest,
  };
};
const play = (n: number, abbr: string, scorer: string): ScoringPlay => ({
  key: `p${n}`, period: 1, period_label: "1st", clock: "1:00", team_abbr: abbr, scorer, assists: ["A. Helper"], home_score: 0, away_score: 0,
});

function setup(plays: ScoringPlay[] = []) {
  const store = new Store(":memory:");
  store.setSyncedGames(["nhl:1"]);
  const engine = new Engine(store, () => Date.now(), { fetchSummary: async () => ({ plays, rows: [] }), retryMs: 1 });
  const events: EventPayload[] = [];
  engine.on("event", (e) => events.push(e));
  const settle = () => new Promise((r) => setTimeout(r, 30));
  return { store, engine, events, settle };
}

describe("Engine", () => {
  it("copies celebration metadata into delayed events without changing the Pusher payload mapping", () => {
    const { engine, store } = setup();
    const goal = { ...play(1, "MIN", "Player"), scorer_id: "nhl:12345", scorer_number: "22" };
    const game = mk({ goals: [goal] });
    const event = engine.buildEvent("goal", game, { team: game.home, play: goal, delta: 1 });
    expect(event.scoring).toMatchObject({ scorer_id: "nhl:12345", scorer_number: "22" });
    const hub = new PusherHub(store, "test", "test");
    const broadcast = vi.spyOn(hub, "broadcast").mockReturnValue(0);
    const ha = new HaOutputs(engine, hub);
    store.link("test-integration");
    ha.publishPusher(event);
    const enriched = broadcast.mock.calls[0]?.[2];
    const plainGoal: ScoringPlay = { ...goal };
    delete plainGoal.scorer_id;
    delete plainGoal.scorer_number;
    const plainGame = { ...game, goals: [plainGoal] };
    const plainEvent = { ...event, game: plainGame, scoring: { ...event.scoring! } };
    delete plainEvent.scoring.scorer_id;
    delete plainEvent.scoring.scorer_number;
    broadcast.mockClear();
    ha.publishPusher(plainEvent);
    expect(enriched).toEqual(broadcast.mock.calls[0]?.[2]);
    expect(JSON.stringify(enriched)).not.toMatch(/scorer_id|scorer_number/);
    expect(event.scoring?.scorer_id).toBe("nhl:12345");
    expect(goal.scorer_number).toBe("22");
    hub.close();
    engine.stop();
  });

  it("full game: start, goal w/ scorer, intermission, resume, end; nothing on first sight", async () => {
    const { engine, events, settle } = setup([play(1, "MIN", "Danila Yurov")]);
    engine.ingestEspn(mk({ status: "pre", period: 0 }));
    await settle();
    expect(events).toEqual([]);
    engine.ingestEspn(mk());
    engine.ingestEspn(mk({ h: 1 }));
    await settle();
    engine.ingestEspn(mk({ h: 1, intermission: true }));
    engine.ingestEspn(mk({ h: 1, period: 2, period_label: "2nd period" }));
    engine.ingestEspn(mk({ h: 1, status: "post", period: 3 }));
    await settle();
    expect(events.map((e) => e.type)).toEqual(["game_start", "goal", "period_end", "period_start", "game_end"]);
    const goal = events[1];
    expect(goal.scoring?.scorer).toBe("Danila Yurov");
    expect(goal.natural_text).toBe("Goal, City Wild! Danila Yurov scores. Wild 1, Blue Jackets 0.");
    expect(goal.team?.abbr).toBe("MIN");
    expect(events[4].natural_text).toBe("Final. City Wild beat City Blue Jackets, 1 to 0.");
  });

  it("does not emit for games that are not synced, but still tracks state", async () => {
    const { engine, events, settle, store } = setup();
    store.setSyncedGames([]);
    engine.invalidateSync();
    engine.ingestEspn(mk());
    engine.ingestEspn(mk({ h: 1 }));
    await settle();
    expect(events).toEqual([]);
    expect(engine.games.get("nhl:1")?.home.score).toBe(1);
  });

  it("score flap (drop then return) does not double count; real next goal still fires", async () => {
    const { engine, events, settle } = setup([play(1, "MIN", "A")]);
    engine.ingestEspn(mk({ h: 1 }));
    engine.ingestEspn(mk({ h: 2 }));
    await settle();
    expect(events.filter((e) => e.type === "goal")).toHaveLength(1);
    engine.ingestEspn(mk({ h: 1 })); // provider glitch
    engine.ingestEspn(mk({ h: 2 })); // back
    await settle();
    expect(events.filter((e) => e.type === "goal")).toHaveLength(1);
    engine.ingestEspn(mk({ h: 3 }));
    await settle();
    expect(events.filter((e) => e.type === "goal")).toHaveLength(2);
  });

  it("NHL feed is authoritative: stale ESPN scoreboard cannot cause a phantom second goal", async () => {
    const { engine, events, settle } = setup();
    engine.ingestEspn(mk({ h: 0 }));
    const nhl = (hs: number): NhlGame => ({
      id: 99, date: "", start_utc: "", homeNick: "wild", awayNick: "blue jackets", homeAbbr: "MIN", awayAbbr: "CBJ",
      state: "in", period: 1, clock: "09:00", inIntermission: false, homeScore: hs, awayScore: 0,
      goals: hs ? [{ ...play(1, "MIN", "Danila Yurov"), key: "n1" }] : [],
    });
    engine.ingestNhl("nhl:1", nhl(1)); // NHL sees the goal first
    engine.ingestEspn(mk({ h: 0 })); // ESPN still stale at 0-0
    engine.ingestEspn(mk({ h: 1 })); // ESPN catches up
    await settle();
    const goals = events.filter((e) => e.type === "goal");
    expect(goals).toHaveLength(1);
    expect(goals[0].scoring?.scorer).toBe("Danila Yurov");
    expect(engine.games.get("nhl:1")?.home.score).toBe(1);
  });

  it("delay: events and state snapshots are withheld, in order, until the delay passes", async () => {
    const { engine, events, store } = setup();
    store.patchSettings({ delay_global_s: 0.5 });
    engine.invalidateSettings();
    engine.ingestEspn(mk());
    await new Promise((r) => setTimeout(r, 600));
    engine.ingestEspn(mk({ h: 1 }));
    await new Promise((r) => setTimeout(r, 100));
    expect(engine.games.get("nhl:1")?.home.score).toBe(1); // raw is live
    expect(engine.shown.get("nhl:1")?.home.score).toBe(0); // viewers still see the past
    expect(events).toHaveLength(0);
    await new Promise((r) => setTimeout(r, 700));
    expect(engine.shown.get("nhl:1")?.home.score).toBe(1);
    expect(events).toHaveLength(1);
    expect(events[0].delay_s).toBe(0.5);
  });

  it("test goal bypasses the delay and carries horn only when a file exists", async () => {
    const { engine, events } = setup();
    engine.store.patchSettings({ delay_global_s: 30 });
    engine.invalidateSettings();
    engine.fireTest({ league: "nhl", team_abbr: "MIN" });
    expect(events).toHaveLength(1);
    expect(events[0].test).toBe(true);
    expect(events[0].goal_horn).toBeUndefined(); // no public_base_url configured
  });

  it("replays a recorded stop/resume sequence 36 wall-clock seconds later, including provider jumps", () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const store = new Store(":memory:");
    store.patchSettings({ delay_global_s: 36 });
    const engine = new Engine(store);
    const released: { at: number; clock: number | undefined; running: boolean | undefined }[] = [];
    engine.on("game", (g) => released.push({ at: Date.now(), clock: g.clock_s, running: g.clock_running }));
    const observe = (at: number, seconds: number, running: boolean) => {
      vi.advanceTimersByTime(at - Date.now());
      engine.ingestEspn(mk({ clock: `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`, clock_s: seconds, clock_running: running, clock_dir: "down" }));
    };
    try {
      observe(0, 600, true);
      observe(4000, 596, false);
      observe(24000, 596, false);
      observe(30000, 596, true);
      observe(34000, 592, true);
      expect(engine.shown.size).toBe(0);
      observe(38000, 580, true); // discontinuity originates in the provider, not the buffer
      vi.advanceTimersByTime(36_000);
      expect(released).toEqual([
        { at: 36000, clock: 600, running: true },
        { at: 40000, clock: 596, running: false },
        { at: 60000, clock: 596, running: false },
        { at: 66000, clock: 596, running: true },
        { at: 70000, clock: 592, running: true },
        { at: 74000, clock: 580, running: true },
      ]);
      expect(engine.shown.get("nhl:1")?.clock_at_ms).toBe(74000);
      expect(engine.games.get("nhl:1")?.clock_at_ms).toBe(38000);
    } finally {
      engine.stop();
      vi.useRealTimers();
    }
  });

  it("secondary ESPN updates preserve the authoritative clock's age on the delayed timeline", () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const store = new Store(":memory:");
    store.patchSettings({ delay_global_s: 36 });
    const engine = new Engine(store);
    try {
      engine.ingestEspn(mk());
      vi.advanceTimersByTime(1000);
      engine.ingestNhl("nhl:1", {
        id: 99, date: "", start_utc: "", homeNick: "wild", awayNick: "blue jackets", homeAbbr: "MIN", awayAbbr: "CBJ",
        state: "in", period: 1, clock: "09:00", clockS: 540, clockRunning: true, inIntermission: false,
        homeScore: 0, awayScore: 0, goals: [],
      });
      vi.advanceTimersByTime(3000);
      engine.ingestEspn(mk({ clock: "10:00", clock_s: 600 }));
      expect(engine.games.get("nhl:1")?.clock_at_ms).toBe(1000);
      vi.advanceTimersByTime(36000);
      expect(engine.shown.get("nhl:1")?.clock_at_ms).toBe(37000);
      expect(engine.shown.get("nhl:1")?.clock_s).toBe(540);
    } finally {
      engine.stop();
      vi.useRealTimers();
    }
  });

  it("stamps fresh ESPN observations before preserving an authoritative clock", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1000);
    const engine = new Engine(new Store(":memory:"));
    try {
      const incoming = mk({ clock_s: 600, clock_running: false, clock_dir: "down", clock_at_ms: 0 });
      engine.ingestEspn(incoming);
      expect(engine.games.get(incoming.id)?.clock_at_ms).toBe(1000);
      vi.advanceTimersByTime(1000);
      engine.ingestEspn(incoming);
      expect(engine.games.get(incoming.id)?.clock_at_ms).toBe(2000);
      expect(incoming.clock_at_ms).toBe(0);
      engine.ingestNhl(incoming.id, {
        id: 99, date: "", start_utc: "", homeNick: "wild", awayNick: "blue jackets", homeAbbr: "MIN", awayAbbr: "CBJ",
        state: "in", period: 1, clock: "09:00", clockS: 540, clockRunning: false, inIntermission: false,
        homeScore: 1, awayScore: 0, goals: [],
      });
      vi.advanceTimersByTime(1000);
      engine.ingestEspn(incoming);
      expect(engine.games.get(incoming.id)?.clock_at_ms).toBe(2000);
      expect(engine.games.get(incoming.id)?.clock_s).toBe(540);
      expect(engine.games.get(incoming.id)?.home.score).toBe(1);
      vi.advanceTimersByTime(10000);
      engine.ingestEspn(incoming);
      expect(engine.games.get(incoming.id)?.clock_at_ms).toBe(13000);
      expect(engine.games.get(incoming.id)?.clock_s).toBe(600);
    } finally {
      engine.stop();
      vi.useRealTimers();
    }
  });
});
