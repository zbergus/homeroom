import type { Engine } from "../engine/engine.js";
import type { EventPayload, Rgb } from "../types.js";
import { HornVolume, type HornVolumeOpts } from "./horn_volume.js";
import { errMsg } from "../security.js";
import type { PusherHub } from "./pusher.js";

const rgb = (c: Rgb) => [c.r, c.g, c.b];

/** Celebration metadata is UI-only; keep both scoring and nested game goals off the integration wire. */
function integrationScorer<T extends { scorer_id?: string | undefined; scorer_number?: string | undefined }>(value: T): T {
  const copy = { ...value };
  delete copy.scorer_id;
  delete copy.scorer_number;
  return copy;
}

/** Flat body for the direct-REST path (`homeroom_<type>` events on the HA bus). */
function flatBody(ev: EventPayload, ttsEnabled: boolean): Record<string, unknown> {
  const o = (ev.team ?? ev.game.home).options;
  return {
    type: ev.type,
    trigger: ev.trigger,
    manual: ev.manual ?? false,
    winner: ev.winner,
    league: ev.league,
    game_id: ev.game.id,
    team: ev.team?.display_name,
    team_abbr: ev.team?.abbr,
    team_color_rgb: rgb(o.primary_color_rgb),
    secondary_color_rgb: rgb(o.secondary_color_rgb),
    alternate_color_rgb: rgb(o.alternate_color_rgb),
    scorer: ev.scoring?.scorer,
    label: ev.scoring?.label,
    home_team: ev.game.home.display_name,
    away_team: ev.game.away.display_name,
    home_score: ev.game.home.score,
    away_score: ev.game.away.score,
    period: ev.game.period_label,
    clock: ev.game.clock,
    tts_message: ttsEnabled ? ev.natural_text : null,
    goal_horn_url: ev.goal_horn ?? null,
    delay_s: ev.delay_s,
    test: ev.test ?? false,
  };
}

export class HaOutputs {
  readonly hornVolume: HornVolume;

  constructor(
    private engine: Engine,
    private hub: PusherHub,
    hornVolumeOpts?: HornVolumeOpts,
  ) {
    this.hornVolume = new HornVolume(() => this.engine.settings, hornVolumeOpts);
  }

  /** Pusher path: publish to every linked integration client. */
  publishPusher(ev: EventPayload): number {
    const tts = this.engine.settings.tts_enabled;
    const data = {
      ...ev,
      ...(ev.scoring ? { scoring: integrationScorer(ev.scoring) } : {}),
      game: { ...ev.game, goals: ev.game.goals.map(integrationScorer) },
      natural_text: tts ? ev.natural_text : null,
    };
    let clients = 0;
    // optional: set the horn volume first (bounded to ~2 s: the horn must follow `goal` within ~3 s). No-op unless configured.
    const hornReady = ev.type === "goal" && ev.goal_horn ? this.hornVolume.prepare(ev.event_id) : undefined;
    const sendHorn = (ch: string) => this.hub.broadcast(ch, "goal_horn", { audioFile: ev.goal_horn });
    for (const l of this.engine.store.allLinks()) {
      const ch = `private-${l.unique_id}`;
      clients += this.hub.broadcast(ch, ev.type, data);
      // must follow `goal` within ~3 s or the integration speaks TTS before the horn
      if (ev.type === "goal" && ev.goal_horn) {
        if (hornReady && this.hornVolume.enabled()) void hornReady.then(() => sendHorn(ch));
        else sendHorn(ch);
      }
    }
    return clients;
  }

  async publishRest(ev: EventPayload): Promise<void> {
    const { ha, tts_enabled } = this.engine.settings;
    if (!ha.fire_rest_events || !ha.url || !ha.token) return;
    // the REST path is not delayed for the volume change (lights should not wait); the volume is still prepared
    if (ev.type === "goal" && ev.goal_horn) void this.hornVolume.prepare(ev.event_id);
    await this.post(ha.url, ha.token, `homeroom_${ev.type}`, flatBody(ev, tts_enabled));
  }

  async test(): Promise<{ ok: boolean; status?: number | undefined; error?: string | undefined }> {
    const { ha } = this.engine.settings;
    if (!ha.url || !ha.token) return { ok: false, error: "Set the Home Assistant URL and a long-lived token first" };
    try {
      const res = await this.post(ha.url, ha.token, "homeroom_test", { message: "Homeroom connection test" });
      return { ok: res.ok, status: res.status, error: res.ok ? undefined : `HTTP ${res.status}` };
    } catch (e) {
      return { ok: false, error: errMsg(e) };
    }
  }

  private async post(url: string, token: string, event: string, body: unknown): Promise<Response> {
    const res = await fetch(`${url.replace(/\/$/, "")}/api/events/${event}`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(body),
      // never follow a redirect: the bearer token must only go to the URL the user configured
      redirect: "error",
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) console.error(`[ha] ${event} -> HTTP ${res.status}`);
    return res;
  }
}
