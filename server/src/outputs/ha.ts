import type { HornService } from "../audio/horns.js";
import type { Engine } from "../engine/engine.js";
import { errMsg } from "../security.js";
import type { EventPayload, Rgb } from "../types.js";
import { HornVolume, type HornVolumeOpts } from "./horn_volume.js";

const rgb = (c: Rgb) => [c.r, c.g, c.b];

/** Plain service calls answer fast; media ones include the speaker handshake (AirPlay/HomePod ~5 s, Chromecast more). */
const SERVICE_TIMEOUT_MS = 5000;
const MEDIA_TIMEOUT_MS = 20_000;
const TTS_TIMEOUT_MS = 30_000;
/** slow TTS engines (e.g. generative ones) take seconds to synthesize; give up and speak anyway after this */
const TTS_WARM_MS = 20_000;
/** pause before the single retry of a failed announcement */
const TTS_RETRY_MS = 1500;

/** Body of a failed service call, trimmed: Home Assistant explains most failures in it (bad entity, unreachable player). */
async function responseDetail(res: Response): Promise<string> {
  try {
    const text = (await res.text()).replace(/\s+/g, " ").trim();
    return text.slice(0, 200) || "(empty body)";
  } catch {
    return "(body unreadable)";
  }
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

export interface HaOutputsOpts {
  fetchImpl?: typeof fetch | undefined;
  hornVolumeOpts?: HornVolumeOpts | undefined;
  horns?: HornService | undefined;
}

interface HaState {
  entity_id: string;
  state: string;
  attributes?: Record<string, unknown> | undefined;
}

export class HaOutputs {
  readonly hornVolume: HornVolume;
  private f: typeof fetch;
  private horns?: HornService | undefined;

  constructor(
    private engine: Engine,
    opts: HaOutputsOpts = {},
  ) {
    this.f = opts.fetchImpl ?? fetch;
    this.horns = opts.horns;
    this.hornVolume = new HornVolume(() => this.engine.settings, { fetchImpl: this.f, ...opts.hornVolumeOpts });
  }

  /** Set the horn service post-construction if needed (e.g. createApp wiring). */
  setHorns(horns: HornService): void {
    this.horns = horns;
  }

  /** Fetch all lights, media players, and TTS entities from HA and persist them. */
  async syncEntities(): Promise<{
    ok: boolean;
    lights: number;
    media_players: number;
    tts_engines: number;
    error?: string | undefined;
  }> {
    const { ha } = this.engine.settings;
    if (!ha.url || !ha.token) return { ok: false, lights: 0, media_players: 0, tts_engines: 0, error: "Set Home Assistant URL and token first" };

    try {
      const res = await this.f(`${ha.url.replace(/\/$/, "")}/api/states`, {
        method: "GET",
        headers: { authorization: `Bearer ${ha.token}`, "content-type": "application/json" },
        redirect: "error",
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const states = (await res.json()) as HaState[];
      if (!Array.isArray(states)) throw new Error("Unexpected payload from /api/states");

      const devices: Record<string, unknown>[] = [];
      let lights = 0;
      let mediaPlayers = 0;
      let ttsEngines = 0;

      for (const s of states) {
        if (!s || typeof s.entity_id !== "string") continue;
        const attrs = s.attributes ?? {};
        const name = typeof attrs.friendly_name === "string" ? attrs.friendly_name : s.entity_id;

        if (s.entity_id.startsWith("light.")) {
          lights++;
          const effectList = Array.isArray(attrs.effect_list) ? attrs.effect_list.map(String) : [];
          const modes = Array.isArray(attrs.supported_color_modes) ? attrs.supported_color_modes.map(String) : [];
          const isColor = modes.some((m) => ["hs", "rgb", "xy", "rgbw", "rgbww"].includes(m));
          devices.push({
            entity_id: s.entity_id,
            name,
            device_class: "light",
            supports_color: isColor,
            capabilities: { effect_list: effectList, supported_color_modes: modes },
            supports_flash_duration: true,
            supports_flash_speed: true,
            supports_alternate_duration: true,
            supports_alternate_speed: true,
          });
        } else if (s.entity_id.startsWith("media_player.")) {
          mediaPlayers++;
          devices.push({
            entity_id: s.entity_id,
            name,
            device_class: "media_player",
          });
        } else if (s.entity_id.startsWith("tts.")) {
          ttsEngines++;
          devices.push({
            entity_id: s.entity_id,
            name,
            device_class: "tts",
          });
        }
      }

      this.engine.store.replaceDevices("ha_direct", devices);
      return { ok: true, lights, media_players: mediaPlayers, tts_engines: ttsEngines };
    } catch (e) {
      return { ok: false, lights: 0, media_players: 0, tts_engines: 0, error: errMsg(e) };
    }
  }

  /** Plays the goal horn media on configured horn_players. */
  async playGoalHorn(hornUrl: string): Promise<boolean> {
    const { ha, horn_players } = this.engine.settings;
    if (!ha.url || !ha.token || horn_players.length === 0) return false;

    try {
      const res = await this.postService(
        "/api/services/media_player/play_media",
        {
          entity_id: horn_players,
          media_content_id: hornUrl,
          media_content_type: "music",
        },
        MEDIA_TIMEOUT_MS,
      );
      if (!res.ok) console.warn(`[ha] playGoalHorn -> HTTP ${res.status}: ${await responseDetail(res)}`);
      return res.ok;
    } catch (e) {
      console.warn("[ha] playGoalHorn error:", errMsg(e));
      return false;
    }
  }

  /** The TTS engine to call: the configured one, else the first `tts.*` entity Home Assistant reported. */
  private ttsEngine(): string | undefined {
    const configured = this.engine.settings.tts_engine;
    if (configured) return configured;
    const known = this.engine.store.getDevices().find((d) => d.device_class === "tts" && typeof d.entity_id === "string");
    return typeof known?.entity_id === "string" ? known.entity_id : undefined;
  }

  /** Speaks an announcement on the configured TTS speaker. */
  async speakAnnouncement(message: string): Promise<boolean> {
    const { ha, tts_player, horn_players } = this.engine.settings;
    if (!ha.url || !ha.token) return false;
    const targetPlayer = tts_player || horn_players[0];
    if (!targetPlayer) return false;
    // tts.speak needs an entity_id; without one Home Assistant answers a bare 400: Bad Request
    const engineId = this.ttsEngine();
    if (!engineId) {
      console.warn("[ha] speakAnnouncement skipped: no tts.* engine known (pick one in Settings, Audio, and sync)");
      return false;
    }

    await this.warmTts(engineId, message);
    const body: Record<string, unknown> = { entity_id: engineId, media_player_entity_id: targetPlayer, message };
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const res = await this.postService("/api/services/tts/speak", body, TTS_TIMEOUT_MS);
        if (res.ok) return true;
        console.warn(
          `[ha] speakAnnouncement ${engineId} -> ${targetPlayer}: HTTP ${res.status}: ${await responseDetail(res)}${attempt === 1 ? " (retrying once)" : ""}`,
        );
      } catch (e) {
        console.warn(`[ha] speakAnnouncement ${engineId} -> ${targetPlayer} error: ${errMsg(e)}`);
      }
      // AirPlay speakers fail a stream now and then (pyatv gives the download 10 s); one quiet retry beats silence
      if (attempt === 1) await new Promise((r) => setTimeout(r, TTS_RETRY_MS).unref());
    }
    return false;
  }

  /**
   * Synthesize the line before speaking it: AirPlay speakers download the clip and give up after 10 s, so a
   * proxy URL that still has to call the TTS engine fails on slow engines. Best effort; failures fall through.
   */
  private async warmTts(engineId: string, message: string): Promise<void> {
    const { ha } = this.engine.settings;
    try {
      const res = await this.f(`${ha.url.replace(/\/$/, "")}/api/tts_get_url`, {
        method: "POST",
        headers: { authorization: `Bearer ${ha.token}`, "content-type": "application/json" },
        body: JSON.stringify({ engine_id: engineId, message }),
        redirect: "error",
        signal: AbortSignal.timeout(TTS_WARM_MS),
      });
      if (!res.ok) console.warn(`[ha] tts_get_url -> HTTP ${res.status}: ${await responseDetail(res)}`);
    } catch (e) {
      console.warn("[ha] tts_get_url error:", errMsg(e));
    }
  }

  /** Orchestrates horn playback, volume boost, waiting exact horn duration, and TTS announcement. */
  async orchestrateGoalAudio(ev: EventPayload): Promise<void> {
    const s = this.engine.settings;
    if (ev.type !== "goal") return;
    if (!ev.goal_horn || s.horn_players.length === 0) {
      // no horn to wait for (no file for this team, or no players): the announcement still goes out right away
      if (s.tts_enabled && ev.natural_text) await this.speakAnnouncement(ev.natural_text);
      return;
    }
    if (!s.ha.url || !s.ha.token) return;

    // 1. Boost volume first (with preparation budget)
    await this.hornVolume.prepare(ev.event_id);

    // 2. Play horn audio
    await this.playGoalHorn(ev.goal_horn);

    // 3. Calculate exact horn duration
    let durS = 15;
    if (this.horns && ev.team) {
      const d = this.horns.durationOf(this.horns.sourcePath(ev.league, ev.team.abbr));
      if (d !== undefined && d > 0) durS = d;
    }
    if (s.horn_max_s != null && s.horn_max_s > 0) {
      durS = Math.min(durS, s.horn_max_s);
    }

    // 4. Wait for horn audio to finish, then speak announcement
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms).unref());
    await sleep(Math.round(durS * 1000) + 200);

    if (s.tts_enabled && ev.natural_text) {
      await this.speakAnnouncement(ev.natural_text);
    }
  }

  async publishRest(ev: EventPayload): Promise<void> {
    const { ha, tts_enabled } = this.engine.settings;
    if (!ha.fire_rest_events || !ha.url || !ha.token) return;
    if (ev.type === "goal" && ev.goal_horn) void this.hornVolume.prepare(ev.event_id);
    await this.post(ha.url, ha.token, `homeroom_${ev.type}`, flatBody(ev, tts_enabled));
  }

  async test(): Promise<{
    ok: boolean;
    status?: number | undefined;
    error?: string | undefined;
    sync?: { lights: number; media_players: number; tts_engines: number } | undefined;
  }> {
    const { ha } = this.engine.settings;
    if (!ha.url || !ha.token) return { ok: false, error: "Set the Home Assistant URL and a long-lived token first" };
    try {
      const res = await this.post(ha.url, ha.token, "homeroom_test", { message: "Homeroom connection test" });
      if (!res.ok) return { ok: false, status: res.status, error: `HTTP ${res.status}` };
      const sync = await this.syncEntities();
      return {
        ok: true,
        status: res.status,
        sync: sync.ok ? { lights: sync.lights, media_players: sync.media_players, tts_engines: sync.tts_engines } : undefined,
      };
    } catch (e) {
      return { ok: false, error: errMsg(e) };
    }
  }

  private async postService(path: string, body: unknown, timeoutMs = SERVICE_TIMEOUT_MS): Promise<Response> {
    const { ha } = this.engine.settings;
    return this.f(`${ha.url.replace(/\/$/, "")}${path}`, {
      method: "POST",
      headers: { authorization: `Bearer ${ha.token}`, "content-type": "application/json" },
      body: JSON.stringify(body),
      redirect: "error",
      signal: AbortSignal.timeout(timeoutMs),
    });
  }

  private async post(url: string, token: string, event: string, body: unknown): Promise<Response> {
    const res = await this.f(`${url.replace(/\/$/, "")}/api/events/${event}`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(body),
      redirect: "error",
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) console.error(`[ha] ${event} -> HTTP ${res.status}`);
    return res;
  }
}
