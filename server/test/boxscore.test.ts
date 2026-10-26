import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildStatRows } from "../src/providers/boxscore.js";
import { fallbackBoxscore, parseEspnPlayerBoxscore, parseNhlApiBoxscore } from "../src/providers/playerBoxscore.js";
import type { Game } from "../src/types.js";

const fx = (name: string) => JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", name), "utf8"));
const rows = (sport: string, league: string) => buildStatRows(sport, fx(`espn-${league}-summary.json`).boxscore.teams);
const by = (r: ReturnType<typeof rows>, key: string) => r.find((x) => x.key === key)!;

describe("buildStatRows against real ESPN boxscores", () => {
  it("hockey: the seven reference rows, in order, with ratio and percent formatting", () => {
    const r = rows("hockey", "nhl");
    expect(r.map((x) => x.key)).toEqual(["shots", "hits", "faceoffs", "powerplay", "takeaways", "giveaways", "pim"]);
    // fixture: CBJ (away) 15 shots, 29 hits, 47.8 faceoff %, 0/2 PP, 6 takeaways, 19 giveaways, 8 PIM
    expect(by(r, "shots")).toMatchObject({ away: "15", away_n: 15 });
    expect(by(r, "hits").away).toBe("29");
    expect(by(r, "faceoffs").away).toBe("48%");
    expect(by(r, "powerplay").away).toBe("0/2");
    expect(by(r, "powerplay").away_n).toBe(0);
    expect(by(r, "giveaways").lower_is_better).toBe(true);
    expect(by(r, "shots").lower_is_better).toBeUndefined();
    for (const x of r) expect(Number.isFinite(x.home_n) && Number.isFinite(x.away_n)).toBe(true);
  });

  it("is defensive: unknown sport, missing teams, missing stats", () => {
    expect(buildStatRows("curling", fx("espn-nhl-summary.json").boxscore.teams)).toEqual([]);
    expect(buildStatRows("hockey", undefined)).toEqual([]);
    expect(buildStatRows("hockey", [{ homeAway: "home", statistics: [] }, { homeAway: "away", statistics: [] }])).toEqual([]);
    const t = fx("espn-nhl-summary.json").boxscore.teams;
    t[0].statistics = t[0].statistics.filter((s: { name: string }) => s.name !== "hits"); // one side lacks a stat
    expect(buildStatRows("hockey", t).some((x) => x.key === "hits")).toBe(false);
  });
});

