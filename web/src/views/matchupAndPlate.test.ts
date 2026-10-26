import { describe, expect, it } from "vitest";
import type { Game, SyncState, Team } from "../types";
import { pickMatchupGame } from "./Matchup";
import { pickTeamGame, singleTeamSituation } from "./Plate";

function makeTeam(abbr: string, name: string): Team {
  return {
    id: `team-${abbr}`,
    abbr,
    name,
    display_name: `${name} ${abbr}`,
    score: 0,
    record: "10-5-2",
  };
}

function makeGame(
  id: string,
  awayAbbr: string,
  homeAbbr: string,
  status: Game["status"],
  startInMin: number,
  period = 1,
): Game {
  return {
    id,
    league: "nhl",
    sport: "hockey",
    status,
    start_time: new Date(Date.now() + startInMin * 60_000).toISOString(),
    period: status === "pre" ? 0 : period,
    period_label: status === "pre" ? "" : "1st",
    clock: "15:00",
    intermission: false,
    home: makeTeam(homeAbbr, homeAbbr),
    away: makeTeam(awayAbbr, awayAbbr),
    linescores: { home: [], away: [] },
    stats: { home: {}, away: {} },
    goals: [],
  };
}

describe("Matchup / VS Screen: pickMatchupGame", () => {
  const now = Date.now();
  const g1 = makeGame("nhl:1", "CBJ", "MIN", "in", -30, 2);
  const g2 = makeGame("nhl:2", "BOS", "TOR", "pre", 45); // in 45 min
  const g3 = makeGame("nhl:3", "COL", "DAL", "pre", 90); // in 90 min
  const g4 = makeGame("nhl:4", "EDM", "VAN", "post", -180, 3);
  const games = [g1, g2, g3, g4];

  it("prioritizes upcoming pregame games with nearest puck drop in auto mode", () => {
    const picked = pickMatchupGame(games, "auto", null, null, now);
    expect(picked?.id).toBe("nhl:2"); // BOS @ TOR is upcoming in 45 min
  });

  it("selects specific game when wantGame query param is provided", () => {
    const picked = pickMatchupGame(games, "nhl:3", null, null, now);
    expect(picked?.id).toBe("nhl:3");
  });

  it("selects game by team abbreviation when wantTeam query param is provided", () => {
    const picked = pickMatchupGame(games, null, "MIN", null, now);
    expect(picked?.id).toBe("nhl:1");

    const pickedAway = pickMatchupGame(games, null, "BOS", null, now);
    expect(pickedAway?.id).toBe("nhl:2");
  });

  it("prioritizes user favorite / synced team upcoming game", () => {
    const sync: SyncState = {
      games: ["nhl:3"],
      favorites: [{ league: "nhl", abbr: "COL" }],
      effective: ["nhl:3"],
    };
    const picked = pickMatchupGame(games, "auto", null, sync, now);
    expect(picked?.id).toBe("nhl:3"); // COL @ DAL is favorite
  });

  it("falls back to in-progress game if no upcoming pregame game exists", () => {
    const liveOnly = [g1, g4];
    const picked = pickMatchupGame(liveOnly, "auto", null, null, now);
    expect(picked?.id).toBe("nhl:1");
  });

  it("expires finished games after FINAL_MS when finalSeen is provided in auto mode", () => {
    const finalSeen = new Map<string, number>();
    const finishedGame = makeGame("nhl:fin", "MTL", "WPG", "post", -120, 3);
    finalSeen.set("nhl:fin", now - 15 * 60_000); // seen 15 min ago (exceeds 10 min FINAL_MS)

    const picked = pickMatchupGame([finishedGame], "auto", null, null, now, finalSeen);
    expect(picked).toBeUndefined(); // Expired! Yields to idle / next game
  });

  it("immediately expires stale finished games started > 4 hours ago", () => {
    const staleYesterdayGame = makeGame("nhl:yesterday", "MTL", "WPG", "post", -300, 3); // started 5 hours ago
    const picked = pickMatchupGame([staleYesterdayGame], "auto", null, null, now);
    expect(picked).toBeUndefined(); // Stale yesterday game dropped
  });

  it("preserves finished games when explicitly requested by wantGame or wantTeam", () => {
    const finalSeen = new Map<string, number>();
    const finishedGame = makeGame("nhl:fin", "MTL", "WPG", "post", -300, 3);
    finalSeen.set("nhl:fin", now - 60 * 60_000);

    const pickedByGame = pickMatchupGame([finishedGame], "nhl:fin", null, null, now, finalSeen);
    expect(pickedByGame?.id).toBe("nhl:fin");

    const pickedByTeam = pickMatchupGame([finishedGame], null, "MTL", null, now, finalSeen);
    expect(pickedByTeam?.id).toBe("nhl:fin");
  });
});

describe("Single-team Score Plate: singleTeamSituation", () => {
  it("detects power play when my team has skater advantage", () => {
    const game = makeGame("nhl:1", "BOS", "TOR", "in", -20);
    game.situation = { advantage: "away", away_skaters: 5, home_skaters: 4 };

    // When viewing as Boston (Away)
    const sitAway = singleTeamSituation(game, false);
    expect(sitAway).toEqual({ type: "pp", text: "PP 5v4" });

    // When viewing as Toronto (Home)
    const sitHome = singleTeamSituation(game, true);
    expect(sitHome).toEqual({ type: "pk", text: "PK 4v5" });
  });

  it("detects 5v3 two-man power play advantage", () => {
    const game = makeGame("nhl:1", "BOS", "TOR", "in", -20);
    game.situation = { advantage: "home", away_skaters: 3, home_skaters: 5 };

    // When viewing as Toronto (Home)
    const sitHome = singleTeamSituation(game, true);
    expect(sitHome).toEqual({ type: "pp", text: "PP 5v3" });

    // When viewing as Boston (Away)
    const sitAway = singleTeamSituation(game, false);
    expect(sitAway).toEqual({ type: "pk", text: "PK 3v5" });
  });

  it("returns null when strength is even or situation is absent", () => {
    const game = makeGame("nhl:1", "BOS", "TOR", "in", -20);
    game.situation = { advantage: null, away_skaters: 5, home_skaters: 5 };

    expect(singleTeamSituation(game, true)).toBeNull();
    expect(singleTeamSituation(game, false)).toBeNull();
  });
});

describe("Single-team Score Plate: pickTeamGame", () => {
  const now = Date.now();
  const finalSeen = new Map<string, number>();

  const liveGame = makeGame("nhl:live", "BOS", "TOR", "in", -40, 2);
  const preGame = makeGame("nhl:pre", "BOS", "MTL", "pre", 60);
  const postGame = makeGame("nhl:post", "BOS", "NYR", "post", -300, 3);
  finalSeen.set("nhl:post", now - 15 * 60_000); // 15 min ago (expired)

  it("prioritizes live in-progress game over pregame or finished games", () => {
    const teamGames = [preGame, liveGame, postGame];
    const picked = pickTeamGame(teamGames, "auto", finalSeen, now);
    expect(picked?.id).toBe("nhl:live");
  });

  it("picks pregame game when no live game exists", () => {
    const teamGames = [preGame, postGame];
    const picked = pickTeamGame(teamGames, "auto", finalSeen, now);
    expect(picked?.id).toBe("nhl:pre");
  });

  it("honors explicit want game id", () => {
    const teamGames = [preGame, liveGame];
    const picked = pickTeamGame(teamGames, "nhl:pre", finalSeen, now);
    expect(picked?.id).toBe("nhl:pre");
  });
});
