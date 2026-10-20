import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { Engine } from "../src/engine/engine.js";
import { diffGame } from "../src/engine/diff.js";
import { matchesAny, triggersFor } from "../src/engine/triggers.js";
import { leagueById } from "../src/leagues.js";
import { normalizeEvent, soccerPeriod } from "../src/providers/espn.js";
import { latestSituation, parsePbp, withOfficialStrength } from "../src/providers/nhl.js";
import { parseSituation, strengthFromSituation } from "../src/providers/strength.js";
import { Dispatcher, INTERNAL_ONLY } from "../src/outputs/dispatch.js";
import { Store } from "../src/store.js";
import type { EventPayload, Game, Team } from "../src/types.js";

const fx = (n: string) => JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", n), "utf8"));
const epl = (i: number) => normalizeEvent(leagueById("epl"), fx("espn-epl-scoreboard.json").events[i])!;

describe("soccer details -> goals and bookings (real EPL payloads)", () => {
  it("SUN @ BOU: scorers, running score and bookings come straight from the scoreboard", () => {
    const g = epl(0);
    expect(g.home.abbr).toBe("BOU");
    expect(g.goals.map((x) => [x.clock, x.team_abbr, x.scorer])).toEqual([["6'", "BOU", "Marcus Tavernier"], ["48'", "BOU", "Evanilson"]]);
    expect(g.goals.map((x) => [x.home_score, x.away_score])).toEqual([[1, 0], [2, 0]]);
    expect(g.goals[0].text).toBe("Goal - Header");
    expect(g.goals.map((x) => x.period)).toEqual([1, 2]);
    expect(g.incidents!.filter((i) => i.kind === "red")).toEqual([expect.objectContaining({ player: "Kevin Danso", clock: "17'" })]);
    expect(g.incidents!.filter((i) => i.kind === "yellow")).toHaveLength(5);
    expect(g.incidents!.find((i) => i.clock === "45'+6'")?.player).toBe("Lewis Cook");
  });

  it("an own goal is credited to the team that benefits", () => {
    const g = epl(1); // CRY @ BHA, all five goals go to BHA (team 331), the first is an own goal
    expect(g.goals[0]).toMatchObject({ team_abbr: g.home.abbr, text: "Own Goal", home_score: 1, away_score: 0 });
    expect(g.goals).toHaveLength(5);
    expect(g.goals.at(-1)).toMatchObject({ home_score: 5, away_score: 0 });
  });

  it("stoppage time stays in its half; extra time is recognised", () => {
    expect([soccerPeriod("45'+6'"), soccerPeriod("48'"), soccerPeriod("90'+3'"), soccerPeriod("105'"), soccerPeriod("112'"), soccerPeriod("?")]).toEqual([1, 2, 2, 3, 4, 1]);
  });

  it("shootout kicks are not match goals", () => {
    const ev = fx("espn-epl-scoreboard.json").events[0];
    ev.competitions[0].details.push({ type: { text: "Penalty - Scored" }, clock: { displayValue: "120'" }, team: { id: "349" }, scoringPlay: true, shootout: true, scoreValue: 1, athletesInvolved: [{ displayName: "X" }] });
    const g = normalizeEvent(leagueById("epl"), ev)!;
    expect(g.goals).toHaveLength(2);
  });
});

