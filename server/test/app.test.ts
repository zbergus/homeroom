import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import WebSocket from "ws";
import { createApp, type App } from "../src/app.js";
import { Store } from "../src/store.js";
import type { Game, Team } from "../src/types.js";

const KEY = "testkey";
let app: App;
let base: string;

interface WsData {
  action?: string;
  effect?: string;
  state?: unknown;
  socket_id?: string;
  request_id?: string;
  code?: number;
  scoring?: { label: string };
  team?: { options: { primary_color_rgb: unknown } };
}

async function getJson<T>(path: string): Promise<T> {
  return (await (await fetch(base + path)).json()) as T;
}

const rgb = { r: 1, g: 2, b: 3 };
const team = (abbr: string): Team => ({ id: abbr, abbr, name: abbr, display_name: abbr, logo: "", score: 0, options: { primary_color_rgb: rgb, secondary_color_rgb: rgb, alternate_color_rgb: rgb } });
const gameOf = (over: Partial<Game> = {}): Game => ({
  id: "nhl:7", league: "nhl", sport: "hockey", status: "pre", start_time: new Date().toISOString(), period: 0, period_label: "", clock: "", intermission: false,
  home: team("MIN"), away: team("CBJ"), linescores: { home: [], away: [] }, stats: { home: {}, away: {} }, goals: [], ...over,
});

async function boot(): Promise<void> {
  app = await createApp({ store: new Store(":memory:"), appKey: KEY, appSecret: "testsecret", webDir: "/nonexistent", port: 0 });
  base = `http://127.0.0.1:${app.port}`;
}
beforeEach(boot);
afterEach(async () => {
  delete process.env.ADMIN_TOKEN;
  await app.close();
});

