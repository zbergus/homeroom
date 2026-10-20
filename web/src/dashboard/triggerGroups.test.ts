import { describe, expect, it } from "vitest";
import { groupTriggers } from "./triggerGroups";
import type { Trigger } from "../types";

describe("groupTriggers", () => {
  it("puts yellow/red cards under Soccer and power play under Hockey", () => {
    const list: Trigger[] = [
      { id: "goal", label: "Goal", sports: ["hockey", "soccer"] },
      { id: "powerplay", label: "Power play", sports: ["hockey"] },
      { id: "yellow_card", label: "Yellow card", sports: ["soccer"] },
      { id: "red_card", label: "Red card", sports: ["soccer"] },
      { id: "game_start", label: "Game start" },
    ];
    const groups = groupTriggers(list);
    expect(groups.map((g) => g.key)).toEqual(["hockey", "soccer", "general"]);
    expect(groups.find((g) => g.key === "hockey")?.items.map((t) => t.id)).toEqual(["goal", "powerplay"]);
    expect(groups.find((g) => g.key === "soccer")?.items.map((t) => t.id)).toEqual(["goal", "yellow_card", "red_card"]);
    expect(groups.find((g) => g.key === "general")?.items.map((t) => t.id)).toEqual(["game_start"]);
  });

  it("labels Hockey and Soccer separately", () => {
    const groups = groupTriggers([
      { id: "powerplay", label: "Power play", sports: ["hockey"] },
      { id: "yellow_card", label: "Yellow card", sports: ["soccer"] },
    ]);
    expect(groups.find((g) => g.key === "hockey")?.label).toBe("Hockey");
    expect(groups.find((g) => g.key === "soccer")?.label).toBe("Soccer");
  });
});
