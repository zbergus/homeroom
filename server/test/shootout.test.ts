import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { leagueById } from "../src/leagues.js";
import { normalizeEvent, parseSummary } from "../src/providers/espn.js";

// real SJ @ DET payloads (regulation + OT + a one-goal shootout), recorded from ESPN
const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "fixtures/replay/nhl-401892525");
const read = (f: string) => JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
const nhl = leagueById("nhl");

describe("a hockey shootout has no game clock", () => {
  it("scoring plays: the shootout goal is labelled as such and carries no clock, regulation goals keep theirs", () => {
    const ids: Record<string, string> = {};
    for (const c of read("espn-event.json").competitions[0].competitors) ids[c.team.id] = c.team.abbreviation;
    const plays = parseSummary(nhl, read("espn-summary.json"), ids).plays;
    const so = plays.filter((p) => p.period >= 5);
    expect(so).toHaveLength(1);
    expect(so[0].period_label).toBe("shootout");
    expect(so[0].clock).toBe(""); // ESPN sends "0:00", which a card would show as a time
    expect(plays.filter((p) => p.period < 5).every((p) => /^\d+:\d\d$/.test(p.clock))).toBe(true);
  });

  it("the live scoreboard row reports no clock during the shootout", () => {
    const ev = read("espn-event.json");
    ev.status = { ...ev.status, clock: 0, displayClock: "0:00", period: 5, type: { id: "2", name: "STATUS_IN_PROGRESS", state: "in", completed: false, description: "In Progress", detail: "Shootout", shortDetail: "Shootout" } };
    const g = normalizeEvent(nhl, ev)!;
    expect(g.status).toBe("in");
    expect(g.period_label).toBe("shootout");
    expect(g.clock).toBe("");
    expect(g.clock_s).toBeUndefined();
  });

  it("overtime keeps its clock", () => {
    const ev = read("espn-event.json");
    ev.status = { ...ev.status, clock: 59, displayClock: "0:59", period: 4, type: { id: "2", name: "STATUS_IN_PROGRESS", state: "in", completed: false, description: "In Progress", detail: "0:59 - OT", shortDetail: "0:59 - OT" } };
    const g = normalizeEvent(nhl, ev)!;
    expect(g.clock).toBe("0:59");
    expect(g.clock_s).toBe(59);
  });
});
