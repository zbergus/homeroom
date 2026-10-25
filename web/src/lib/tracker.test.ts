import { describe, expect, it } from "vitest";
import { mockHockeyBoxscore } from "./mock";
import type { SkaterStats } from "../types";
import { compareSkaters, parseToiSeconds, type SkaterSortField } from "./hockey";

function sortSkaters(list: SkaterStats[], field: SkaterSortField, dir: "asc" | "desc"): SkaterStats[] {
  return [...list].sort((a, b) => compareSkaters(a, b, field, dir));
}

describe("Hockey Player Tracker", () => {
  it("mockHockeyBoxscore generates full skater and goalie stats", () => {
    const box = mockHockeyBoxscore("nhl:m1");
    expect(box.game_id).toBe("nhl:m1");

    // Away team (CBJ)
    expect(box.away.team.abbr).toBe("CBJ");
    expect(box.away.skaters.length).toBeGreaterThan(0);
    expect(box.away.goalies.length).toBe(1);

    const awayGoalie = box.away.goalies[0]!;
    expect(awayGoalie.name).toBe("Elvis Merzlikins");
    expect(awayGoalie.position).toBe("G");
    expect(awayGoalie.saves).toBeGreaterThanOrEqual(0);
    expect(awayGoalie.shots_against).toBeGreaterThan(0);
    expect(awayGoalie.saves + awayGoalie.goals_against).toBe(awayGoalie.shots_against);
    expect(awayGoalie.save_pct).toMatch(/^\.[0-9]{3}$|^1\.000$/);

    // Home team (MIN)
    expect(box.home.team.abbr).toBe("MIN");
    expect(box.home.skaters.length).toBeGreaterThan(0);
    expect(box.home.goalies.length).toBe(1);

    const homeGoalie = box.home.goalies[0]!;
    expect(homeGoalie.name).toBe("Filip Gustavsson");
    expect(homeGoalie.position).toBe("G");

    // Skaters
    const kaprizov = box.home.skaters.find((s) => s.name.includes("Kaprizov"));
    expect(kaprizov).toBeDefined();
    expect(kaprizov?.jersey).toBe("97");
    expect(kaprizov?.position).toBe("LW");
    expect(kaprizov?.toi).toMatch(/^[0-9]+:[0-9]{2}$/);
    expect(kaprizov?.points).toBe(kaprizov!.goals + kaprizov!.assists);
  });

  it("parses TOI (Time on Ice) strings correctly", () => {
    expect(parseToiSeconds("00:00")).toBe(0);
    expect(parseToiSeconds("01:30")).toBe(90);
    expect(parseToiSeconds("18:42")).toBe(18 * 60 + 42);
    expect(parseToiSeconds("25:15")).toBe(25 * 60 + 15);
    expect(parseToiSeconds("invalid")).toBe(0);
  });

  it("sorts skaters by Points, Goals, SOG, +/-, and TOI", () => {
    const sample: SkaterStats[] = [
      { id: "1", name: "Player A", toi: "12:00", sog: 2, plus_minus: -1, goals: 0, assists: 1, points: 1 },
      { id: "2", name: "Player B", toi: "20:00", sog: 5, plus_minus: 2, goals: 2, assists: 0, points: 2 },
      { id: "3", name: "Player C", toi: "16:30", sog: 3, plus_minus: 0, goals: 0, assists: 3, points: 3 },
    ];

    // Sort by PTS desc
    const byPts = sortSkaters(sample, "pts", "desc");
    expect(byPts[0]?.name).toBe("Player C"); // 3 pts
    expect(byPts[1]?.name).toBe("Player B"); // 2 pts
    expect(byPts[2]?.name).toBe("Player A"); // 1 pt

    // Sort by Goals desc
    const byGoals = sortSkaters(sample, "g", "desc");
    expect(byGoals[0]?.name).toBe("Player B"); // 2 goals

    // Sort by SOG desc
    const bySog = sortSkaters(sample, "sog", "desc");
    expect(bySog[0]?.name).toBe("Player B"); // 5 shots

    // Sort by +/- desc
    const byPm = sortSkaters(sample, "pm", "desc");
    expect(byPm[0]?.name).toBe("Player B"); // +2

    // Sort by TOI desc
    const byToi = sortSkaters(sample, "toi", "desc");
    expect(byToi[0]?.name).toBe("Player B"); // 20:00
    expect(byToi[1]?.name).toBe("Player C"); // 16:30
    expect(byToi[2]?.name).toBe("Player A"); // 12:00
  });
});
