import { describe, expect, it, vi } from "vitest";
import { diffGame } from "../src/engine/diff.js";
import { DelayBuffer, validDelay } from "../src/engine/delay.js";
import { naturalText, scoringLabel } from "../src/engine/text.js";
import type { Game, Team } from "../src/types.js";

const rgb = { r: 1, g: 2, b: 3 };
const team = (abbr: string, name: string, score = 0): Team => ({
  id: abbr, abbr, name, display_name: `City ${name}`, logo: "", score,
  options: { primary_color_rgb: rgb, secondary_color_rgb: rgb, alternate_color_rgb: rgb },
});
const game = (over: Partial<Game> = {}): Game => ({
  id: "nhl:1", league: "nhl", sport: "hockey", status: "in", start_time: "2026-01-01T00:00:00Z",
  period: 1, period_label: "1st period", clock: "10:00", intermission: false,
  home: team("MIN", "Wild"), away: team("CBJ", "Blue Jackets"),
  linescores: { home: [], away: [] }, stats: { home: {}, away: {} }, goals: [], ...over,
});
const withScore = (g: Game, h: number, a: number): Game => ({
  ...g, home: { ...g.home, score: h }, away: { ...g.away, score: a },
});

describe("diffGame", () => {
  it("seeds silently on first sight", () => {
    expect(diffGame(undefined, withScore(game(), 3, 2), 1)).toEqual([]);
  });
  it("game_start on pre -> in", () => {
    const ev = diffGame(game({ status: "pre", period: 0 }), game(), 1);
    expect(ev.map((e) => e.type)).toEqual(["game_start"]);
  });
  it("goal on score increase, attributed to the right side", () => {
    const ev = diffGame(game(), withScore(game(), 0, 1), 1);
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ type: "goal", delta: 1 });
    expect(ev[0].team?.abbr).toBe("CBJ");
  });
  it("no event on score decrease (disallowed goal)", () => {
    expect(diffGame(withScore(game(), 2, 0), withScore(game(), 1, 0), 1)).toEqual([]);
  });
  it("respects min delta (football extra point suppressed, TD kept)", () => {
    const f = game({ league: "nfl", sport: "football" });
    expect(diffGame(f, withScore(f, 1, 0), 3)).toEqual([]);
    expect(diffGame(f, withScore(f, 7, 0), 3)[0]).toMatchObject({ type: "goal", delta: 7 });
  });
  it("two hockey goals in one poll => two events when plays are known", () => {
    const play = (k: string) => ({ key: k, period: 1, period_label: "", clock: "", team_abbr: "MIN", assists: [], home_score: 0, away_score: 0 });
    const next = withScore({ ...game(), goals: [play("a"), play("b")] }, 2, 0);
    expect(diffGame(game(), next, 1).filter((e) => e.type === "goal")).toHaveLength(2);
  });
  it("period_end on intermission start then period_start on resume", () => {
    const a = game();
    const b = game({ intermission: true });
    const c = game({ period: 2, intermission: false });
    expect(diffGame(a, b, 1).map((e) => e.type)).toEqual(["period_end"]);
    expect(diffGame(b, c, 1).map((e) => e.type)).toEqual(["period_start"]);
  });
  it("missed intermission still yields period_end + period_start", () => {
    const ev = diffGame(game(), game({ period: 2 }), 1);
    expect(ev.map((e) => e.type)).toEqual(["period_end", "period_start"]);
  });
  it("game_end only from in -> post", () => {
    expect(diffGame(game(), game({ status: "post" }), 1).map((e) => e.type)).toEqual(["game_end"]);
    expect(diffGame(game({ status: "pre" }), game({ status: "post" }), 1)).toEqual([]);
  });
});

describe("text", () => {
  it("labels", () => {
    expect(scoringLabel("football", 7)).toBe("TOUCHDOWN");
    expect(scoringLabel("football", 3)).toBe("FIELD GOAL");
    expect(scoringLabel("baseball", 1, "Judge homers")).toBe("HOME RUN");
    expect(scoringLabel("hockey", 1)).toBe("GOAL");
  });
  it("goal text", () => {
    const g = withScore(game(), 1, 0);
    expect(naturalText("goal", { game: g, team: g.home, label: "GOAL", scorer: "Danila Yurov" })).toBe(
      "Goal, City Wild! Danila Yurov scores. Wild 1, Blue Jackets 0.",
    );
  });
  it("game end tie + winner", () => {
    expect(naturalText("game_end", { game: withScore(game(), 2, 2) })).toContain("tie");
    expect(naturalText("game_end", { game: withScore(game(), 3, 2) })).toBe("Final. City Wild beat City Blue Jackets, 3 to 2.");
  });
});

describe("validDelay", () => {
  it("accepts 0..120 in 0.5 steps only", () => {
    for (const v of [0, 0.5, 12.5, 120]) expect(validDelay(v)).toBe(true);
    for (const v of [-0.5, 120.5, 0.3, NaN, "5", 1.25]) expect(validDelay(v as number)).toBe(false);
  });
});

describe("DelayBuffer", () => {
  it("delivers immediately at 0 delay, in order after the delay otherwise", () => {
    vi.useFakeTimers();
    const out: string[] = [];
    const b = new DelayBuffer<string>((s) => out.push(s));
    b.push("now", 0);
    b.push("later", 10_000, "g");
    expect(out).toEqual(["now"]);
    vi.advanceTimersByTime(9_999);
    expect(out).toEqual(["now"]);
    vi.advanceTimersByTime(1);
    expect(out).toEqual(["now", "later"]);
    vi.useRealTimers();
  });
  it("lowering the delay never lets a later item overtake an earlier one for the same key", () => {
    vi.useFakeTimers();
    const out: string[] = [];
    const b = new DelayBuffer<string>((s) => out.push(s));
    b.push("first", 10_000, "g");
    vi.advanceTimersByTime(2_000);
    b.push("second", 0, "g"); // would be due at t=2s, must wait for first at t=10s
    vi.advanceTimersByTime(7_999);
    expect(out).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(out).toEqual(["first", "second"]);
    vi.useRealTimers();
  });
  it("different keys are independent", () => {
    vi.useFakeTimers();
    const out: string[] = [];
    const b = new DelayBuffer<string>((s) => out.push(s));
    b.push("slow", 10_000, "a");
    b.push("fast", 1_000, "b");
    vi.advanceTimersByTime(1_000);
    expect(out).toEqual(["fast"]);
    vi.useRealTimers();
  });
});
