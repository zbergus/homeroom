import { randomUUID } from "node:crypto";
import type { Engine } from "../engine/engine.js";
import { matchesAny } from "../engine/triggers.js";
import type { EventPayload, LightAction, Rgb } from "../types.js";
import type { PusherHub } from "./pusher.js";

const STATE_WAIT_MS = 1500;
const RESTORE_MARGIN_MS = 500;

type Attrs = Record<string, unknown>;

const arr = (c: Rgb) => [c.r, c.g, c.b];

/** Effect names a light advertises (`effect_list`), and which of them means "no effect". */
export function effectList(dev: Record<string, unknown>): string[] {
  const l = (dev.capabilities as { effect_list?: unknown } | null | undefined)?.effect_list;
  return Array.isArray(l) ? l.map(String) : [];
}
const OFF_EFFECT = /^(none|off|no effect|no_effect)$/i;

const COLOR_MODES = new Set(["hs", "rgb", "xy", "rgbw", "rgbww"]);

/** Can this synced entity show a colour? Lights only report this through `supported_color_modes`. */
export function supportsColor(dev: Record<string, unknown>): boolean {
  if (dev.device_class !== "light") return false;
  const modes = (dev.capabilities as { supported_color_modes?: unknown } | null | undefined)?.supported_color_modes;
  return Array.isArray(modes) && modes.some((m) => COLOR_MODES.has(String(m)));
}
const near = (a: Rgb, b: Rgb) => Math.abs(a.r - b.r) + Math.abs(a.g - b.g) + Math.abs(a.b - b.b) < 60;

/**
 * Server-side replacement for ConnectedRoom "Actions": decides which synced HA entities to flash /
 * alternate / recolour for an event, and restores them afterwards. The HA integration executes the
 * commands we publish on `private-home-assistant.<integration_key>`.
 */
export class LightRules {
  private pending = new Map<string, (a: Attrs) => void>();

  constructor(
    private engine: Engine,
    private hub: PusherHub,
  ) {}

  /** Called from POST /requests/execute (the integration's reply to get_state). */
  receiveState(requestId: string, attrs: Attrs): boolean {
    const r = this.pending.get(requestId);
    if (!r) return false;
    this.pending.delete(requestId);
    r(attrs);
    return true;
  }

  /** Returns how many (action, entity) commands were issued. */
  handle(ev: EventPayload): number {
    if (ev.type === "goal_overturned") return 0;
    const store = this.engine.store;
    const ctx = { favorites: this.engine.favoriteSet() };
    const actions = store.getActions().filter((a) => a.enabled && matchesAny(a.triggers ?? [], ev, ctx) && this.scopeMatches(a, ev));
    if (!actions.length) return 0;
    let issued = 0;
    const devices = new Map(store.getDevices().map((d) => [d.entity_id, d]));
    for (const a of actions) {
      for (const entity of a.entities) {
        const dev = devices.get(entity);
        if (!dev) continue;
        issued++;
        void this.run(a, ev, entity, dev.integration_key, supportsColor(dev), dev).catch((e) => console.error("[lights]", entity, e));
      }
    }
    return issued;
  }

  private scopeMatches(a: LightAction, ev: EventPayload): boolean {
    if (a.team_scope === "any") return true;
    const favs = this.engine.store.getFavorites().filter((f) => f.league === ev.league).map((f) => f.abbr);
    if (a.team_scope === "scoring_team") return ev.type === "goal";
    // favorites: the scoring team (goal) or either team (other events) must be a favourite
    if (ev.type === "goal") return !!ev.team && favs.includes(ev.team.abbr);
    return favs.includes(ev.game.home.abbr) || favs.includes(ev.game.away.abbr);
  }

  private colorsFor(a: LightAction, ev: EventPayload): Rgb[] {
    if (a.colors !== "team") return a.colors.slice(0, 3);
    const o = (ev.team ?? ev.game.home).options;
    const out = [o.primary_color_rgb];
    if (!near(o.primary_color_rgb, o.secondary_color_rgb)) out.push(o.secondary_color_rgb);
    if (out.length < 3 && !out.some((c) => near(c, o.alternate_color_rgb))) out.push(o.alternate_color_rgb);
    return out;
  }

  private async run(a: LightAction, ev: EventPayload, entity: string, integrationKey: string, canColor: boolean, dev: Record<string, unknown>): Promise<void> {
    const channel = `private-home-assistant.${integrationKey}`;
    if (this.hub.subscribers(channel) === 0) return;
    const send = (data: Record<string, unknown>) => this.hub.broadcast(channel, `execute.${entity}`, data);

    let before: Attrs | undefined;
    if (a.restore) before = await this.getState(channel, entity);

    const colors = this.colorsFor(a, ev);
    // a white-only bulb (or a plug) cannot alternate colours or take one: the nearest honest effect is a blink
    const effects = effectList(dev);
    const wanted = a.effect === "light_effect" && a.light_effect && effects.includes(a.light_effect) ? a.light_effect : undefined;
    // a built-in effect the light does not advertise, or colour effects on a white-only bulb, degrade to a blink
    const effect = a.effect === "light_effect" ? (wanted ? "light_effect" : "flash") : !canColor && a.effect !== "flash" ? "flash" : a.effect;
    if (effect === "light_effect") send({ action: "set_effect", effect: wanted });
    else if (effect === "flash") send({ action: "flash", duration: a.duration, speed: a.speed });
    else if (effect === "alternate") send({ action: "alternate", duration: a.duration, speed: a.speed, colors: colors.length > 1 ? colors : [colors[0], null] });
    else send({ action: "set_color", rgb_color: arr(colors[0]) });

    if (a.restore && before && effect !== "flash") {
      // flash restores itself on the HA side; alternate / set_color do not
      const wait = effect === "alternate" ? a.duration * 1000 + RESTORE_MARGIN_MS : a.duration * 1000;
      // restoring colour/brightness does not stop a running built-in effect: name the light's own "off" effect when it has one
      const off = effect === "light_effect" && !before.effect ? effects.find((e) => OFF_EFFECT.test(e)) : undefined;
      setTimeout(() => send({ action: "restore", state: off ? { ...before, effect: off } : before }), wait).unref();
    }
  }

  private getState(channel: string, entity: string): Promise<Attrs | undefined> {
    return new Promise((resolve) => {
      const id = randomUUID();
      const timer = setTimeout(() => {
        this.pending.delete(id);
        resolve(undefined);
      }, STATE_WAIT_MS);
      this.pending.set(id, (a) => {
        clearTimeout(timer);
        resolve(a);
      });
      this.hub.broadcast(channel, `get_state.${entity}`, { request_id: id });
    });
  }
}