describe("playerBoxscore parser", () => {
  const dummyGame: Game = {
    id: "nhl:401560000",
    league: "nhl",
    sport: "hockey",
    status: "in",
    start_time: "2026-10-25T19:00:00Z",
    period: 3,
    period_label: "3rd",
    clock: "12:12",
    intermission: false,
    home: { id: "16", abbr: "PIT", name: "Penguins", display_name: "Pittsburgh Penguins", logo: "", score: 5, options: { primary_color_rgb: { r: 0, g: 0, b: 0 }, secondary_color_rgb: { r: 253, g: 183, b: 26 }, alternate_color_rgb: { r: 255, g: 255, b: 255 } } },
    away: { id: "12", abbr: "UTA", name: "Mammoth", display_name: "Utah Mammoth", logo: "", score: 3, options: { primary_color_rgb: { r: 0, g: 0, b: 0 }, secondary_color_rgb: { r: 0, g: 0, b: 0 }, alternate_color_rgb: { r: 255, g: 255, b: 255 } } },
    linescores: { home: [1, 2, 2], away: [0, 2, 1] },
    stats: { home: {}, away: {} },
    goals: [],
  };

  it("parses real ESPN summary player boxscore fixture", () => {
    const raw = fx("espn-nhl-summary-live.json");
    const parsed = parseEspnPlayerBoxscore(raw, dummyGame);
    expect(parsed).not.toBeNull();
    if (!parsed) return;

    expect(parsed.game_id).toBe("nhl:401560000");
    // Pittsburgh Penguins (home)
    expect(parsed.home.skaters.length).toBe(18);
    expect(parsed.home.goalies.length).toBe(1);

    const chinakhov = parsed.home.skaters.find((s) => s.name.includes("Chinakhov"));
    expect(chinakhov).toBeDefined();
    expect(chinakhov?.goals).toBe(1);
    expect(chinakhov?.toi).toBe("12:12");
    expect(chinakhov?.sog).toBe(1);
    expect(chinakhov?.plus_minus).toBe(-1);

    const silovs = parsed.home.goalies[0];
    expect(silovs?.name).toContain("Silovs");
    expect(silovs?.saves).toBe(23);
    expect(silovs?.shots_against).toBe(28);
    expect(silovs?.save_pct).toBe(".821");
    expect(silovs?.goals_against).toBe(5);

    // Utah (away)
    expect(parsed.away.skaters.length).toBe(18);
    expect(parsed.away.goalies.length).toBe(1);
    const cossa = parsed.away.goalies[0];
    expect(cossa?.name).toContain("Cossa");
    expect(cossa?.saves).toBe(12);
    expect(cossa?.shots_against).toBe(15);
    expect(cossa?.save_pct).toBe(".800");
  });

  it("parses NHL API boxscore structure with shotsAgainst and orders active starter first", () => {
    const nhlRaw = {
      playerByGameStats: {
        awayTeam: {
          forwards: [
            { playerId: 101, name: { default: "Connor McDavid" }, sweaterNumber: 97, position: "C", goals: 2, assists: 1, sog: 5, plusMinus: 2, toi: "21:30" },
          ],
          defense: [],
          goalies: [
            // Backup listed first in API response with 0 TOI
            { playerId: 202, name: { default: "Calvin Pickard" }, sweaterNumber: 30, saves: 0, shotsAgainst: 0, goalsAgainst: 0, savePctg: 0, toi: "00:00", starter: false },
            // Starter listed second with full TOI and 1.000 SV%
            { playerId: 201, name: { default: "Stuart Skinner" }, sweaterNumber: 74, saves: 28, shotsAgainst: 28, goalsAgainst: 0, savePctg: 1.0, toi: "60:00", starter: true },
          ],
        },
        homeTeam: {
          forwards: [],
          defense: [],
          goalies: [],
        },
      },
    };

    const parsed = parseNhlApiBoxscore(nhlRaw, dummyGame);
    expect(parsed).not.toBeNull();
    if (!parsed) return;
    expect(parsed.away.skaters.length).toBe(1);
    expect(parsed.away.skaters[0]?.name).toBe("Connor McDavid");
    expect(parsed.away.skaters[0]?.points).toBe(3);
    expect(parsed.away.skaters[0]?.toi).toBe("21:30");
    // Stuart Skinner should be sorted to index 0 because of higher TOI and starter status
    expect(parsed.away.goalies[0]?.name).toBe("Stuart Skinner");
    expect(parsed.away.goalies[0]?.shots_against).toBe(28);
    expect(parsed.away.goalies[0]?.saves).toBe(28);
    expect(parsed.away.goalies[0]?.save_pct).toBe("1.000");
    // Backup is second
    expect(parsed.away.goalies[1]?.name).toBe("Calvin Pickard");
    expect(parsed.away.goalies[1]?.toi).toBe("00:00");
  });

  it("generates defensive fallback boxscore with calculated goalie stats and goals", () => {
    const gameWithGoals: Game = {
      ...dummyGame,
      sog: { home: 35, away: 25 },
      goals: [
        {
          key: "g1",
          period: 1,
          period_label: "1st",
          clock: "10:00",
          team_abbr: "PIT",
          scorer: "Sidney Crosby",
          scorer_number: "87",
          assists: ["Kris Letang"],
          home_score: 1,
          away_score: 0,
        },
      ],
    };

    const fb = fallbackBoxscore(gameWithGoals);
    expect(fb.game_id).toBe(gameWithGoals.id);
    expect(fb.home.skaters.length).toBe(2);
    const crosby = fb.home.skaters.find((s) => s.name === "Sidney Crosby");
    expect(crosby?.goals).toBe(1);
    expect(crosby?.jersey).toBe("87");
    const letang = fb.home.skaters.find((s) => s.name === "Kris Letang");
    expect(letang?.assists).toBe(1);

    // Goalie saves calculated from SOG and score
    // away goalie faced home sog (35) and allowed home score (5) -> 30 saves, svPct 30/35 = .857
    expect(fb.away.goalies[0]?.saves).toBe(30);
    expect(fb.away.goalies[0]?.shots_against).toBe(35);
    expect(fb.away.goalies[0]?.save_pct).toBe(".857");
  });
});
