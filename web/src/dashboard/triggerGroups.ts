import type { Trigger } from "../types";

export const GROUPS = [
  { key: "hockey", label: "Hockey / soccer" },
  { key: "football", label: "Football" },
  { key: "basketball", label: "Basketball" },
  { key: "baseball", label: "Baseball" },
  { key: "general", label: "General" },
] as const;

const keyOf = (t: Trigger): string => {
  const s = t.sports?.[0];
  if (!s) return "general";
  return s === "soccer" ? "hockey" : s;
};

/** Triggers grouped by sport in a stable order; empty groups are dropped. */
export function groupTriggers(list: Trigger[]) {
  return GROUPS.map((g) => ({ ...g, items: list.filter((t) => keyOf(t) === g.key) })).filter((g) => g.items.length > 0);
}
