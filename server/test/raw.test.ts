import { describe, expect, it } from "vitest";
import fs from "node:fs";
import { leagueById } from "../src/leagues.js";
import { normalizeNhl, parsePbp } from "../src/providers/nhl.js";
import { normalizeEvent, pickLeader } from "../src/providers/espn.js";
import { finite, optStr, str, strArr } from "../src/providers/raw.js";

const nhl = leagueById("nhl");

function event(over: Record<string, unknown> = {}, team: Record<string, unknown> = {}) {
  const side = (homeAway: string, abbr: string) => ({ homeAway, id: abbr, score: "0", team: { id: abbr, abbreviation: abbr, displayName: abbr, name: abbr, logo: "http://logo", color: "112233", ...team } });
  return {
    id: "1",
    date: "2026-10-19T23:00Z",
    status: { type: { state: "pre", name: "STATUS_SCHEDULED" } },
    competitions: [{ competitors: [side("home", "MIN"), side("away", "CBJ")] }],
    ...over,
  };
}

describe("raw accessors", () => {
  it("only let real values through", () => {
    expect(str("a")).toBe("a");
    expect(str(7)).toBe("7");
    expect(str(NaN, "x")).toBe("x");
    expect(str({ a: 1 })).toBe("");
    expect(optStr("")).toBeUndefined();
    expect(optStr(null)).toBeUndefined();
    expect(optStr("ok")).toBe("ok");
    expect(finite("5.5")).toBe(5.5);
    expect(finite("")).toBeUndefined();
    expect(finite(Infinity)).toBeUndefined();
    expect(finite({})).toBeUndefined();
    expect(strArr(["a", 1, "", null, "b"])).toEqual(["a", "b"]);
    expect(strArr("nope")).toEqual([]);
  });
});

describe("ESPN scoreboard parsing under payload drift", () => {
  it("skips one event with an unparseable date instead of failing the whole scoreboard", () => {
    expect(normalizeEvent(nhl, event({ date: "not a date" }))).toBeUndefined();
    expect(normalizeEvent(nhl, event({ date: undefined }))).toBeUndefined();
    expect(normalizeEvent(nhl, event())?.id).toBe("nhl:1");
  });

  it("turns fields of the wrong type into missing values, never into objects in typed state", () => {
    const g = normalizeEvent(nhl, event({}, { logo: { href: "x" }, displayName: 42, name: { a: 1 } }));
    expect(g?.home.logo).toBe("");
    expect(g?.home.display_name).toBe("42");
    expect(typeof g?.home.name).toBe("string");
  });

  it("odds are strings and numbers or absent", () => {
    const ev = event();
    (ev.competitions[0] as Record<string, unknown>).odds = [{ details: { weird: true }, overUnder: "5.5" }];
    expect(normalizeEvent(nhl, ev)?.odds).toEqual({ details: undefined, over_under: 5.5 });
  });

  it("leader fields that are not strings are dropped", () => {
    const l = pickLeader({ leaders: [{ name: "points", leaders: [{ athlete: { id: 9, displayName: "Kirill Kaprizov", jersey: 97, position: { abbreviation: "LW" }, headshot: { href: "h" } } }] }] });
    expect(l).toMatchObject({ id: "9", first: "Kirill", last: "Kaprizov", jersey: "97", position: "LW", headshot: "h" });
    expect(pickLeader({ leaders: [{ name: "points", leaders: [{ athlete: { id: 9, displayName: { x: 1 } } }] }] })?.name).toBe("");
  });
});

describe("NHL parsing under payload drift", () => {
  it("captures stable scorer IDs from real score and PBP payloads and sweater numbers from the roster", () => {
    const score = JSON.parse(fs.readFileSync(new URL("./fixtures/nhl-score-now-live.json", import.meta.url), "utf8"));
    const pbp = JSON.parse(fs.readFileSync(new URL("./fixtures/nhl-pbp-2026020135.json", import.meta.url), "utf8"));
    const game = score.games.find((g: { goals?: unknown[] }) => g.goals?.length);
    expect(normalizeNhl(game).goals[0]).toMatchObject({ scorer_id: "nhl:8480434", scorer: "Sean Durzi" });
    expect(parsePbp(pbp).goals[0]).toMatchObject({ scorer_id: "nhl:8483525", scorer_number: "22", scorer: "Danila Yurov" });
  });

  it("does not invent scorer identity/number from names, missing rosters or malformed IDs", () => {
    for (const playerId of [undefined, {}, "abc", -1, 1.5]) {
      const g = normalizeNhl({ goals: [{ playerId, sweaterNumber: {}, name: { default: "Name" } }] });
      expect(g.goals[0]?.scorer_id).toBeUndefined();
      expect(g.goals[0]?.scorer_number).toBeUndefined();
    }
    const goals = parsePbp({ plays: [{ typeDescKey: "goal", details: { scoringPlayerId: 12345 } }] }).goals;
    expect(goals[0]?.scorer_id).toBe("nhl:12345");
    expect(goals[0]?.scorer_number).toBeUndefined();
    expect(goals[0]?.scorer).toBeUndefined();
  });

  it("score/now: names, ids and abbreviations always come out as strings and numbers", () => {
    const g = normalizeNhl({ id: "2026020135", gameDate: 20261019, homeTeam: { abbrev: { x: 1 }, name: { default: "Wild" } }, awayTeam: { abbrev: "CBJ" }, goals: [{ assists: [{ name: { default: "A" } }, { name: {} }], name: { default: "Solo" } }] });
    expect(g.id).toBe(2026020135);
    expect(g.date).toBe("20261019");
    expect(g.homeAbbr).toBe("");
    expect(g.goals[0]).toMatchObject({ scorer: "Solo", assists: ["A"] });
  });

  it("play-by-play: assists resolve through the roster and unknown players are dropped", () => {
    const g = parsePbp({
      id: 1,
      homeTeam: { id: 1, abbrev: "MIN" },
      awayTeam: { id: 2, abbrev: "CBJ" },
      rosterSpots: [{ playerId: 10, firstName: { default: "Kirill" }, lastName: { default: "Kaprizov" } }, { playerId: 11, firstName: { default: "Matt" }, lastName: { default: "Boldy" } }],
      plays: [{ typeDescKey: "goal", timeInPeriod: "05:00", periodDescriptor: { number: 1 }, details: { eventOwnerTeamId: 1, scoringPlayerId: 10, assist1PlayerId: 11, assist2PlayerId: 999, homeScore: 1, awayScore: 0 } }],
    });
    expect(g.goals[0]).toMatchObject({ team_abbr: "MIN", scorer: "Kirill Kaprizov", assists: ["Matt Boldy"] });
  });

  it("parses starting goalie probables from pre-game scoreboard fixture", () => {
    const raw = JSON.parse(fs.readFileSync(new URL("./fixtures/espn-nhl-scoreboard-pre.json", import.meta.url), "utf8"));
    const ev = raw.events[0];
    const game = normalizeEvent(nhl, ev);
    expect(game?.goalies).toBeDefined();
    expect(game?.goalies?.home?.name).toBe("Jakub Dobes");
    expect(game?.goalies?.home?.jersey).toBe("75");
    expect(game?.goalies?.home?.confirmed).toBe(false);
    expect(game?.goalies?.away?.name).toBe("Alex Nedeljkovic");
    expect(game?.goalies?.away?.jersey).toBe("33");
  });
});
