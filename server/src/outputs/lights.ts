import { randomUUID } from "node:crypto";
import type { Engine } from "../engine/engine.js";
import { matchesAny } from "../engine/triggers.js";
import { errMsg } from "../security.js";
import type { EventPayload, LightAction, Rgb } from "../types.js";
import type { PusherHub } from "./pusher.js";

const STATE_WAIT_MS = 1500;
const RESTORE_MARGIN_MS = 500;

type Attrs = Record<string, unknown>;

const arr = (c: Rgb) => [c.r, c.g, c.b];

/** Effect names a light advertises (`effect_list`), and which of them means "no effect". */
function effectList(dev: Record<string, unknown>): string[] {
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

export interface LightRulesOpts {
  fetchImpl?: typeof fetch | undefined;
}

/**
 * Light automation engine: decides which synced HA entities to flash /
 * alternate / recolour for an event, and restores them afterwards.
 * Directly commands Home Assistant via REST, or via Pusher when a bridge is connected.
 */
export class LightRules {
  private pending = new Map<string, (a: Attrs) => void>();
  private f: typeof fetch;

  constructor(
    private engine: Engine,
    private hub: PusherHub,
    opts: LightRulesOpts = {},
  ) {
    this.f = opts.fetchImpl ?? fetch;
  }

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

  private async callHaService(service: string, body: Record<string, unknown>): Promise<void> {
    const { ha } = this.engine.settings;
    if (!ha.url || !ha.token) return;
    try {
      await this.f(`${ha.url.replace(/\/$/, "")}/api/services/${service}`, {
        method: "POST",
        headers: { authorization: `Bearer ${ha.token}`, "content-type": "application/json" },
        body: JSON.stringify(body),
        redirect: "error",
        signal: AbortSignal.timeout(4000),
      });
    } catch (e) {
      console.warn(`[lights] service ${service} failed:`, errMsg(e));
    }
  }

  private async getStateRest(entity: string): Promise<Attrs | undefined> {
    const { ha } = this.engine.settings;
    if (!ha.url || !ha.token) return undefined;
    try {
      const res = await this.f(`${ha.url.replace(/\/$/, "")}/api/states/${encodeURIComponent(entity)}`, {
        method: "GET",
        headers: { authorization: `Bearer ${ha.token}`, "content-type": "application/json" },
        redirect: "error",
        signal: AbortSignal.timeout(3000),
      });
      if (!res.ok) return undefined;
      return (await res.json()) as Attrs;
    } catch {
      return undefined;
    }
  }

  private async run(a: LightAction, ev: EventPayload, entity: string, integrationKey: string, canColor: boolean, dev: Record<string, unknown>): Promise<void> {
    const { ha } = this.engine.settings;
    const channel = `private-home-assistant.${integrationKey}`;
    const usePusher = this.hub.subscribers(channel) > 0;
    const useRest = !usePusher && !!ha.url && !!ha.token;
    if (!usePusher && !useRest) return;

    let before: Attrs | undefined;
    if (a.restore) {
      before = usePusher ? await this.getState(channel, entity) : await this.getStateRest(entity);
    }

    const colors = this.colorsFor(a, ev);
    const first = colors[0];
    if (!first) return; // no colour to show

    const effects = effectList(dev);
    const wanted = a.effect === "light_effect" && a.light_effect && effects.includes(a.light_effect) ? a.light_effect : undefined;
    const effect = a.effect === "light_effect" ? (wanted ? "light_effect" : "flash") : !canColor && a.effect !== "flash" ? "flash" : a.effect;

    if (usePusher) {
      const send = (data: Record<string, unknown>) => this.hub.broadcast(channel, `execute.${entity}`, data);
      if (effect === "light_effect") send({ action: "set_effect", effect: wanted });
      else if (effect === "flash") send({ action: "flash", duration: a.duration, speed: a.speed });
      else if (effect === "alternate") send({ action: "alternate", duration: a.duration, speed: a.speed, colors: colors.length > 1 ? colors : [first, null] });
      else send({ action: "set_color", rgb_color: arr(first) });

      if (a.restore && before && effect !== "flash") {
        const wait = effect === "alternate" ? a.duration * 1000 + RESTORE_MARGIN_MS : a.duration * 1000;
        const off = effect === "light_effect" && !before.effect ? effects.find((e) => OFF_EFFECT.test(e)) : undefined;
        setTimeout(() => send({ action: "restore", state: off ? { ...before, effect: off } : before }), wait).unref();
      }
      return;
    }

    // Direct REST path
    if (effect === "set_color") {
      await this.callHaService("light/turn_on", { entity_id: entity, rgb_color: arr(first) });
    } else if (effect === "light_effect") {
      await this.callHaService("light/turn_on", { entity_id: entity, effect: wanted });
    } else if (effect === "flash") {
      const body: Record<string, unknown> = { entity_id: entity, flash: a.speed > 5 ? "short" : "long" };
      if (canColor) body.rgb_color = arr(first);
      await this.callHaService("light/turn_on", body);
    } else if (effect === "alternate") {
      const c1 = first;
      const c2 = colors.length > 1 ? colors[1]! : { r: 255, g: 255, b: 255 };
      await this.callHaService("light/turn_on", { entity_id: entity, rgb_color: arr(c1) });
      const stepMs = Math.max(300, Math.round(1000 / Math.max(1, a.speed)));
      const totalSteps = Math.max(1, Math.round((a.duration * 1000) / stepMs));
      let step = 0;
      const timer = setInterval(() => {
        step++;
        if (step >= totalSteps) {
          clearInterval(timer);
          return;
        }
        const col = step % 2 === 0 ? c1 : c2;
        void this.callHaService("light/turn_on", { entity_id: entity, rgb_color: arr(col) });
      }, stepMs);
    }

    if (a.restore && before) {
      const wait = a.duration * 1000 + RESTORE_MARGIN_MS;
      setTimeout(async () => {
        const bState = before?.state;
        if (bState === "off") {
          await this.callHaService("light/turn_off", { entity_id: entity });
        } else {
          const attrs = (before?.attributes ?? {}) as Record<string, unknown>;
          const body: Record<string, unknown> = { entity_id: entity };
          if (Array.isArray(attrs.rgb_color)) body.rgb_color = attrs.rgb_color;
          if (typeof attrs.brightness === "number") body.brightness = attrs.brightness;
          if (typeof attrs.color_temp === "number") body.color_temp = attrs.color_temp;
          if (typeof attrs.effect === "string" && attrs.effect !== "none") body.effect = attrs.effect;
          await this.callHaService("light/turn_on", body);
        }
      }, wait).unref();
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
