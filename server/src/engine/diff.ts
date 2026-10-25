import type { ScoringPlay, Team, UiEventType, Game } from "../types.js";

export interface Detected {
  type: UiEventType;
  team?: Team | undefined;
  delta?: number | undefined;
  play?: ScoringPlay | undefined;
  period?: number | undefined;
  /** idempotency key for events that can repeat within a game; persisted across restarts */
  key?: string | undefined;
  /** deliberately NOT de-duplicated by key (goals, power plays, sog); the engine guards these another way */
  volatile?: boolean | undefined;
}

/**
 * Compare two canonical snapshots of the same hockey game and return the events that happened in between.
 * Pure. The caller de-duplicates with an idempotency key (game, type, period/score) because poll
 * races can legitimately produce the same transition twice.
 *
 * - First sight of a game (prev undefined) seeds state silently: no replay of past goals.
 * - Score decreases (review / disallowed) produce no event; state just follows.
 */
export function diffGame(prev: Game | undefined, next: Game, minDelta = 1): Detected[] {
  if (!prev) return [];
  const out: Detected[] = [];

  if (prev.status === "pre" && next.status === "in") out.push({ type: "game_start" });

  if (next.status === "in" && (prev.status === "in" || prev.status === "pre")) {
    if (!prev.intermission && next.intermission) {
      out.push({ type: "period_end", period: next.period });
    } else if (next.period > prev.period && prev.status === "in") {
      if (!prev.intermission) out.push({ type: "period_end", period: prev.period });
      if (!next.intermission) out.push({ type: "period_start", period: next.period });
    } else if (prev.intermission && !next.intermission) {
      out.push({ type: "period_start", period: next.period });
    }
  }

  if (next.status !== "pre" && prev.status !== "post") {
    const prevKeys = new Set(prev.goals.map((g) => g.key));
    for (const side of ["home", "away"] as const) {
      const delta = next[side].score - prev[side].score;
      if (delta <= 0 || delta < minDelta) continue;
      const team = next[side];
      const plays = next.goals.filter((p) => !prevKeys.has(p.key) && p.team_abbr === team.abbr);
      if (plays.length > 1 && plays.length === delta) {
        for (const play of plays) out.push({ type: "goal", team, delta: 1, play });
      } else {
        out.push({ type: "goal", team, delta, play: plays[plays.length - 1] });
      }
    }
  }

  // Hockey power play: a side gains the skater advantage (it was even, or the other side had it)
  const adv = next.situation?.advantage;
  if (next.status === "in" && adv && prev.situation && prev.situation.advantage !== adv) {
    out.push({ type: "powerplay", team: adv === "home" ? next.home : next.away, period: next.period, volatile: true });
  }

  if (prev.status === "in" && next.status === "post") out.push({ type: "game_end" });

  return out;
}
