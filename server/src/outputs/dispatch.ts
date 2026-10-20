import type { Engine } from "../engine/engine.js";
import { triggersFor } from "../engine/triggers.js";
import type { EventPayload } from "../types.js";
import type { HaOutputs } from "./ha.js";
import type { LightRules } from "./lights.js";
import type { UiHub } from "./ui.js";
import { errMsg } from "../security.js";

/**
 * Events that must not go on the ConnectedRoom Pusher channel.
 * `card` / `powerplay` are spoken by the patched integration — keep them off this list.
 */
export const INTERNAL_ONLY = new Set<string>(["goal_overturned", "first_down", "third_down"]);

interface EventRecord {
  at: number;
  event_id: string;
  type: EventPayload["type"];
  league: string;
  game: string;
  team?: string | undefined;
  label?: string | undefined;
  triggers: string[];
  manual: boolean;
  delay_s: number;
  outcome: "delivered" | "filtered";
  /** why it was filtered, or a note on what was delivered */
  reason?: string | undefined;
  sent: { pusher_clients: number; rest: boolean; lights: number };
}

/** Fixed-size log of what the dispatcher did with each event; feeds the diagnostics panel. */
class EventLog {
  private items: EventRecord[] = [];
  constructor(private max = 100) {}
  add(r: EventRecord): void {
    this.items.unshift(r);
    if (this.items.length > this.max) this.items.length = this.max;
  }
  recent(n = 50): EventRecord[] {
    return this.items.slice(0, n);
  }
}

/**
 * The single place where a released (post-delay) event leaves the building.
 * The TV views always see it; automation outputs (Home Assistant, lights, horn, TTS) go through the gates.
 */
export class Dispatcher {
  constructor(
    private engine: Engine,
    private ui: UiHub,
    private ha: HaOutputs,
    private lights: LightRules,
    readonly log = new EventLog(),
  ) {}

  /** Should this event drive automations? Manual events (buttons, test) always do. */
  decide(ev: EventPayload): { ok: true } | { ok: false; reason: string } {
    if (ev.manual) return { ok: true };
    const s = this.engine.settings;
    if (!s.automations_enabled) return { ok: false, reason: "automations are disabled (manual triggers only)" };
    if (s.my_team_only) {
      const favs = this.engine.favoriteSet();
      if (favs.size === 0) return { ok: false, reason: "my team only is on but no favourite team is set" };
      const mine = (abbr?: string) => !!abbr && favs.has(`${ev.league}:${abbr}`);
      if (ev.type === "goal" || ev.type === "goal_overturned" || ev.type === "card" || ev.type === "powerplay" || ev.type === "first_down" || ev.type === "third_down") {
        if (!mine(ev.team?.abbr)) return { ok: false, reason: "my team only: not a favourite team's score" };
      } else if (!mine(ev.game.home.abbr) && !mine(ev.game.away.abbr)) {
        return { ok: false, reason: "my team only: no favourite team in this game" };
      }
    }
    return { ok: true };
  }

  handle(ev: EventPayload): EventRecord {
    this.ui.event(ev);
    const rec: EventRecord = {
      at: Date.now(),
      event_id: ev.event_id,
      type: ev.type,
      league: ev.league,
      game: ev.game.id,
      team: ev.team?.abbr,
      label: ev.scoring?.label,
      triggers: triggersFor(ev, { favorites: this.engine.favoriteSet() }),
      manual: !!ev.manual,
      delay_s: ev.delay_s,
      outcome: "delivered",
      sent: { pusher_clients: 0, rest: false, lights: 0 },
    };
    const d = this.decide(ev);
    if (!d.ok) {
      rec.outcome = "filtered";
      rec.reason = d.reason;
    } else {
      if (!INTERNAL_ONLY.has(ev.type)) rec.sent.pusher_clients = this.ha.publishPusher(ev);
      const { ha } = this.engine.settings;
      rec.sent.rest = ha.fire_rest_events && !!ha.url && !!ha.token;
      void this.ha.publishRest(ev).catch((err) => console.error("[ha] rest failed:", errMsg(err)));
      rec.sent.lights = this.lights.handle(ev);
      if (rec.sent.pusher_clients === 0 && !rec.sent.rest && !INTERNAL_ONLY.has(ev.type)) rec.reason = "no Home Assistant integration is connected and REST events are off";
    }
    this.log.add(rec);
    return rec;
  }
}