describe("card events", () => {
  const live = (g: Game): Game => ({ ...g, status: "in", period: 1, clock: "30'" });
  it("diff emits one card per NEW incident, none on first sight, none when nothing changed", () => {
    const base = live(epl(0));
    const earlier = { ...base, incidents: base.incidents!.slice(0, 3) };
    expect(diffGame(undefined, base, 1)).toEqual([]);
    const ev = diffGame(earlier, base, 1).filter((e) => e.type === "card");
    expect(ev).toHaveLength(base.incidents!.length - 3);
    expect(ev[0].key).toContain(":card:");
    expect(ev[0].team?.abbr).toBeTruthy();
    expect(diffGame(base, base, 1).filter((e) => e.type === "card")).toEqual([]);
  });

  it("the engine announces a booking once even if the feed drops and re-adds it", async () => {
    const store = new Store(":memory:");
    store.setSyncedGames(["epl:x"]);
    const engine = new Engine(store, undefined, { fetchSummary: async () => ({ plays: [], rows: [] }), retryMs: 1 });
    const events: EventPayload[] = [];
    engine.on("event", (e) => events.push(e));
    const g = { ...live(epl(0)), id: "epl:x" };
    const none = { ...g, incidents: [] };
    engine.ingestEspn(none);
    engine.ingestEspn(g); // 6 bookings appear
    await new Promise((r) => setTimeout(r, 30));
    const first = events.filter((e) => e.type === "card").length;
    expect(first).toBe(g.incidents!.length);
    engine.ingestEspn(none); // glitch: feed loses them
    engine.ingestEspn(g); // and gets them back
    await new Promise((r) => setTimeout(r, 30));
    expect(events.filter((e) => e.type === "card")).toHaveLength(first);
    const red = events.find((e) => e.card?.kind === "red")!;
    expect(red.natural_text).toMatch(/^Red card, .*Kevin Danso\.$/);
    expect(triggersFor(red, { favorites: new Set() })).toEqual(["red_card"]);
    expect(matchesAny(["yellow_card"], red, { favorites: new Set() })).toBe(false);
  });

  it("cards and power plays publish to the HA integration (patched ConnectedRoom speaks them); overturns stay internal", () => {
    expect(INTERNAL_ONLY.has("goal_overturned")).toBe(true);
    expect(INTERNAL_ONLY.has("card") || INTERNAL_ONLY.has("powerplay")).toBe(false);
    const calls = { ui: 0, pusher: 0, lights: 0 };
    const store = new Store(":memory:");
    const engine = new Engine(store);
    const d = new Dispatcher(engine, { event: () => calls.ui++ } as never, { publishPusher: () => (calls.pusher++, 1), publishRest: async () => {} } as never, { handle: () => (calls.lights++, 1) } as never);
    const ev = engine.fireTrigger({ trigger: "yellow_card", league: "epl" });
    d.handle(ev);
    expect(ev.type).toBe("card");
    expect(ev.manual).toBe(true);
    expect(calls).toEqual({ ui: 1, pusher: 1, lights: 1 });
  });
});

