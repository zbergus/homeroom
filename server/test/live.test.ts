import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildStatRows } from "../src/providers/boxscore.js";
import { normalizeEvent } from "../src/providers/espn.js";
import { matchNhl, normalizeNhl, parsePbp } from "../src/providers/nhl.js";
import { parseSituation, strengthFromSituation } from "../src/providers/strength.js";
import { diffGame } from "../src/engine/diff.js";
import { matchesAny, triggersFor } from "../src/engine/triggers.js";
import { INTERNAL_ONLY } from "../src/outputs/dispatch.js";
import { leagueById } from "../src/leagues.js";
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

describe("Live NFL situation feed and trigger validation", () => {
  const nflSit = fx("espn-nfl-situation-live.json");
  const nflBoard = fx("espn-nfl-scoreboard.json");

  it("verifies live NFL scoreboard situation structure", () => {
    expect(nflSit.situation).toBeDefined();
    expect(nflSit.situation.down).toBe(3);
    expect(nflSit.situation.distance).toBe(22);
    expect(nflSit.situation.downDistanceText).toBe("3rd & 22 at SF 40");
    expect(nflSit.situation.possession).toBe("28");
    expect(nflSit.situation.lastPlay).toBeDefined();
  });

  it("normalizes live NFL situation into Game.football_situation", () => {
    const rawEv = structuredClone(nflBoard.events[0]);
    rawEv.competitions[0].situation = nflSit.situation;
    // ensure competitor with id "28" is WSH
    const comp = rawEv.competitions[0];
    comp.competitors[1].team.id = "28";
    comp.competitors[1].team.abbreviation = "WSH";

    const game = normalizeEvent(leagueById("nfl"), rawEv);
    expect(game).toBeDefined();
    expect(game?.football_situation).toBeDefined();
    expect(game?.football_situation?.down).toBe(3);
    expect(game?.football_situation?.distance).toBe(22);
    expect(game?.football_situation?.down_distance_text).toBe("3rd & 22 at SF 40");
    expect(game?.football_situation?.possession).toBe("WSH");
  });

  it("diffGame emits third_down for defense when transitioning to 3rd down", () => {
    const base: Game = {
      id: "nfl:401873008",
      league: "nfl",
      sport: "football",
      status: "in",
      start_time: new Date().toISOString(),
      period: 4,
      period_label: "4th",
      clock: "01:00",
      intermission: false,
      home: makeTeam("28", "SF", "49ers", "San Francisco 49ers", 23),
      away: makeTeam("30", "WSH", "Commanders", "Washington Commanders", 17),
      linescores: { home: [], away: [] },
      stats: { home: {}, away: {} },
      goals: [],
      football_situation: {
        down: 2,
        distance: 10,
        possession: "WSH",
        down_distance_text: "2nd & 10 at SF 28",
      },
    };

    const next: Game = {
      ...base,
      clock: "00:06",
      football_situation: {
        down: 3,
        distance: 22,
        possession: "WSH",
        down_distance_text: "3rd & 22 at SF 40",
      },
    };

    const dets = diffGame(base, next, 1);
    const third = dets.find((d) => d.type === "third_down");
    expect(third).toBeDefined();
    // Defense is SF (opponent of WSH with possession)
    expect(third?.team?.abbr).toBe("SF");
  });

  it("diffGame emits first_down for offense when converting to 1st down", () => {
    const base: Game = {
      id: "nfl:401873008",
      league: "nfl",
      sport: "football",
      status: "in",
      start_time: new Date().toISOString(),
      period: 4,
      period_label: "4th",
      clock: "02:00",
      intermission: false,
      home: makeTeam("28", "SF", "49ers", "San Francisco 49ers", 23),
      away: makeTeam("30", "WSH", "Commanders", "Washington Commanders", 17),
      linescores: { home: [], away: [] },
      stats: { home: {}, away: {} },
      goals: [],
      football_situation: {
        down: 3,
        distance: 2,
        possession: "WSH",
        down_distance_text: "3rd & 2 at SF 45",
      },
    };

    const next: Game = {
      ...base,
      clock: "01:30",
      football_situation: {
        down: 1,
        distance: 10,
        possession: "WSH",
        down_distance_text: "1st & 10 at SF 35",
      },
    };

    const dets = diffGame(base, next, 1);
    const first = dets.find((d) => d.type === "first_down");
    expect(first).toBeDefined();
    // Offense is WSH (team with possession)
    expect(first?.team?.abbr).toBe("WSH");
  });

  it("triggers and internal dispatching rules handle down events properly", () => {
    expect(INTERNAL_ONLY.has("first_down")).toBe(true);
    expect(INTERNAL_ONLY.has("third_down")).toBe(true);

    const dummyGame: Game = {
      id: "nfl:1",
      league: "nfl",
      sport: "football",
      status: "in",
      start_time: new Date().toISOString(),
      period: 1,
      period_label: "1st",
      clock: "10:00",
      intermission: false,
      home: makeTeam("1", "SF", "49ers", "San Francisco 49ers", 0),
      away: makeTeam("2", "WSH", "Commanders", "Washington Commanders", 0),
      linescores: { home: [], away: [] },
      stats: { home: {}, away: {} },
      goals: [],
    };

    const ev1 = {
      event_id: "evt_1",
      type: "first_down" as const,
      emitted_at: Date.now(),
      delay_s: 0,
      league: "nfl",
      sport: "football",
      game: dummyGame,
      team: dummyGame.away,
      natural_text: "First down, Washington Commanders.",
    };

    const ev3 = {
      event_id: "evt_2",
      type: "third_down" as const,
      emitted_at: Date.now(),
      delay_s: 0,
      league: "nfl",
      sport: "football",
      game: dummyGame,
      team: dummyGame.home,
      natural_text: "Third down defense, San Francisco 49ers.",
    };

    const ctx = { favorites: new Set<string>() };
    expect(matchesAny(["first_down"], ev1, ctx)).toBe(true);
    expect(matchesAny(["1st_down"], ev1, ctx)).toBe(true);
    expect(matchesAny(["third_down"], ev3, ctx)).toBe(true);
    expect(matchesAny(["3rd_down"], ev3, ctx)).toBe(true);
    expect(triggersFor(ev1, ctx)).toContain("first_down");
    expect(triggersFor(ev3, ctx)).toContain("third_down");
  });
});
