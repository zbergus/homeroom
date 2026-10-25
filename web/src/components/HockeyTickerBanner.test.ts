import { describe, expect, it } from "vitest";
import type { Game, Team } from "../types";
import { findShots, getTickerAlert } from "./HockeyTickerBanner";

const makeTeam = (abbr: string, name: string): Team => ({
  id: abbr.toLowerCase(),
  abbr,
  name,
  display_name: `${name} (${abbr})`,
  score: 0,
});

const makeGame = (overrides?: Partial<Game>): Game => ({
  id: "test:game1",
  league: "nhl",
  sport: "hockey",
  status: "in",
  start_time: "2026-10-25T19:00:00Z",
  period: 2,
  period_label: "2nd period",
  clock: "10:00",
  intermission: false,
  away: makeTeam("BOS", "Bruins"),
  home: makeTeam("TOR", "Maple Leafs"),
  linescores: { home: [], away: [] },
  stats: { home: {}, away: {} },
  goals: [],
  ...overrides,
});

describe("findShots", () => {
  it("extracts shots from direct sog field", () => {
    const g = makeGame({ sog: { away: 24, home: 31 } });
    expect(findShots(g)).toEqual({ away: 24, home: 31 });
  });

  it("extracts shots from stat_rows when sog is absent", () => {
    const g = makeGame({
      stat_rows: [
        { key: "shots", label: "Shots", away: "18", home: "22", away_n: 18, home_n: 22 },
      ],
    });
    expect(findShots(g)).toEqual({ away: "18", home: "22" });
  });

  it("extracts shots from legacy stats map", () => {
    const g = makeGame({
      stats: {
        away: { SOG: 19 },
        home: { SOG: 25 },
      },
    });
    expect(findShots(g)).toEqual({ away: 19, home: 25 });
  });

  it("returns null when no shots are available", () => {
    const g = makeGame();
    expect(findShots(g)).toBeNull();
  });
});

describe("getTickerAlert", () => {
  it("detects intermission and formats period label", () => {
    const g = makeGame({
      intermission: true,
      period: 2,
      period_label: "2nd period",
      clock: "00:00",
    });
    expect(getTickerAlert(g)).toEqual({
      kind: "intermission",
      text: "END 2ND",
    });
  });

  it("includes running clock in intermission alert if present", () => {
    const g = makeGame({
      intermission: true,
      period: 1,
      period_label: "1st period",
      clock: "14:32",
    });
    expect(getTickerAlert(g)).toEqual({
      kind: "intermission",
      text: "END 1ST · 14:32",
    });
  });

  it("detects powerplay 5v4 for home team", () => {
    const g = makeGame({
      situation: { advantage: "home", home_skaters: 5, away_skaters: 4 },
    });
    expect(getTickerAlert(g)).toEqual({
      kind: "pp",
      text: "PP 5v4",
      teamAbbr: "TOR",
      side: "home",
    });
  });

  it("detects 5v3 two-man advantage powerplay for away team", () => {
    const g = makeGame({
      situation: { advantage: "away", home_skaters: 3, away_skaters: 5 },
    });
    expect(getTickerAlert(g)).toEqual({
      kind: "pp",
      text: "PP 5v3",
      teamAbbr: "BOS",
      side: "away",
    });
  });

  it("detects 4-on-4 even strength skater situation", () => {
    const g = makeGame({
      situation: { advantage: null, home_skaters: 4, away_skaters: 4 },
    });
    expect(getTickerAlert(g)).toEqual({
      kind: "strength",
      text: "4v4",
    });
  });

  it("detects 3-on-3 overtime skater situation", () => {
    const g = makeGame({
      situation: { advantage: null, home_skaters: 3, away_skaters: 3 },
    });
    expect(getTickerAlert(g)).toEqual({
      kind: "strength",
      text: "3v3 OT",
    });
  });

  it("detects empty net when goalie is pulled (6 skaters)", () => {
    const g = makeGame({
      situation: { advantage: null, home_skaters: 6, away_skaters: 5 },
    });
    expect(getTickerAlert(g)).toEqual({
      kind: "empty_net",
      text: "EMPTY NET",
      teamAbbr: "TOR",
      side: "home",
    });
  });

  it("detects empty net when explicit empty_net flag is present", () => {
    const g = makeGame({
      situation: { advantage: null, home_skaters: 5, away_skaters: 5, empty_net: "away" },
    });
    expect(getTickerAlert(g)).toEqual({
      kind: "empty_net",
      text: "EMPTY NET",
      teamAbbr: "BOS",
      side: "away",
    });
  });

  it("returns null during standard 5v5 play", () => {
    const g = makeGame({
      situation: { advantage: null, home_skaters: 5, away_skaters: 5 },
    });
    expect(getTickerAlert(g)).toBeNull();
  });

  it("returns null for pre-game status", () => {
    const g = makeGame({
      status: "pre",
      situation: { advantage: "home", home_skaters: 5, away_skaters: 4 },
    });
    expect(getTickerAlert(g)).toBeNull();
  });
});