const json = (path: string, method: string, body?: unknown, headers: Record<string, string> = {}) =>
  fetch(base + path, { method, headers: { "content-type": "application/json", ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });

/** Minimal pysher stand-in: link, device sync, signed subscribe, collect messages. */
async function connectIntegration(devices: unknown[] = []) {
  const auth = { Authorization: "Bearer my-api-key" };
  const link = (await (await fetch(`${base}/integrations/home-assistant/link`, { method: "POST", headers: auth, body: new URLSearchParams({ home_assistant_id: "x" }) })).json()) as Record<string, string>;
  expect(link.success).toBe(true);
  await json("/integrations/home-assistant/devices/sync", "POST", { devices }, auth);

  const ws = new WebSocket(`ws://127.0.0.1:${app.port}/app/${KEY}?protocol=7`);
  const msgs: { event: string; channel?: string; data: WsData }[] = [];
  let socketId = "";
  ws.on("message", (raw) => {
    const m = JSON.parse(raw.toString());
    m.data = typeof m.data === "string" ? JSON.parse(m.data) : m.data;
    msgs.push(m);
    if (m.event === "pusher:connection_established") socketId = m.data.socket_id;
  });
  await vi.waitFor(() => expect(socketId).not.toBe(""));

  const subscribe = async (channel: string) => {
    const r = await fetch(`${base}/auth/websockets`, {
      method: "POST",
      headers: { "x-websocket-key": link.websocket_key },
      body: new URLSearchParams({ socket_id: socketId, channel_name: channel }),
    });
    expect(r.status).toBe(200);
    const { auth: sig } = (await r.json()) as { auth: string };
    ws.send(JSON.stringify({ event: "pusher:subscribe", data: { channel, auth: sig } }));
    await vi.waitFor(() => expect(msgs.some((m) => m.event === "pusher_internal:subscription_succeeded" && m.channel === channel)).toBe(true));
  };
  await subscribe(`private-${link.unique_id}`);
  await subscribe(`private-home-assistant.${link.integration_key}`);
  return { ws, msgs, link, auth, socketId };
}

describe("Home Assistant integration compatibility (what pysher does)", () => {
  it("rejects a bad signature, an unknown app key, and cross-install channels", async () => {
    const { ws, msgs, link } = await connectIntegration();
    ws.send(JSON.stringify({ event: "pusher:subscribe", data: { channel: `private-${link.unique_id}x`, auth: `${KEY}:00` } }));
    await vi.waitFor(() => expect(msgs.some((m) => m.event === "pusher:error" && m.data.code === 4009)).toBe(true));
    const other = await fetch(`${base}/auth/websockets`, { method: "POST", headers: { "x-websocket-key": link.websocket_key }, body: new URLSearchParams({ socket_id: "1.1", channel_name: "private-someone-else" }) });
    expect(other.status).toBe(403);
    await new Promise<void>((resolve) => {
      const bad = new WebSocket(`ws://127.0.0.1:${app.port}/app/WRONG`);
      bad.on("unexpected-response", (_r, res) => (expect(res.statusCode).toBe(401), resolve()));
      bad.on("error", () => resolve());
    });
    ws.close();
  });

  it("a manual trigger reaches the integration (goal) and drives lights with get_state -> execute -> restore", async () => {
    const dev = { entity_id: "light.test", capabilities: { supported_color_modes: ["hs"] }, device_class: "light", name: "Test", supports_flash_speed: true, supports_flash_duration: true, supports_alternate_speed: true, supports_alternate_duration: true };
    const { ws, msgs, link, auth } = await connectIntegration([dev]);
    const put = await json("/api/actions", "PUT", [{ id: "a1", enabled: true, triggers: ["touchdown"], team_scope: "any", entities: ["light.test"], effect: "alternate", duration: 0.5, speed: 5, colors: "team", restore: true }]);
    expect(put.status).toBe(200);

    // answer get_state like the integration does
    ws.on("message", async (raw) => {
      const m = JSON.parse(raw.toString());
      if (m.event === "get_state.light.test") {
        const d = JSON.parse(m.data);
        await json("/requests/execute", "POST", { scope: `home-assistant.${link.integration_key}`, payload: JSON.stringify({ brightness: 200, color_mode: "hs", hs_color: [10, 50] }), request_id: d.request_id }, auth);
      }
    });

    const res = (await (await json("/api/trigger", "POST", { trigger: "touchdown" })).json()) as { ok: boolean };
    expect(res.ok).toBe(true);
    await vi.waitFor(() => expect(msgs.some((m) => m.event === "execute.light.test" && m.data.action === "restore")).toBe(true), { timeout: 4000 });

    const goal = msgs.find((m) => m.event === "goal")!;
    expect(goal.data.scoring?.label).toBe("TOUCHDOWN");
    expect(goal.data.team?.options.primary_color_rgb).toHaveProperty("r");
    expect(goal.data).not.toHaveProperty("already_triggered_from_score_change");
    const order = msgs.map((m) => m.event).filter((e) => /^(get_state|execute)/.test(e));
    expect(order).toEqual(["get_state.light.test", "execute.light.test", "execute.light.test"]);
    expect(msgs.find((m) => m.event === "execute.light.test")!.data.action).toBe("alternate");

    // an action that only wants 3-pointers must not fire for a touchdown
    const before = msgs.length;
    await json("/api/actions", "PUT", [{ id: "a2", enabled: true, triggers: ["basket_3"], team_scope: "any", entities: ["light.test"], effect: "flash", duration: 1, speed: 5, colors: "team", restore: false }]);
    await json("/api/trigger", "POST", { trigger: "touchdown" });
    await new Promise((r) => setTimeout(r, 300));
    expect(msgs.slice(before).filter((m) => m.event.startsWith("execute"))).toHaveLength(0);
    ws.close();
  });

  it("white-only lights get a flash instead of an alternate; colour lights keep the configured effect", async () => {
    const white = { entity_id: "light.white", capabilities: { supported_color_modes: ["color_temp"] }, device_class: "light", name: "White" };
    const color = { entity_id: "light.color", capabilities: { supported_color_modes: ["hs", "color_temp"] }, device_class: "light", name: "Color" };
    const { ws, msgs } = await connectIntegration([white, color]);
    const devs = await getJson<{ entity_id: string; supports_color: boolean }[]>("/api/devices");
    expect(Object.fromEntries(devs.map((d) => [d.entity_id, d.supports_color]))).toEqual({ "light.white": false, "light.color": true });
    await json("/api/actions", "PUT", [{ id: "a", enabled: true, triggers: ["any_score"], team_scope: "any", entities: ["light.white", "light.color"], effect: "alternate", duration: 1, speed: 5, colors: "team", restore: false }]);
    await json("/api/trigger", "POST", { trigger: "goal" });
    await vi.waitFor(() => expect(msgs.filter((m) => m.event.startsWith("execute.")).length).toBe(2));
    expect(msgs.find((m) => m.event === "execute.light.white")!.data.action).toBe("flash");
    expect(msgs.find((m) => m.event === "execute.light.color")!.data.action).toBe("alternate");
    ws.close();
  });

  it("light_effect sets the light's own effect, and restores colour plus its 'none' effect afterwards", async () => {
    const hue = { entity_id: "light.driveway", capabilities: { supported_color_modes: ["hs"], effect_list: ["None", "candle", "fire"] }, device_class: "light", name: "Driveway" };
    const plain = { entity_id: "light.plain", capabilities: { supported_color_modes: ["hs"] }, device_class: "light", name: "Plain" };
    const { ws, msgs, link, auth } = await connectIntegration([hue, plain]);
    ws.on("message", async (raw) => {
      const m = JSON.parse(raw.toString());
      if (m.event.startsWith("get_state.")) await json("/requests/execute", "POST", { scope: `home-assistant.${link.integration_key}`, payload: JSON.stringify({ brightness: 120, color_mode: "hs", hs_color: [30, 60] }), request_id: JSON.parse(m.data).request_id }, auth);
    });
    expect((await json("/api/actions", "PUT", [{ id: "e", enabled: true, triggers: ["any_score"], team_scope: "any", entities: ["light.driveway", "light.plain"], effect: "light_effect", duration: 0.5, speed: 5, colors: "team", restore: true }])).status).toBe(400); // no effect name
    expect((await json("/api/actions", "PUT", [{ id: "e", enabled: true, triggers: ["any_score"], team_scope: "any", entities: ["light.driveway", "light.plain"], effect: "light_effect", light_effect: "candle", duration: 0.5, speed: 5, colors: "team", restore: true }])).status).toBe(200);
    await json("/api/trigger", "POST", { trigger: "goal" });
    await vi.waitFor(() => expect(msgs.some((m) => m.event === "execute.light.driveway" && m.data.action === "restore")).toBe(true), { timeout: 4000 });
    const drive = msgs.filter((m) => m.event === "execute.light.driveway").map((m) => m.data);
    expect(drive[0]).toEqual({ action: "set_effect", effect: "candle" });
    expect(drive[1].state).toMatchObject({ brightness: 120, effect: "None" });
    // a light that does not advertise "candle" gets a plain flash instead
    expect(msgs.find((m) => m.event === "execute.light.plain")!.data.action).toBe("flash");
    ws.close();
  });

  it("the event log explains what happened, and /api/status shows the link", async () => {
    const { ws } = await connectIntegration();
    await json("/api/trigger", "POST", { trigger: "goal" });
    const log = await getJson<{ sent: { pusher_clients: number } }[]>("/api/events/recent");
    expect(log[0]).toMatchObject({ type: "goal", manual: true, outcome: "delivered" });
    expect(log[0].sent.pusher_clients).toBe(1);
    const st = await getJson<{ integration: { links: unknown[] }; warnings: string[] }>("/api/status");
    expect(st.integration.links[0]).toMatchObject({ events_connected: true, devices_connected: true });
    expect(st.warnings.join(" ")).toMatch(/PUBLIC_BASE_URL is not set/);
    ws.close();
  });
});

describe("control plane", () => {
  it("UI websocket snapshots and game updates include server clock reference timestamps", async () => {
    const before = Date.now();
    const game = gameOf({ status: "in", period: 2, clock_s: 754, clock_dir: "down" });
    app.engine.ingestEspn(game);
    const messages: { t: string; server_now_ms: number; games?: Game[]; game?: Game }[] = [];
    const ws = new WebSocket(`ws://127.0.0.1:${app.port}/ws`);
    ws.on("message", (raw) => messages.push(JSON.parse(raw.toString())));
    try {
      await vi.waitFor(() => expect(messages.some((m) => m.t === "snapshot")).toBe(true));
      expect(messages[0]?.games?.[0]?.clock_at_ms).toBeGreaterThanOrEqual(before);
      app.engine.ingestEspn({ ...game, clock_s: 750 });
      await vi.waitFor(() => expect(messages.some((m) => m.t === "game")).toBe(true));
      expect(messages.find((m) => m.t === "game")?.game?.clock_at_ms).toBeGreaterThanOrEqual(before);
      app.ui.snapshot();
      await vi.waitFor(() => expect(messages.filter((m) => m.t === "snapshot")).toHaveLength(2));
      for (const message of messages) {
        expect(message.server_now_ms).toBeGreaterThanOrEqual(before);
        expect(message.server_now_ms).toBeLessThanOrEqual(Date.now());
      }
    } finally {
      ws.close();
    }
  });

  it("never returns the Home Assistant token; blank keeps it, clear_token removes it", async () => {
    await json("/api/settings", "PUT", { ha: { url: "http://ha.local:8123", token: "s3cret", fire_rest_events: false } });
    let s = await getJson<{ ha: { token_set: boolean } }>("/api/settings");
    expect(JSON.stringify(s)).not.toContain("s3cret");
    expect(s.ha).toMatchObject({ url: "http://ha.local:8123", token: "", token_set: true });
    await json("/api/settings", "PUT", { ha: { url: "http://ha.local:8123", token: "" } });
    expect(app.engine.settings.ha.token).toBe("s3cret");
    await json("/api/settings", "PUT", { ha: { clear_token: true } });
    s = await getJson<{ ha: { token_set: boolean } }>("/api/settings");
    expect(s.ha.token_set).toBe(false);
  });

  it("saving the delay does not re-poll every league; changing a polling setting does", async () => {
    const poke = vi.spyOn(app.poller, "poke").mockImplementation(() => {});
    expect((await json("/api/settings", "PUT", { delay_global_s: 12.5 })).status).toBe(200);
    expect((await json("/api/settings", "PUT", { delay_by_league: { nhl: 3 } })).status).toBe(200);
    expect((await json("/api/settings", "PUT", { my_team_only: true })).status).toBe(200);
    expect(poke).not.toHaveBeenCalled();
    await json("/api/settings", "PUT", { enabled_leagues: ["nhl"] });
    expect(poke).toHaveBeenCalledTimes(1);
    expect((await json("/api/settings", "PUT", { delay_global_s: 0.3 })).status).toBe(400);
    expect((await json("/api/settings", "PUT", { enabled_leagues: ["nope"] })).status).toBe(400);
  });

  it("validates triggers and actions", async () => {
    expect((await json("/api/trigger", "POST", { trigger: "bogus" })).status).toBe(400);
    expect((await json("/api/trigger", "POST", { trigger: "goal", league: "xx" })).status).toBe(400);
    expect((await json("/api/actions", "PUT", [{ id: "a", enabled: true, triggers: ["nope"], team_scope: "any", entities: [], effect: "flash" }])).status).toBe(400);
    const legacy = await json("/api/actions", "PUT", [{ id: "a", enabled: true, on: ["goal"], team_scope: "any", entities: [], effect: "flash", duration: 3, speed: 5, colors: "team", restore: true }]);
    expect(((await legacy.json()) as { triggers: string[] }[])[0]?.triggers).toEqual(["any_score"]);
    const list = (await (await fetch(`${base}/api/triggers`)).json()) as { id: string }[];
    expect(list.map((t) => t.id)).toEqual(expect.arrayContaining(["touchdown", "basket_3", "win", "period_end"]));
  });

  it("GET /api/hook/:trigger demands the admin token when one is configured", async () => {
    await app.close();
    process.env.ADMIN_TOKEN = "tok";
    await boot();
    expect((await fetch(`${base}/api/hook/goal`)).status).toBe(401);
    expect((await fetch(`${base}/api/hook/goal?token=wrong`)).status).toBe(401);
    expect((await fetch(`${base}/api/hook/goal?token=tok`)).status).toBe(200);
    expect((await fetch(`${base}/api/hook/goal`, { headers: { authorization: "Bearer tok" } })).status).toBe(200);
    expect((await fetch(`${base}/api/hook/not_a_trigger?token=tok`)).status).toBe(400);
    expect((await json("/api/trigger", "POST", { trigger: "goal" })).status).toBe(401); // mutating call needs the header
  });

  it("with ADMIN_TOKEN set: reads stay open, every mutating /api route needs the Bearer token, integration routes use their own keys", async () => {
    await app.close();
    process.env.ADMIN_TOKEN = "tok";
    await boot();
    for (const path of ["/api/settings", "/api/status", "/api/schedule", "/api/games/live", "/api/events/recent", "/healthz"]) {
      expect((await fetch(base + path)).status, `GET ${path}`).toBe(200);
    }
    const bearer = { authorization: "Bearer tok" };
    const mutating: [string, string, unknown][] = [
      ["/api/settings", "PUT", { delay_global_s: 5 }],
      ["/api/sync", "PUT", { games: [] }],
      ["/api/actions", "PUT", []],
      ["/api/trigger", "POST", { trigger: "goal" }],
      ["/api/ha/test", "POST", {}],
      ["/api/teams/nhl/MIN", "PUT", {}],
      ["/api/horns/nhl/default", "DELETE", undefined],
    ];
    const call = (path: string, method: string, body: unknown, h: Record<string, string> = {}) =>
      body === undefined ? fetch(base + path, { method, headers: h }) : json(path, method, body, h);
    for (const [path, method, body] of mutating) {
      expect((await call(path, method, body)).status, `${method} ${path} without token`).toBe(401);
      expect((await call(path, method, body, { authorization: "Bearer nope" })).status, `${method} ${path} wrong token`).toBe(401);
      expect((await call(path, method, body, bearer)).status, `${method} ${path} with token`).toBeLessThan(400);
    }
    expect(app.engine.settings.delay_global_s).toBe(5);
    // the Pusher-compatible integration endpoints are not behind ADMIN_TOKEN (they have their own api/websocket keys)
    const link = await fetch(`${base}/integrations/home-assistant/link`, { method: "POST", headers: { authorization: "Bearer my-api-key" } });
    expect(((await link.json()) as { success: boolean }).success).toBe(true);
  });

  it("POST /api/calibrate requires a unique timestamped historical clock match", async () => {
    const game = gameOf({ status: "in", period: 2, period_label: "2nd period", clock: "12:34", clock_s: 754, clock_dir: "down" });
    app.engine.games.set(game.id, game);
    const request = { game_id: "nhl:7", tv_period: 2, tv_clock: "12:50" };
    const insufficient = await json("/api/calibrate", "POST", request);
    expect(insufficient.status).toBe(409);
    expect(await insufficient.json()).toEqual({ error: expect.stringMatching(/history.*retry.*ticking/) });
    const now = Date.now();
    app.engine.clockHistory.record({ ...game, clock_s: 774, clock_running: true }, now - 40_000);
    app.engine.clockHistory.record({ ...game, clock_s: 766, clock_running: true }, now - 32_000);
    const response = await json("/api/calibrate", "POST", request);
    expect(response.status).toBe(200);
    const ok = (await response.json()) as { delay_s: number; uncertainty_s: number };
    expect(ok.delay_s).toBeGreaterThanOrEqual(35.5);
    expect(ok.delay_s).toBeLessThanOrEqual(36.5);
    expect(ok.uncertainty_s).toBeGreaterThan(0);
    expect((await json("/api/calibrate", "POST", { ...request, tv_clock: "1:60" })).status).toBe(400);
    expect((await json("/api/calibrate", "POST", { ...request, tv_clock: "11:00" })).status).toBe(409);
    expect((await json("/api/calibrate", "POST", { game_id: "nhl:7", tv_period: 2, tv_clock: "nope" })).status).toBe(400);
    expect((await json("/api/calibrate", "POST", { game_id: "nhl:404", tv_period: 2, tv_clock: "12:50" })).status).toBe(404);
    app.engine.ingestEspn({ ...game, status: "pre", clock_s: undefined });
    expect((await json("/api/calibrate", "POST", { game_id: "nhl:7", tv_period: 2, tv_clock: "12:50" })).status).toBe(409);
  });

  it("/api/sync reports the effective set: ticked + auto-synced favourites, minus exclusions", async () => {
    const mk = (id: string, h: string, a: string) => gameOf({ id, home: team(h), away: team(a) });
    app.engine.ingestEspn(mk("nhl:a", "MIN", "CBJ"));
    app.engine.ingestEspn(mk("nhl:b", "TOR", "BOS"));
    await json("/api/sync", "PUT", { games: ["nhl:b"], favorites: [{ league: "nhl", abbr: "MIN" }] });
    let s = await getJson<{ games: string[]; effective: string[] }>("/api/sync");
    expect(s.games).toEqual(["nhl:b"]);
    expect(s.effective.sort()).toEqual(["nhl:a", "nhl:b"]); // a is auto-synced through MIN
    await json("/api/settings", "PUT", { sync_excluded: ["nhl:a"] });
    s = await getJson<{ games: string[]; effective: string[] }>("/api/sync");
    expect(s.effective).toEqual(["nhl:b"]);
  });

  it("raw games endpoint is separate from the delayed one", async () => {
    expect(await (await fetch(`${base}/api/games/raw`)).json()).toEqual([]);
    expect(await (await fetch(`${base}/api/games/live`)).json()).toEqual([]);
  });
});
