import type { Trigger } from "../types";

export interface TriggerGroup {
  key: string;
  label: string;
  items: Trigger[];
}

const GROUPS = [
  { key: "scoring", label: "Goals & Scoring", ids: ["goal", "ppg", "shg", "eng", "any_score"] },
  { key: "situations", label: "Penalties & Strength", ids: ["powerplay", "penalty", "sog"] },
  { key: "game", label: "Periods & Game Flow", ids: ["game_start", "game_end", "period_start", "period_end", "intermission", "overtime", "shootout", "win"] },
] as const;

/**
 * Triggers grouped into hockey-specific categories for light actions and manual buttons.
 */
export function groupTriggers(list: Trigger[]): TriggerGroup[] {
  const mapped = new Set<string>();
  const res: TriggerGroup[] = GROUPS.map((g) => {
    const items = list.filter((t) => {
      const match = (g.ids as readonly string[]).includes(t.id);
      if (match) mapped.add(t.id);
      return match;
    });
    return { key: g.key, label: g.label, items };
  }).filter((g) => g.items.length > 0);

  const leftovers = list.filter((t) => !mapped.has(t.id));
  if (leftovers.length > 0) {
    res.push({ key: "other", label: "General", items: leftovers });
  }
  return res;
}
