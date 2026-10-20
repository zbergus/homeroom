import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildStatRows } from "../src/providers/boxscore.js";
import { matchNhl, normalizeNhl, parsePbp } from "../src/providers/nhl.js";
import { parseSituation, strengthFromSituation } from "../src/providers/strength.js";
import { diffGame } from "../src/engine/diff.js";
import type { Game, Team } from "../src/types.js";

const fx = (name: string) => JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", name), "utf8"));

const dummyColors = {
  primary_color_rgb: { r: 0, g: 0, b: 0 },
  secondary_color_rgb: { r: 255, g: 255, b: 255 },
  alternate_color_rgb: { r: 255, g: 255, b: 255 },
};

const makeTeam = (id: string, abbr: string, name: string, displayName: string, score: number): Team => ({
  id,
  abbr,
  name,
  display_name: displayName,
  logo: "",
  score,
  options: dummyColors,
});

describe("Live feed validation (PIT @ UTA, game 2026020140)", () => {
  const pbpRaw = fx("nhl-pbp-2026020140-live.json");
  const scoreRaw = fx("nhl-score-now-live.json");
  const pbpGame = parsePbp(pbpRaw);
  const nhlGames = scoreRaw.games.map(normalizeNhl);
  const liveNhlScore = nhlGames.find((g: { id: number }) => g.id === 2026020140)!;

  it("normalizes live NHL score/now correctly", () => {
    expect(liveNhlScore).toBeDefined();
    expect(liveNhlScore.homeAbbr).toBe("UTA");
    expect(liveNhlScore.awayAbbr).toBe("PIT");
    expect(liveNhlScore.homeNick).toBe("mammoth");
    expect(liveNhlScore.awayNick).toBe("penguins");
    expect(liveNhlScore.state).toBe("in");
    expect(liveNhlScore.period).toBe(3);
    expect(liveNhlScore.homeScore).toBe(5);
    expect(liveNhlScore.awayScore).toBe(3);
  });

  it("parses live play-by-play with roster lookup, scorer, assists, and strengths", () => {
    expect(pbpGame.id).toBe(2026020140);
    expect(pbpGame.state).toBe("in");
    expect(pbpGame.period).toBe(3);
    expect(pbpGame.homeNick).toBe("mammoth");
    expect(pbpGame.awayNick).toBe("penguins");
    expect(pbpGame.goals.length).toBe(8);

    // Goal 1: PIT power play goal
    const g1 = pbpGame.goals[0];
    expect(g1.period).toBe(1);
    expect(g1.team_abbr).toBe("PIT");
    expect(g1.scorer).toBe("Erik Karlsson");
    expect(g1.assists.length).toBeGreaterThan(0);
    expect(g1.strength).toBe("pp");
    expect(g1.home_score).toBe(0);
    expect(g1.away_score).toBe(1);

    // Goal 7: UTA power play goal at 01:36 in 3rd period
    const g7 = pbpGame.goals[6];
    expect(g7.period).toBe(3);
    expect(g7.clock).toBe("01:36");
    expect(g7.team_abbr).toBe("UTA");
    expect(g7.scorer).toBe("Nick Schmaltz");
    expect(g7.strength).toBe("pp");
    expect(g7.home_score).toBe(5);
    expect(g7.away_score).toBe(2);

    // Goal 8: PIT even strength goal
    const g8 = pbpGame.goals[7];
    expect(g8.period).toBe(3);
    expect(g8.clock).toBe("02:55");
    expect(g8.team_abbr).toBe("PIT");
    expect(g8.scorer).toBe("Egor Chinakhov");
    expect(g8.strength).toBe("ev");
  });

  it("detects live power play situations accurately", () => {
    // 1451: UTA power play (away short a man)
    const sit1451 = parseSituation("1451");
    expect(sit1451?.advantage).toBe("home");
    expect(sit1451?.home_skaters).toBe(5);
    expect(sit1451?.away_skaters).toBe(4);

    // 1541: PIT power play (home short a man)
    const sit1541 = parseSituation("1541");
    expect(sit1541?.advantage).toBe("away");
    expect(sit1541?.home_skaters).toBe(4);
    expect(sit1541?.away_skaters).toBe(5);

    // latest situation in pbp
    expect(pbpGame.situation).toBeDefined();
  });

  it("matches ESPN live game to NHL game via matchNhl", () => {
    const espnFake: Game = {
      id: "nhl:401892538",
      league: "nhl",
      sport: "hockey",
      status: "in",
      start_time: liveNhlScore.start_utc,
      period: 3,
      period_label: "3rd",
      clock: "12:18",
      intermission: false,
      home: makeTeam("uta", "UTA", "Mammoth", "Utah Mammoth", 5),
      away: makeTeam("pit", "PIT", "Penguins", "Pittsburgh Penguins", 3),
      linescores: { home: [], away: [] },
      stats: { home: {}, away: {} },
      goals: [],
    };
    const matched = matchNhl(espnFake, nhlGames);
    expect(matched).toBeDefined();
    expect(matched?.id).toBe(2026020140);
  });

  it("builds boxscore stat rows from live ESPN summary", () => {
    const sumRaw = fx("espn-nhl-summary-live.json");
    const statRows = buildStatRows("hockey", sumRaw.boxscore?.teams);
    expect(statRows.length).toBeGreaterThan(0);
    const keys = statRows.map((r) => r.key);
    expect(keys).toContain("shots");
    expect(keys).toContain("hits");
    expect(keys).toContain("faceoffs");
    expect(keys).toContain("powerplay");
  });

  it("verifies live pulled goalie situationCode 0651 suppresses power play", () => {
    const emptyNetPbp = parsePbp(fx("nhl-pbp-2026020140-emptynet.json"));
    expect(emptyNetPbp.situation).toMatchObject({
      advantage: null,
      away_skaters: 6,
      home_skaters: 5,
    });
    // Pulled goalie is not a power play
    const sit = parseSituation("0651");
    expect(sit?.advantage).toBeNull();
    expect(sit?.away_goalie).toBe(false);
    expect(sit?.home_goalie).toBe(true);
    expect(strengthFromSituation("0651", false)).toBe("ev");
    expect(strengthFromSituation("0651", true)).toBe("en");
  });

  it("handles live game end transition (CRIT -> FINAL)", () => {
    const finalScore = fx("nhl-score-now-final.json").games.map(normalizeNhl).find((g: { id: number }) => g.id === 2026020140)!;
    expect(finalScore.state).toBe("post");
    expect(finalScore.clock).toBe("00:00");
    expect(finalScore.homeScore).toBe(5);
    expect(finalScore.awayScore).toBe(4);

    const prevLive: Game = {
      id: "nhl:401892538",
      league: "nhl",
      sport: "hockey",
      status: "in",
      start_time: finalScore.start_utc,
      period: 3,
      period_label: "3rd",
      clock: "00:23",
      intermission: false,
      home: makeTeam("uta", "UTA", "Mammoth", "Utah Mammoth", 5),
      away: makeTeam("pit", "PIT", "Penguins", "Pittsburgh Penguins", 4),
      linescores: { home: [], away: [] },
      stats: { home: {}, away: {} },
      goals: [],
    };
    const nextFinal: Game = { ...prevLive, status: "post", clock: "" };
    const dets = diffGame(prevLive, nextFinal, 1);
    expect(dets).toEqual([{ type: "game_end" }]);
  });
});

describe("Live NFL situation feed validation", () => {
  const nflSit = fx("espn-nfl-situation-live.json");

  it("verifies live NFL scoreboard situation structure", () => {
    expect(nflSit.situation).toBeDefined();
    expect(nflSit.situation.down).toBe(3);
    expect(nflSit.situation.distance).toBe(22);
    expect(nflSit.situation.downDistanceText).toBe("3rd & 22 at SF 40");
    expect(nflSit.situation.possession).toBe("28");
    expect(nflSit.situation.lastPlay).toBeDefined();
  });
});
