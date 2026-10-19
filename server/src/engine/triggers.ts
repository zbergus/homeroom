import type { EventPayload, UiEventType } from "../types.js";

/**
 * Triggers are the user-facing vocabulary for light actions ("flash on TOUCHDOWN").
 * Each is a predicate over data every event already carries (type, scoring.label, scoring.delta, winner),
 * so none of them changes what is sent to the Home Assistant integration; the integration only ever
 * sees the five base event types.
 */
interface TriggerCtx {
  /** favourites as "league:ABBR" */
  favorites: ReadonlySet<string>;
}

interface TriggerDef {
  id: string;
  label: string;
  /** sports it makes sense for; undefined = all */
  sports?: string[];
  match: (ev: EventPayload, ctx: TriggerCtx) => boolean;
}

const isGoal = (ev: EventPayload) => ev.type === "goal";
const label = (ev: EventPayload, ...l: string[]) => isGoal(ev) && l.includes(ev.scoring?.label ?? "");
const basket = (ev: EventPayload, delta: number) => isGoal(ev) && ev.sport === "basketball" && ev.scoring?.delta === delta;

export const TRIGGERS: TriggerDef[] = [
  { id: "any_score", label: "Any score", match: isGoal },
  { id: "goal", label: "Goal", sports: ["hockey", "soccer"], match: (ev) => label(ev, "GOAL") },
  { id: "touchdown", label: "Touchdown", sports: ["football"], match: (ev) => label(ev, "TOUCHDOWN") },
  { id: "field_goal", label: "Field goal", sports: ["football"], match: (ev) => label(ev, "FIELD GOAL") },
  { id: "extra_point", label: "Extra point", sports: ["football"], match: (ev) => label(ev, "EXTRA POINT") },
  { id: "safety", label: "Safety", sports: ["football"], match: (ev) => label(ev, "SAFETY") },
  { id: "basket", label: "Basket", sports: ["basketball"], match: (ev) => label(ev, "BASKET") },
  { id: "basket_ft", label: "Free throw", sports: ["basketball"], match: (ev) => basket(ev, 1) },
  { id: "basket_2", label: "2-pointer", sports: ["basketball"], match: (ev) => basket(ev, 2) },
  { id: "basket_3", label: "3-pointer", sports: ["basketball"], match: (ev) => basket(ev, 3) },
  { id: "run", label: "Run", sports: ["baseball"], match: (ev) => label(ev, "RUN", "HOME RUN") },
  { id: "home_run", label: "Home run", sports: ["baseball"], match: (ev) => label(ev, "HOME RUN") },
  { id: "win", label: "My team wins", match: (ev, c) => ev.type === "game_end" && !!ev.winner && ev.winner !== "tie" && c.favorites.has(`${ev.league}:${ev.winner}`) },
  { id: "powerplay", label: "Power play", sports: ["hockey"], match: (ev) => ev.type === "powerplay" },
  { id: "yellow_card", label: "Yellow card", sports: ["soccer"], match: (ev) => ev.type === "card" && ev.card?.kind === "yellow" },
  { id: "red_card", label: "Red card", sports: ["soccer"], match: (ev) => ev.type === "card" && ev.card?.kind === "red" },
  { id: "game_start", label: "Game start", match: (ev) => ev.type === "game_start" },
  { id: "game_end", label: "Game end", match: (ev) => ev.type === "game_end" },
  { id: "period_start", label: "Period start", match: (ev) => ev.type === "period_start" },
  { id: "period_end", label: "Period end", match: (ev) => ev.type === "period_end" },
];

const BY_ID = new Map(TRIGGERS.map((t) => [t.id, t]));

export const isTriggerId = (id: string): boolean => BY_ID.has(id);

/** Does `ev` satisfy any of the given trigger ids? Unknown ids never match. */
export function matchesAny(ids: readonly string[], ev: EventPayload, ctx: TriggerCtx): boolean {
  return ids.some((id) => (ev.manual && ev.trigger === id) || (BY_ID.get(id)?.match(ev, ctx) ?? false));
}

/** Which triggers an event satisfies (for the diagnostics log). */
export function triggersFor(ev: EventPayload, ctx: TriggerCtx): string[] {
  return TRIGGERS.filter((t) => t.match(ev, ctx)).map((t) => t.id);
}

/** How a manual button synthesises its event: base type, default league, scoring delta, optional play text. */
interface ManualSpec {
  type: Exclude<UiEventType, "goal_overturned">;
  card?: "yellow" | "red";
  league: string;
  delta?: number;
  playText?: string;
}

export const MANUAL_SPECS: Record<string, ManualSpec> = {
  any_score: { type: "goal", league: "nhl" },
  goal: { type: "goal", league: "nhl" },
  touchdown: { type: "goal", league: "nfl", delta: 7 },
  field_goal: { type: "goal", league: "nfl", delta: 3 },
  extra_point: { type: "goal", league: "nfl", delta: 1 },
  safety: { type: "goal", league: "nfl", delta: 2 },
  basket: { type: "goal", league: "nba", delta: 2 },
  basket_ft: { type: "goal", league: "nba", delta: 1 },
  basket_2: { type: "goal", league: "nba", delta: 2 },
  basket_3: { type: "goal", league: "nba", delta: 3 },
  run: { type: "goal", league: "mlb", delta: 1 },
  home_run: { type: "goal", league: "mlb", delta: 1, playText: "homered" },
  powerplay: { type: "powerplay", league: "nhl" },
  yellow_card: { type: "card", league: "epl", card: "yellow" },
  red_card: { type: "card", league: "epl", card: "red" },
  win: { type: "game_end", league: "nhl" },
  game_start: { type: "game_start", league: "nhl" },
  game_end: { type: "game_end", league: "nhl" },
  period_start: { type: "period_start", league: "nhl" },
  period_end: { type: "period_end", league: "nhl" },
};
