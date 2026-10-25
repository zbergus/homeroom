import { describe, expect, it } from "vitest";
import { normalizeAhlGame, parseAhlSummary } from "../src/providers/ahl.js";
import { leagueById } from "../src/leagues.js";

describe("AHL provider", () => {
  const sampleAhlGame = {
    ID: "1026850",
    SeasonId: "84",
    Date: "2026-10-24",
    GameDate: "Saturday, Oct 24",
    GameStatus: "Live",
    GameStatusString: "Live",
    Period: "2",
    PeriodNameLong: "2nd",
    PeriodNameShort: "2nd",
    TimeString: "11:20",
    HomeCity: "Hershey",
    HomeName: "Bears",
    HomeCode: "HER",
    HomeID: "304",
    HomeGoals: "2",
    HomeShots: "18",
    VisitorCity: "Providence",
    VisitorName: "Bruins",
    VisitorCode: "PRO",
    VisitorID: "308",
    VisitorGoals: "1",
    VisitorShots: "15",
  };

  it("normalizes an in-progress AHL game", () => {
    const ahl = leagueById("ahl");
    const g = normalizeAhlGame(ahl, sampleAhlGame);
    expect(g).toBeDefined();
    expect(g?.id).toBe("ahl:1026850");
    expect(g?.league).toBe("ahl");
    expect(g?.sport).toBe("hockey");
    expect(g?.status).toBe("in");
    expect(g?.home.abbr).toBe("HER");
    expect(g?.home.score).toBe(2);
    expect(g?.away.abbr).toBe("PRO");
    expect(g?.away.score).toBe(1);
    expect(g?.period).toBe(2);
    expect(g?.clock).toBe("11:20");
    expect(g?.sog).toEqual({ home: 18, away: 15 });
  });

  it("normalizes final and pregame AHL games", () => {
    const ahl = leagueById("ahl");
    const finalGame = { ...sampleAhlGame, GameStatus: "Final", GameStatusString: "Final", TimeString: "Final", Period: "3" };
    const fg = normalizeAhlGame(ahl, finalGame);
    expect(fg?.status).toBe("post");

    const preGame = { ...sampleAhlGame, GameStatus: "Scheduled", GameStatusString: "Scheduled", TimeString: "7:00 pm EDT", Period: "0" };
    const pg = normalizeAhlGame(ahl, preGame);
    expect(pg?.status).toBe("pre");
  });

  it("parses AHL game summary for goals and stat rows", () => {
    const ahl = leagueById("ahl");
    const sampleSummary = {
      GC: {
        Gamesummary: {
          goals: [
            {
              time: "04:12",
              period_id: "1",
              home: "1",
              goal_scorer: { first_name: "Ethen", last_name: "Frank", player_id: "8899", jersey_number: "28" },
              assist1_player: { first_name: "Mike", last_name: "Sgarbossa" },
              power_play: "1",
            },
          ],
          totalShots: { home: "28", visitor: "24" },
        },
      },
    };

    const parsed = parseAhlSummary(ahl, sampleSummary, "HER", "PRO");
    expect(parsed.plays.length).toBe(1);
    expect(parsed.plays[0]?.scorer).toBe("Ethen Frank");
    expect(parsed.plays[0]?.team_abbr).toBe("HER");
    expect(parsed.plays[0]?.scorer_number).toBe("28");
    expect(parsed.plays[0]?.strength).toBe("pp");
    expect(parsed.rows.length).toBeGreaterThan(0);
    const shotsRow = parsed.rows.find((r) => r.key === "shots");
    expect(shotsRow?.home).toBe("28");
    expect(shotsRow?.away).toBe("24");
  });
});

describe("IIHF leagues and tournaments", () => {
  it("defines iihf league with multiple ESPN hockey tournaments", () => {
    const iihf = leagueById("iihf");
    expect(iihf).toBeDefined();
    expect(iihf.sport).toBe("hockey");
    expect(iihf.espnTournaments?.length).toBeGreaterThan(0);
    expect(iihf.espnTournaments).toContain("hockey/olympics-mens-ice-hockey");
  });
});
