import { describe, expect, it } from "vitest";
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
});
