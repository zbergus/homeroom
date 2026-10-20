import type { Trigger } from "../types";

const GROUPS = [
  { key: "hockey", label: "Hockey" },
  { key: "soccer", label: "Soccer" },
  { key: "football", label: "Football" },
  { key: "basketball", label: "Basketball" },
  { key: "baseball", label: "Baseball" },
  { key: "general", label: "General" },
] as const;

/** Triggers grouped by sport in a stable order; empty groups are dropped.
 *  Multi-sport triggers (e.g. Goal) appear in every listed sport group. */
export function groupTriggers(list: Trigger[]) {
  return GROUPS.map((g) => ({
    ...g,
    items: list.filter((t) => {
      const sports = t.sports;
      if (!sports?.length) return g.key === "general";
      return sports.includes(g.key);
    }),
  })).filter((g) => g.items.length > 0);
}
