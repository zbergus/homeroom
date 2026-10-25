import type { EventPayload, UiEventType } from "../types.js";

/**
 * Triggers are the user-facing vocabulary for light actions ("flash on POWERPLAY").
 * Each is a predicate over data every event already carries (type, scoring.label, scoring.strength, winner),
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
  sports?: string[] | undefined;
  match: (ev: EventPayload, ctx: TriggerCtx) => boolean;
}

const isGoal = (ev: EventPayload) => ev.type === "goal";
const hasStrength = (ev: EventPayload, str: string) => {
  if (!isGoal(ev)) return false;
  const s = (ev.scoring?.strength ?? "").toLowerCase();
  const t = (ev.natural_text ?? "").toLowerCase();
  const l = (ev.scoring?.label ?? "").toLowerCase();
  if (str === "pp") return s === "pp" || l.includes("power play") || l.includes("ppg") || t.includes("power play");
  if (str === "sh") return s === "sh" || l.includes("short-handed") || l.includes("shg") || t.includes("short-handed");
  if (str === "en") return s === "en" || l.includes("empty net") || l.includes("eng") || t.includes("empty net");
  return false;
};

export const TRIGGERS: TriggerDef[] = [
  { id: "any_score", label: "Any score", match: isGoal },
  { id: "goal", label: "Goal", sports: ["hockey"], match: isGoal },
  { id: "ppg", label: "Power play goal (PPG)", sports: ["hockey"], match: (ev) => hasStrength(ev, "pp") },
  { id: "shg", label: "Short handed goal (SHG)", sports: ["hockey"], match: (ev) => hasStrength(ev, "sh") },
  { id: "eng", label: "Empty net goal (ENG)", sports: ["hockey"], match: (ev) => hasStrength(ev, "en") },
  { id: "powerplay", label: "Power play", sports: ["hockey"], match: (ev) => ev.type === "powerplay" },
  { id: "penalty", label: "Penalty", sports: ["hockey"], match: (ev) => ev.type === "penalty" },
  { id: "sog", label: "Shot on goal", sports: ["hockey"], match: (ev) => ev.type === "sog" },
  { id: "overtime", label: "Overtime", sports: ["hockey"], match: (ev) => (ev.type === "period_start" && ev.game.period === 4) || (ev.type === "period_end" && ev.game.period === 3 && ev.game.home.score === ev.game.away.score) },
  { id: "shootout", label: "Shootout", sports: ["hockey"], match: (ev) => ev.type === "period_start" && ev.game.period >= 5 },
  { id: "intermission", label: "Intermission", sports: ["hockey"], match: (ev) => ev.type === "period_end" && ev.game.period < 3 },
  { id: "win", label: "My team wins", match: (ev, c) => ev.type === "game_end" && !!ev.winner && ev.winner !== "tie" && c.favorites.has(`${ev.league}:${ev.winner}`) },
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
  league: string;
  delta?: number | undefined;
  strength?: string | undefined;
  playText?: string | undefined;
  period?: number | undefined;
}

export const MANUAL_SPECS: Record<string, ManualSpec> = {
  any_score: { type: "goal", league: "nhl" },
  goal: { type: "goal", league: "nhl" },
  ppg: { type: "goal", league: "nhl", delta: 1, strength: "pp" },
  shg: { type: "goal", league: "nhl", delta: 1, strength: "sh" },
  eng: { type: "goal", league: "nhl", delta: 1, strength: "en" },
  powerplay: { type: "powerplay", league: "nhl" },
  penalty: { type: "penalty", league: "nhl" },
  sog: { type: "sog", league: "nhl" },
  overtime: { type: "period_start", league: "nhl", period: 4 },
  shootout: { type: "period_start", league: "nhl", period: 5 },
  intermission: { type: "period_end", league: "nhl" },
  win: { type: "game_end", league: "nhl" },
  game_start: { type: "game_start", league: "nhl" },
  game_end: { type: "game_end", league: "nhl" },
  period_start: { type: "period_start", league: "nhl" },
  period_end: { type: "period_end", league: "nhl" },
};
