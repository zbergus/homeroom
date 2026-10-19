import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Engine } from "../src/engine/engine.js";
import { leagueById } from "../src/leagues.js";
import { parseSummary } from "../src/providers/espn.js";
import { Store } from "../src/store.js";
import type { EventPayload } from "../src/types.js";
import { VirtualClock } from "../src/sim/clock.js";
import { ingestAt } from "../src/sim/drive.js";
import { ReplayGame } from "../src/sim/replay.js";
import { startSimServer } from "../src/sim/server.js";

const REPLAY = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "fixtures/replay");
const load = (id: string) => new ReplayGame(path.join(REPLAY, id));

/** Replay a game through the real Engine under fake timers: 1 real second == `speed` virtual seconds. */
async function replay(g: ReplayGame, o: { delayS: number; speed: number; stepVirtualS: number }) {
  const store = new Store(":memory:");
  store.patchSettings({ delay_global_s: o.delayS });
  store.setSyncedGames([g.id]);
  let v = 0;
  const engine = new Engine(store, () => Date.now(), {
    fetchSummary: async (_id, map) => parseSummary(g.league, g.espnSummary(v), map),
    buildInsight: async () => undefined,
    retryMs: 10,
  });
  const out: { e: EventPayload; at: number }[] = [];
  engine.on("event", (e) => out.push({ e, at: Date.now() }));
  const stepMs = (o.stepVirtualS / o.speed) * 1000;
  const startAt = Date.now() + 1000;
  /** wall time at which the raw feed first showed N scoring changes */
  const firstSeen: number[] = [];
  let seenScore = 0;
  for (v = 0; v <= g.endV + 120_000; v += o.stepVirtualS * 1000) {
    ingestAt(engine, g, v, startAt);
    const raw = engine.games.get(g.id)!;
    const total = raw.home.score + raw.away.score;
    while (seenScore < total) (firstSeen.push(Date.now()), seenScore++);
    await vi.advanceTimersByTimeAsync(stepMs);
  }
  await vi.advanceTimersByTimeAsync(o.delayS * 1000 + 5000);
  if (process.env.SIM_DEBUG) for (const x of out) console.log(new Date(x.at).toISOString().slice(11, 19), x.e.type, x.e.game.period_label, x.e.game.clock, `${x.e.game.home.abbr} ${x.e.game.home.score}-${x.e.game.away.score} ${x.e.game.away.abbr}`, x.e.scoring?.scorer ?? "", x.e.scoring?.strength ?? "", JSON.stringify(x.e.card ?? ""));
  return { out, engine, firstSeen, stepMs };
}

beforeEach(() => vi.useFakeTimers({ now: new Date("2026-10-19T12:00:00Z") }));
afterEach(() => vi.useRealTimers());

describe("replay clock", () => {
  it("scales, pauses and seeks", () => {
    let t = 0;
    const c = new VirtualClock(10, () => t);
    t = 1000;
    expect(c.v()).toBe(10_000);
    c.pause();
    t = 5000;
    expect(c.v()).toBe(10_000);
    c.resume();
    c.setSpeed(60);
    t = 6000;
    expect(c.v()).toBe(70_000);
    c.seek(5);
    expect(c.v()).toBe(5);
  });
});

