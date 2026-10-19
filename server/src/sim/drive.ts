/**
 * Test/dev helper: feed one virtual-time snapshot of a replayed game into an Engine exactly like the Poller does
 * (ESPN scoreboard event first, then the NHL score/now + play-by-play overlay), but without HTTP or real timers.
 * Mirrors `Poller.tickEspn` / `Poller.tickNhl`; the full-stack path (sim server + real Poller) is covered by `npm run sim`.
 */
import type { Engine } from "../engine/engine.js";
import { normalizeEvent } from "../providers/espn.js";
import { normalizeNhl, parsePbp, withOfficialStrength } from "../providers/nhl.js";
import type { ReplayGame } from "./replay.js";

export function ingestAt(engine: Engine, g: ReplayGame, v: number, startAtMs: number): void {
  const game = normalizeEvent(g.league, g.espnEvent(v, startAtMs));
  if (!game) throw new Error("sim produced an event the ESPN parser rejects");
  engine.ingestEspn(game);
  if (!g.hasNhl) return;
  const scoreGame = g.nhlScoreGame(v, startAtMs);
  const pbp = g.nhlPbpAt(v, startAtMs);
  if (!scoreGame || !pbp) return;
  const n = normalizeNhl(scoreGame);
  const cur = engine.games.get(g.id);
  if (cur?.status === "post" && n.state === "post") return;
  let feed = n;
  if (n.state === "in") {
    const full = parsePbp(pbp);
    feed = { ...n, goals: full.goals.length >= n.goals.length ? withOfficialStrength(full.goals, n.goals) : n.goals, situation: full.situation };
  }
  engine.ingestNhl(g.id, feed);
}
