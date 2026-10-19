import { describe, expect, it } from "vitest";
import { Engine } from "../src/engine/engine.js";
import { Store } from "../src/store.js";
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
});