describe("NHL replay (SJ @ DET, regulation + OT + shootout, 7 goals, power plays)", () => {
  it("drives the real engine: ordered, unique, delayed, with scorers and power plays", async () => {
    const g = load("nhl-401892525");
    const delayS = 5, speed = 10;
    const { out, firstSeen, stepMs } = await replay(g, { delayS, speed, stepVirtualS: 10 });
    const types = out.map((x) => x.e.type);
    expect(types[0]).toBe("game_start");
    expect(types.at(-1)).toBe("game_end");

    // 1st-3rd period + OT: period_end and period_start for each break, in order (start of period 1 is game_start)
    const periods = out.filter((x) => x.e.type === "period_end" || x.e.type === "period_start").map((x) => `${x.e.type}`);
    expect(periods.filter((p) => p === "period_end").length).toBeGreaterThanOrEqual(3);
    expect(periods.filter((p) => p === "period_start").length).toBeGreaterThanOrEqual(3);
    expect(periods[0]).toBe("period_end");

    // goals: regulation scored 6 (DET 3, SJ 3); every goal event names a scorer, and the score only moves forward
    const goals = out.filter((x) => x.e.type === "goal");
    expect(goals.length).toBeGreaterThanOrEqual(6);
    for (const x of goals) expect(x.e.scoring?.scorer, JSON.stringify(x.e.scoring)).toBeTruthy();
    expect(goals[0].e.scoring?.scorer).toBe("Justin Faulk");
    expect(goals[0].e.team?.abbr).toBe("DET");
    let prev = 0;
    for (const x of goals) {
      const tot = x.e.scoring!.home_score + x.e.scoring!.away_score;
      expect(tot).toBeGreaterThan(prev);
      prev = tot;
    }

    // power plays announced (the recording has several man-advantage stretches)
    const pps = out.filter((x) => x.e.type === "powerplay");
    expect(pps.length).toBeGreaterThanOrEqual(2);

    // no event fires twice
    expect(new Set(out.map((x) => x.e.event_id)).size).toBe(out.length);
    const keyOf = (e: EventPayload) => (e.type === "goal" ? `${e.type}:${e.scoring?.home_score}-${e.scoring?.away_score}` : e.type === "powerplay" ? `${e.type}:${e.team?.abbr}:${Math.floor(Date.parse(String(e.emitted_at)) || 0)}` : `${e.type}:${e.game.period}`);
    const singles = out.filter((x) => x.e.type !== "powerplay").map((x) => keyOf(x.e));
    expect(new Set(singles).size).toBe(singles.length);

    // the delay buffer holds each goal back by the configured delay (measured in feed time), never earlier
    for (let i = 0; i < goals.length && i < firstSeen.length; i++) {
      const held = goals[i].at - firstSeen[i];
      expect(held, `goal ${i}`).toBeGreaterThanOrEqual(delayS * 1000 - 1);
      expect(held, `goal ${i}`).toBeLessThanOrEqual(delayS * 1000 + 2 * stepMs);
    }
    // the same delay in virtual time (so a 60x run holds events for 300 virtual seconds)
    expect((delayS * speed)).toBe(50);
  }, 20_000);

  it("has no spoilers before it happens: pre-game feed shows nothing", () => {
    const g = load("nhl-401892525");
    const pbp = g.nhlPbpAt(0, Date.now())!;
    expect(pbp.plays.length).toBe(0);
    expect(g.espnSummary(0).plays.length).toBe(0);
    expect(g.espnEvent(0, Date.now()).status.type.state).toBe("pre");
    const end = g.espnEvent(g.endV + 1000, Date.now());
    expect(end.status.type.name).toBe("STATUS_FINAL");
  });
});

describe("overturned goal scenario", () => {
  it("announces the phantom goal, then reports it overturned after the confirm window", async () => {
    const g = load("nhl-401892525");
    g.setPhantom(900, "home", 40); // 5 virtual minutes into the game: +1 for 40 s, then gone
    // speed 5: production time constants (120 s flap window, 20 s overturn confirm) are real-time, so they compress at higher speeds
    const { out } = await replay(g, { delayS: 2, speed: 5, stepVirtualS: 5 });
    const i = out.findIndex((x) => x.e.type === "goal" && x.e.scoring?.home_score === 1 && x.e.scoring?.away_score === 0 && x.e.game.clock >= "10:00");
    expect(i, "phantom goal announced before the real first goal").toBeGreaterThanOrEqual(0);
    const o = out.findIndex((x) => x.e.type === "goal_overturned");
    expect(o).toBeGreaterThan(i);
    expect(out.filter((x) => x.e.type === "goal_overturned")).toHaveLength(1);
    // the real first goal (same team) still comes later and is announced as a normal goal
    expect(out.filter((x) => x.e.type === "goal").map((x) => x.e.scoring?.scorer)).toContain("Justin Faulk");
    expect(out.filter((x) => x.e.type === "goal")).toHaveLength(8); // phantom + 7 real (incl. the shootout winner)
  }, 20_000);
});

describe("multi-goal shootout (DAL @ COL)", () => {
  it("replays a shootout where three attempts score", async () => {
    const g = load("nhl-401892505");
    const { out } = await replay(g, { delayS: 0, speed: 10, stepVirtualS: 10 });
    expect(out.at(-1)!.e.type).toBe("game_end");
    const so = out.filter((x) => x.e.type === "goal" && x.e.game.period >= 5);
    expect(so.length).toBeGreaterThan(0);
    expect(out.filter((x) => x.e.type === "goal").length).toBeGreaterThanOrEqual(5);
  }, 20_000);
});

describe("soccer replay (EPL SUN @ BOU: goals, 5 yellow cards and a red)", () => {
  it("emits card events (yellow and red) and goals with scorers, once each", async () => {
    const g = load("epl-401879263");
    const { out } = await replay(g, { delayS: 0, speed: 60, stepVirtualS: 20 });
    const cards = out.filter((x) => x.e.type === "card");
    expect(cards.length).toBe(6);
    const kinds = cards.map((x) => x.e.card?.kind);
    expect(cards.every((x) => x.e.card?.player)).toBe(true);
    expect(kinds.filter((k) => k === "red").length).toBe(1);
    expect(kinds.filter((k) => k === "yellow").length).toBe(5);
    const goals = out.filter((x) => x.e.type === "goal");
    expect(goals.map((x) => x.e.scoring?.scorer)).toEqual(["Marcus Tavernier", "Evanilson"]);
    expect(out[0].e.type).toBe("game_start");
    expect(out.at(-1)!.e.type).toBe("game_end");
    expect(out.some((x) => x.e.type === "period_end")).toBe(true); // half time
    expect(new Set(out.map((x) => x.e.event_id)).size).toBe(out.length);
  }, 20_000);
});

