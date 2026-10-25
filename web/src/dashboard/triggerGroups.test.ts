import { describe, expect, it } from "vitest";
import { groupTriggers } from "./triggerGroups";
import type { Trigger } from "../types";

describe("groupTriggers", () => {
  it("groups hockey triggers into scoring, situations, and game flow", () => {
    const list: Trigger[] = [
      { id: "goal", label: "Goal", sports: ["hockey"] },
      { id: "ppg", label: "Power play goal (PPG)", sports: ["hockey"] },
      { id: "powerplay", label: "Power play", sports: ["hockey"] },
      { id: "penalty", label: "Penalty", sports: ["hockey"] },
      { id: "game_start", label: "Game start" },
      { id: "period_end", label: "Period end" },
    ];
    const groups = groupTriggers(list);
    expect(groups.map((g) => g.key)).toEqual(["scoring", "situations", "game"]);
    expect(groups.find((g) => g.key === "scoring")?.items.map((t) => t.id)).toEqual(["goal", "ppg"]);
    expect(groups.find((g) => g.key === "situations")?.items.map((t) => t.id)).toEqual(["powerplay", "penalty"]);
    expect(groups.find((g) => g.key === "game")?.items.map((t) => t.id)).toEqual(["game_start", "period_end"]);
  });

  it("handles empty categories gracefully", () => {
    const groups = groupTriggers([
      { id: "powerplay", label: "Power play", sports: ["hockey"] },
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.label).toBe("Penalties & Strength");
  });
});
