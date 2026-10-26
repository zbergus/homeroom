import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Engine } from "../src/engine/engine.js";
import { HaOutputs } from "../src/outputs/ha.js";
import { LightRules } from "../src/outputs/lights.js";
import { Store } from "../src/store.js";
import type { EventPayload, Game, Team } from "../src/types.js";

interface CallRecord {
  method: string;
  url: string;
  body: unknown;
  auth?: string | undefined;
}

function mockHomeAssistant(token: string) {
  const calls: CallRecord[] = [];
  const entities: Record<string, { state: string; attributes: Record<string, unknown> }> = {
    "light.mancave": {
      state: "on",
      attributes: {
        friendly_name: "Mancave Ceiling",
        supported_color_modes: ["rgb", "hs"],
        rgb_color: [255, 255, 255],
        brightness: 200,
      },
    },
    "light.off_bulb": {
      state: "off",
      attributes: {
        friendly_name: "Off Light",
        supported_color_modes: ["rgb"],
      },
    },
    "media_player.mancave_speaker": {
      state: "idle",
      attributes: {
        friendly_name: "Mancave Soundbar",
      },
    },
    "tts.piper": {
      state: "idle",
      attributes: {
        friendly_name: "Piper TTS",
      },
    },
  };

  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      let body: unknown = {};
      try {
        body = raw ? JSON.parse(raw) : {};
      } catch {
        body = raw;
      }
      calls.push({ method: req.method!, url: req.url!, body, auth: req.headers.authorization });

      if (req.headers.authorization !== `Bearer ${token}`) {
        res.writeHead(401).end();
        return;
      }

      if (req.method === "GET" && req.url === "/api/states") {
        const list = Object.entries(entities).map(([entity_id, data]) => ({
          entity_id,
          state: data.state,
          attributes: data.attributes,
        }));
        res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(list));
        return;
      }

      const stateMatch = /^\/api\/states\/(.+)$/.exec(req.url!);
      if (req.method === "GET" && stateMatch && stateMatch[1]) {
        const id = decodeURIComponent(stateMatch[1]);
        const ent = entities[id];
        if (!ent) {
          res.writeHead(404).end("{}");
          return;
        }
        res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(ent));
        return;
      }

      if (req.method === "POST" && req.url?.startsWith("/api/services/")) {
        res.writeHead(200, { "content-type": "application/json" }).end("[]");
        return;
      }

      if (req.method === "POST" && req.url === "/api/tts_get_url") {
        res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ url: "http://ha.test/api/tts_proxy/abc.mp3", path: "/api/tts_proxy/abc.mp3" }));
        return;
      }

      if (req.method === "POST" && req.url?.startsWith("/api/events/")) {
        res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ message: "event fired" }));
        return;
      }

      res.writeHead(404).end();
    });
  });

  return {
    server,
    calls,
    entities,
    listen: () =>
      new Promise<string>((resolve) => {
        server.listen(0, "127.0.0.1", () => {
          const port = (server.address() as AddressInfo).port;
          resolve(`http://127.0.0.1:${port}`);
        });
      }),
  };
}

function goalEvent(patch: Partial<EventPayload> = {}): EventPayload {
  const team: Team = {
    id: "MTL",
    logo: "",
    name: "Montreal Canadiens",
    display_name: "Canadiens",
    abbr: "MTL",
    score: 1,
    options: {
      primary_color_rgb: { r: 175, g: 30, b: 45 },
      secondary_color_rgb: { r: 25, g: 55, b: 109 },
      alternate_color_rgb: { r: 255, g: 255, b: 255 },
    },
  };
  return {
    event_id: "ev-1",
    emitted_at: Date.now(),
    sport: "hockey",
    type: "goal",
    trigger: "goal",
    league: "nhl",
    game: {
      id: "nhl:123",
      sport: "hockey",
      league: "nhl",
      home: team,
      away: { ...team, id: "TOR", abbr: "TOR" },
      status: "in",
      clock: "10:00",
      period: 1,
      period_label: "1st",
      intermission: false,
      linescores: { home: [], away: [] },
      stats: { home: {}, away: {} },
      goals: [],
      start_time: new Date().toISOString(),
    },
    team,
    delay_s: 0,
    natural_text: "Goal Canadiens!",
    goal_horn: "http://example.com/mtl.mp3",
    ...patch,
  };
}