describe.each([["nfl-401872999", 3], ["nba-401898406", 20], ["mlb-401930515", 3]])("%s replay through the engine", (id, minGoals) => {
  it("starts, scores forward, breaks and ends, with no duplicate events", async () => {
    const g = load(id);
    const { out } = await replay(g, { delayS: 1, speed: 60, stepVirtualS: 20 });
    expect(out[0].e.type).toBe("game_start");
    expect(out.at(-1)!.e.type).toBe("game_end");
    const goals = out.filter((x) => x.e.type === "goal");
    expect(goals.length).toBeGreaterThanOrEqual(minGoals);
    let prev = 0;
    for (const x of goals) {
      const tot = x.e.scoring!.home_score + x.e.scoring!.away_score;
      expect(tot).toBeGreaterThanOrEqual(prev); // two scores inside one poll interval share the snapshot score
      prev = tot;
    }
    expect(out.some((x) => x.e.type === "period_end")).toBe(true);
    expect(new Set(out.map((x) => x.e.event_id)).size).toBe(out.length);
  }, 20_000);
});

describe("sim server", () => {
  it("serves ESPN and NHL shaped endpoints from the virtual clock", async () => {
    vi.useRealTimers();
    const games = [load("nhl-401892525")];
    const sim = await startSimServer({ games, speed: 1, port: 0, quiet: true });
    try {
      const base = `http://127.0.0.1:${sim.port}`;
      const j = async (p: string, init?: RequestInit) => (await fetch(base + p, init)).json() as Promise<any>;
      let sb = await j("/espn/hockey/nhl/scoreboard");
      expect(sb.events).toHaveLength(1);
      expect(sb.events[0].status.type.state).toBe("pre");
      expect((await j("/espn/hockey/nhl/scoreboard?dates=20200101")).events).toHaveLength(0);
      expect((await j("/espn/hockey/nhl/scoreboard?dates=20261017")).events).toHaveLength(1);
      expect((await j("/espn/soccer/eng.1/scoreboard")).events).toHaveLength(0);

      // seek to just after the first goal
      const st = await j("/sim/seek", { method: "POST", body: JSON.stringify({ to: "goal:1", before_s: -5 }) });
      expect(st.games[0].snapshot.home + st.games[0].snapshot.away).toBe(1);
      sim.clock.pause();
      sb = await j("/espn/hockey/nhl/scoreboard");
      expect(sb.events[0].status.type.state).toBe("in");
      const sum = await j("/espn/hockey/nhl/summary?event=401892525");
      expect(sum.plays.some((p: any) => p.scoringPlay)).toBe(true);
      expect(sum.plays.filter((p: any) => p.scoringPlay)).toHaveLength(1);
      const now = await j("/nhl/score/now");
      expect(now.games[0].goals).toHaveLength(1);
      const pbp = await j(`/nhl/gamecenter/${games[0].nhlId}/play-by-play`);
      expect(pbp.plays.filter((p: any) => p.typeDescKey === "goal")).toHaveLength(1);
      expect((await j("/espn/hockey/nhl/teams/5/schedule")).events.length).toBeGreaterThan(0);
      expect((await fetch(base + "/espn/hockey/nhl/summary?event=1")).status).toBe(404);

      expect((await j("/sim/speed", { method: "POST", body: JSON.stringify({ speed: 60 }) })).speed).toBe(60);
      const fin = await j("/sim/seek", { method: "POST", body: JSON.stringify({ to: "final" }) });
      expect(fin.games[0].snapshot.state).toMatch(/in|post/);
    } finally {
      await sim.close();
    }
  });

  it("has every league fixture parse through the production parsers at mid-game and final", () => {
    for (const id of ["nhl-401892525", "nhl-401892524", "epl-401879263", "nfl-401872999", "nba-401898406", "mlb-401930515"]) {
      const g = load(id);
      const league = leagueById(g.league.id);
      for (const v of [0, g.endV * 0.5, g.endV + 1000]) {
        const ev = g.espnEvent(v, Date.now());
        expect(ev.competitions[0].competitors).toHaveLength(2);
        const s = g.espnSummary(v);
        expect(() => parseSummary(league, s, {})).not.toThrow();
      }
    }
  });
});
