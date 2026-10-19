import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildStatRows } from "../src/providers/boxscore.js";

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

  it("basketball: percents get a % sign; turnovers are lower-is-better", () => {
    const r = rows("basketball", "nba");
    expect(by(r, "fg").away).toBe("43%");
    expect(by(r, "reb")).toBeDefined();
    expect(by(r, "tov").lower_is_better).toBe(true);
  });

  it("football: ratio strings, possession time in seconds, penalties count", () => {
    const r = rows("football", "nfl");
    expect(by(r, "third").away).toBe("5/11");
    expect(by(r, "third").away_n).toBeCloseTo(5 / 11);
    expect(by(r, "top").away).toBe("29:37");
    expect(by(r, "top").away_n).toBe(29 * 60 + 37);
    expect(by(r, "penalties").away).toBe("6");
  });

  it("baseball: flattens the nested batting/fielding categories", () => {
    const r = rows("baseball", "mlb");
    expect(r.map((x) => x.key)).toEqual(["hits", "hr", "bb", "k", "lob", "err"]);
    expect(by(r, "hits").away).toBe("12");
    expect(by(r, "lob").away).toBe("21");
  });

  it("soccer: possession %, derived pass accuracy, and cards (EPL and MLS)", () => {
    for (const league of ["epl", "mls"]) {
      const r = rows("soccer", league);
      expect(by(r, "poss").away.endsWith("%") && by(r, "poss").home.endsWith("%")).toBe(true);
      expect(by(r, "passes").home).toMatch(/^\d+%$/);
      expect(by(r, "shots")).toBeDefined();
      expect(by(r, "yellow").lower_is_better).toBe(true);
    }
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