describe("Direct Home Assistant REST integration", () => {
  const token = "secret-token-123";
  let haMock: ReturnType<typeof mockHomeAssistant>;
  let haUrl: string;
  let store: Store;
  let engine: Engine;
  let haOutputs: HaOutputs;
  let lightRules: LightRules;

  beforeEach(async () => {
    haMock = mockHomeAssistant(token);
    haUrl = await haMock.listen();
    store = new Store(":memory:");
    store.patchSettings({
      ha: { url: haUrl, token, fire_rest_events: true },
      horn_players: ["media_player.mancave_speaker"],
      tts_player: "media_player.mancave_speaker",
      tts_engine: "tts.piper",
    });
    engine = new Engine(store);
    haOutputs = new HaOutputs(engine);
    lightRules = new LightRules(engine);
  });

  afterEach(() => {
    haMock.server.close();
  });

  it("syncs entities from Home Assistant into SQLite", async () => {
    const res = await haOutputs.syncEntities();
    expect(res.ok).toBe(true);
    expect(res.lights).toBe(2);
    expect(res.media_players).toBe(1);
    expect(res.tts_engines).toBe(1);

    const devices = store.getDevices();
    expect(devices.length).toBe(4);
    const mancave = devices.find((d) => d.entity_id === "light.mancave");
    expect(mancave).toBeDefined();
    expect(mancave?.name).toBe("Mancave Ceiling");
    expect(mancave?.supports_color).toBe(true);

    const speaker = devices.find((d) => d.entity_id === "media_player.mancave_speaker");
    expect(speaker?.device_class).toBe("media_player");
  });

  it("tests connection and syncs entities automatically", async () => {
    const res = await haOutputs.test();
    expect(res.ok).toBe(true);
    expect(res.sync).toEqual({ lights: 2, media_players: 1, tts_engines: 1 });
    expect(haMock.calls.some((c) => c.url === "/api/events/homeroom_test")).toBe(true);
  });

  it("plays goal horn on media players via REST", async () => {
    const ok = await haOutputs.playGoalHorn("http://example.com/horn.mp3");
    expect(ok).toBe(true);
    const playCall = haMock.calls.find((c) => c.url === "/api/services/media_player/play_media");
    expect(playCall).toBeDefined();
    expect(playCall?.body).toEqual({
      entity_id: ["media_player.mancave_speaker"],
      media_content_id: "http://example.com/horn.mp3",
      media_content_type: "music",
    });
  });

  it("speaks announcement via tts.speak service", async () => {
    const ok = await haOutputs.speakAnnouncement("Goal Montreal!");
    expect(ok).toBe(true);
    const speakCall = haMock.calls.find((c) => c.url === "/api/services/tts/speak");
    expect(speakCall).toBeDefined();
    // the REST API only accepts the service target as a top-level entity_id (a `target` object is a 400)
    expect(speakCall?.body).toEqual({
      entity_id: "tts.piper",
      media_player_entity_id: "media_player.mancave_speaker",
      message: "Goal Montreal!",
    });
    // the audio is synthesized first: AirPlay speakers abandon a proxy URL that is still generating
    const warm = haMock.calls.findIndex((c) => c.url === "/api/tts_get_url");
    expect(warm).toBeGreaterThanOrEqual(0);
    expect(warm).toBeLessThan(haMock.calls.findIndex((c) => c.url === "/api/services/tts/speak"));
  });

  it("falls back to the first discovered tts entity when no engine is configured", async () => {
    await haOutputs.syncEntities();
    store.patchSettings({ tts_engine: null });
    engine.invalidateSettings();
    expect(await haOutputs.speakAnnouncement("Goal Montreal!")).toBe(true);
    const speakCall = haMock.calls.find((c) => c.url === "/api/services/tts/speak");
    expect((speakCall?.body as { entity_id?: string }).entity_id).toBe("tts.piper");
  });

  it("retries a failed announcement once", async () => {
    let calls = 0;
    const fake = (async () => {
      calls++;
      return new Response("Speaker is sulking", { status: calls <= 2 ? 500 : 200 });
    }) as unknown as typeof fetch;
    const flaky = new HaOutputs(engine, { fetchImpl: fake });
    expect(await flaky.speakAnnouncement("Goal Montreal!")).toBe(true);
    expect(calls).toBe(3); // tts_get_url + tts.speak (failed) + tts.speak (retry)
  });

  it("speaks a goal announcement even when no horn is available", async () => {
    store.patchSettings({ horn_players: [], tts_player: "media_player.mancave_speaker", tts_engine: "tts.piper" });
    await haOutputs.orchestrateGoalAudio(goalEvent({ goal_horn: undefined }));
    const speakCall = haMock.calls.find((c) => c.url === "/api/services/tts/speak");
    expect(speakCall?.body).toEqual({
      entity_id: "tts.piper",
      media_player_entity_id: "media_player.mancave_speaker",
      message: "Goal Canadiens!",
    });
  });

  it("does not speak for a non-goal event", async () => {
    await haOutputs.orchestrateGoalAudio({ ...goalEvent(), type: "period_start", trigger: "period_start" });
    expect(haMock.calls.some((c) => c.url === "/api/services/tts/speak")).toBe(false);
  });

  it("executes light actions and restores original state directly via REST", async () => {
    await haOutputs.syncEntities();
    store.setActions([
      {
        id: "act-1",
        enabled: true,
        triggers: ["goal"],
        team_scope: "any",
        entities: ["light.mancave", "light.off_bulb"],
        effect: "set_color",
        duration: 0.1,
        speed: 5,
        colors: "team",
        restore: true,
      },
    ]);

    const team: Team = {
      id: "MTL",
      logo: "",
      name: "Montreal Canadiens",
      display_name: "Canadiens",
      abbr: "MTL",
      score: 1,
      options: {
        primary_color_rgb: { r: 175, g: 30, b: 45 },
        secondary_color_rgb: { r: 25, g: 55, b: 109 },
        alternate_color_rgb: { r: 255, g: 255, b: 255 },
      },
    };
    const game: Game = {
      id: "nhl:123",
      sport: "hockey",
      league: "nhl",
      home: team,
      away: { ...team, id: "TOR", abbr: "TOR" },
      status: "in",
      clock: "10:00",
      period: 1,
      period_label: "1st",
      intermission: false,
      linescores: { home: [], away: [] },
      stats: { home: {}, away: {} },
      goals: [],
      start_time: new Date().toISOString(),
    };
    const ev: EventPayload = {
      event_id: "ev-1",
      emitted_at: Date.now(),
      sport: "hockey",
      type: "goal",
      trigger: "goal",
      league: "nhl",
      game,
      team,
      delay_s: 0,
      natural_text: "Goal Canadiens!",
      goal_horn: "http://example.com/mtl.mp3",
    };

    const count = lightRules.handle(ev);
    expect(count).toBe(2);

    // Initial state fetches
    await vi.waitFor(() => {
      expect(haMock.calls.some((c) => c.url === "/api/states/light.mancave")).toBe(true);
      expect(haMock.calls.some((c) => c.url === "/api/states/light.off_bulb")).toBe(true);
    });

    // Team color applied
    await vi.waitFor(() => {
      const turnOnCalls = haMock.calls.filter((c) => c.url === "/api/services/light/turn_on");
      expect(turnOnCalls.some((c) => (c.body as { entity_id?: string; rgb_color?: number[] }).entity_id === "light.mancave")).toBe(true);
    });

    // Restoration after duration: light.mancave restored, light.off_bulb turned off
    await vi.waitFor(
      () => {
        expect(haMock.calls.some((c) => c.url === "/api/services/light/turn_off" && (c.body as { entity_id?: string }).entity_id === "light.off_bulb")).toBe(true);
      },
      { timeout: 3000 },
    );
  });
});