describe("NHL power play from the play-by-play situationCode (real game 2026020135)", () => {
  const pbp = fx("nhl-pbp-2026020135.json");
  const game = parsePbp(pbp);

  it("parses codes: 1451 = away short a man (home power play), 1541 = away power play, 0651 = empty net, not a power play", () => {
    expect(parseSituation("1551")).toMatchObject({ advantage: null, home_skaters: 5, away_skaters: 5 });
    expect(parseSituation("1451")).toMatchObject({ advantage: "home", away_skaters: 4, home_skaters: 5 });
    expect(parseSituation("1351")?.advantage).toBe("home");
    expect(parseSituation("1541")?.advantage).toBe("away");
    expect(parseSituation("0651")).toMatchObject({ advantage: null, away_goalie: false });
    expect(parseSituation("nope")).toBeUndefined();
  });

  it("matches the real game: CBJ (away) holds at 2nd 1:50 and MIN (home) is on the power play at 3:06 when it scores", () => {
    const plays = pbp.plays as { periodDescriptor: { number: number }; timeInPeriod: string; situationCode: string }[];
    const at = (period: number, time: string) => plays.find((p) => p.periodDescriptor.number === period && p.timeInPeriod === time);
    expect(parseSituation(at(2, "03:06")!.situationCode)?.advantage).toBe("home"); // MIN power-play goal (ESPN also tags it pp)
    expect(parseSituation(at(2, "12:34")!.situationCode)?.advantage).toBe(null); // penalty call itself, code updates on the next event
    expect(latestSituation(plays.filter((p) => p.periodDescriptor.number === 2 && p.timeInPeriod <= "12:34"))).toMatchObject({ advantage: "away" }); // after the faceoff, CBJ power play
    expect(game.goals.length).toBe(3);
    expect(game.goals.map((g) => g.strength)).toEqual(["ev", "ev", "pp"]);
    expect(game.goals[1].team_abbr).toBe("CBJ");
  });

  it("a goal scored with the goalie pulled is not a power-play goal; the NHL's own strength wins when it has one", () => {
    const official = game.goals.map((g) => ({ ...g, strength: "sh" as const }));
    expect(withOfficialStrength(game.goals, official).map((g) => g.strength)).toEqual(["sh", "sh", "sh"]);
    expect(withOfficialStrength(game.goals, []).map((g) => g.strength)).toEqual(["ev", "ev", "pp"]); // derived fallback
    expect(strengthFromSituation("0651", false)).toBe("ev"); // away scorer, away goalie out
    expect(strengthFromSituation("0651", true)).toBe("en"); // home scorer into the empty net
    expect(strengthFromSituation("1451", true)).toBe("pp");
    expect(strengthFromSituation("1451", false)).toBe("sh");
  });

  it("engine: a side gaining the advantage fires one powerplay event; repeats within 20 s are suppressed; the other side's PP is separate", async () => {
    const store = new Store(":memory:");
    store.setSyncedGames(["nhl:1"]);
    const engine = new Engine(store, undefined, { fetchSummary: async () => ({ plays: [], rows: [] }), retryMs: 1 });
    const events: EventPayload[] = [];
    engine.on("event", (e) => events.push(e));
    const rgb = { r: 1, g: 2, b: 3 };
    const team = (abbr: string): Team => ({ id: abbr, abbr, name: abbr, display_name: `City ${abbr}`, logo: "", score: 0, options: { primary_color_rgb: rgb, secondary_color_rgb: rgb, alternate_color_rgb: rgb } });
    const base: Game = { id: "nhl:1", league: "nhl", sport: "hockey", status: "in", start_time: new Date().toISOString(), period: 2, period_label: "", clock: "10:00", intermission: false, home: team("MIN"), away: team("CBJ"), linescores: { home: [], away: [] }, stats: { home: {}, away: {} }, goals: [] };
    const nhl = (code: string) => {
      const p = parseSituation(code)!;
      return { id: 1, date: "", start_utc: "", homeNick: "", awayNick: "", homeAbbr: "MIN", awayAbbr: "CBJ", state: "in" as const, period: 2, clock: "10:00", inIntermission: false, homeScore: 0, awayScore: 0, goals: [], situation: { advantage: p.advantage, home_skaters: p.home_skaters, away_skaters: p.away_skaters } };
    };
    engine.ingestEspn(base);
    engine.ingestNhl("nhl:1", nhl("1551")); // even: first sight of a situation seeds silently
    engine.ingestNhl("nhl:1", nhl("1451")); // MIN power play
    engine.ingestNhl("nhl:1", nhl("1351")); // 5v3: same side, no new event
    engine.ingestNhl("nhl:1", nhl("1551"));
    engine.ingestNhl("nhl:1", nhl("1451")); // flicker back within 20 s: suppressed
    engine.ingestNhl("nhl:1", nhl("1541")); // CBJ power play: a different team, announced
    await new Promise((r) => setTimeout(r, 30));
    const pp = events.filter((e) => e.type === "powerplay");
    expect(pp.map((e) => e.team?.abbr)).toEqual(["MIN", "CBJ"]);
    expect(pp[0].natural_text).toBe("Power play, City MIN.");
    expect(triggersFor(pp[0], { favorites: new Set() })).toEqual(["powerplay"]);
  });
});
