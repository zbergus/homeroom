import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildFormRows, buildInsight, buildPlayerWatch, clearInsightCache, formSummary, parseSchedule, parseTeamStats } from "../src/providers/insight.js";
import { normalizeEvent, parseSummary, pickLeader } from "../src/providers/espn.js";
import { leagueById } from "../src/leagues.js";

const fx = (n: string) => JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", n), "utf8"));
beforeEach(clearInsightCache);

describe("team form", () => {
  it("parses the last completed games, oldest first, with W/L and venue", () => {
    const g = parseSchedule(fx("espn-nhl-team-schedule.json"), "30", "hockey", 5);
    expect(g).toHaveLength(5);
    expect(g.map((x) => x.date) ).toEqual([...g.map((x) => x.date)].sort());
    const last = g[g.length - 1]; // CBJ @ MIN 2-1, MIN won
    expect(last).toMatchObject({ opp_abbr: "CBJ", venue: "H", gf: 2, ga: 1, result: "W" });
    const loss = parseSchedule(fx("espn-nhl-team-schedule.json"), "30", "hockey").find((x) => x.opp_abbr === "WPG")!;
    expect(loss).toMatchObject({ gf: 2, ga: 5, result: "L", venue: "A" });
    expect(last.opp_logo).toMatch(/^https:\/\//);
  });

  it("summarises form as W-L-OTL for hockey and W-L elsewhere", () => {
    const g = parseSchedule(fx("espn-nhl-team-schedule.json"), "30", "hockey", 5);
    expect(formSummary(g, "hockey")).toMatch(/^\d+-\d+-\d+$/);
    expect(formSummary(g, "basketball")).toMatch(/^\d+-\d+$/);
  });

  it("hockey rows come from team stats with the right sign convention", () => {
    const st = parseTeamStats(fx("espn-nhl-team-stats.json"));
    const g = parseSchedule(fx("espn-nhl-team-schedule.json"), "30", "hockey", 5);
    const rows = buildFormRows("hockey", { games: g, stats: st }, { games: g, stats: st });
    expect(rows.map((r) => r.key)).toEqual(["gf", "ga", "sf", "sa", "sv", "fo"]);
    expect(rows.find((r) => r.key === "ga")!.lower_is_better).toBe(true);
    expect(rows.find((r) => r.key === "gf")!.home).toMatch(/^\d+\.\d$/);
    expect(rows.find((r) => r.key === "sv")!.home).toMatch(/^\.\d{3}$/);
    for (const r of rows) expect(Number.isFinite(r.home_n)).toBe(true);
  });

  it("falls back to last-5 scoring averages when team stats are missing, and to nothing when there is no data", () => {
    const g = parseSchedule(fx("espn-nhl-team-schedule.json"), "30", "hockey", 5);
    const rows = buildFormRows("basketball", { games: g }, { games: g });
    expect(rows.map((r) => r.label)).toEqual(["Points for / game (last 5)", "Points against / game (last 5)"]);
    expect(buildFormRows("hockey", { games: [] }, { games: [] })).toEqual([]);
  });
});

describe("players to watch", () => {
  it("picks the points leader from the scoreboard payload", () => {
    const ev = fx("espn-nhl-scoreboard-pre.json").events[0].competitions[0].competitors[0];
    const l = pickLeader(ev)!;
    expect(l.id).toBeTruthy();
    expect(l.first && l.last).toBeTruthy();
    expect(l.headshot).toMatch(/^https:\/\//);
    expect(pickLeader({ leaders: [] })).toBeUndefined();
  });

  it("builds season tiles and a last-5 points chart from the game log", () => {
    const leader = { id: "5080172", name: "Danila Yurov", first: "Danila", last: "Yurov", jersey: "22", position: "C", headshot: "https://x/y.png" };
    const p = buildPlayerWatch(leader, fx("espn-nhl-gamelog.json"), "MIN")!;
    expect(p.tiles.map((t) => t.label)).toEqual(["GOALS", "ASSISTS", "POINTS", "SHOTS"]);
    expect(p.tiles.find((t) => t.label === "POINTS")!.value).toBe("5"); // season totals from the fixture
    expect(p.log.length).toBeGreaterThan(0);
    expect(p.log.length).toBeLessThanOrEqual(5);
    expect(p.log.every((x) => Number.isFinite(x.value) && x.opp_abbr.length >= 2)).toBe(true);
    expect(buildPlayerWatch(leader, {}, "MIN")).toBeUndefined();
  });
});

describe("buildInsight orchestration", () => {
  const game = () => {
    const sb = fx("espn-nhl-scoreboard-pre.json").events[0];
    const g = normalizeEvent(leagueById("nhl"), sb)!;
    // the schedule/stats fixtures belong to team 30 (MIN); point both sides at it so the mocked feeds line up
    g.home.id = "30";
    g.away.id = "30";
    return g;
  };
  const deps = (over: Record<string, unknown> = {}) => ({
    teamSchedule: vi.fn(async () => fx("espn-nhl-team-schedule.json")),
    teamStats: vi.fn(async () => fx("espn-nhl-team-stats.json")),
    gamelog: vi.fn(async () => fx("espn-nhl-gamelog.json")),
    ...over,
  });

  it("produces form + players, and caches per team/player", async () => {
    const d = deps();
    const ins = (await buildInsight(game(), d))!;
    expect(ins.form!.rows.length).toBeGreaterThan(0);
    expect(ins.players?.home?.tiles.length).toBeGreaterThan(0);
    const calls = d.teamSchedule.mock.calls.length;
    await buildInsight(game(), d);
    expect(d.teamSchedule.mock.calls.length).toBe(calls); // 6 h cache
  });

  it("each part is independent: a failing game-log feed still yields form", async () => {
    const ins = (await buildInsight(game(), deps({ gamelog: async () => { throw new Error("503"); } })))!;
    expect(ins.form).toBeDefined();
    expect(ins.players).toBeUndefined();
  });

  it("returns undefined (screens hide) when every feed fails", async () => {
    const boom = async () => { throw new Error("down"); };
    expect(await buildInsight(game(), deps({ teamSchedule: boom, teamStats: boom, gamelog: boom }))).toBeUndefined();
  });
});

describe("parseSummary on real payloads", () => {
  it("hockey: scorer + assists + normalised strength, and stat rows from the same payload", () => {
    const s = fx("espn-nhl-summary.json");
    const ids = Object.fromEntries(s.header.competitions[0].competitors.map((c: any) => [c.id, c.team.abbreviation]));
    const { plays, rows } = parseSummary(leagueById("nhl"), s, ids);
    expect(plays.length).toBe(3);
    expect(plays[0]).toMatchObject({ scorer: "Danila Yurov", period: 1 });
    expect(plays[0].assists).toEqual(["Yakov Trenin"]);
    expect(plays.every((p) => !p.strength || ["ev", "pp", "sh", "en"].includes(p.strength))).toBe(true);
    expect(plays[0].team_abbr).toBe("MIN");
    expect(rows.length).toBe(7);
  });
});
