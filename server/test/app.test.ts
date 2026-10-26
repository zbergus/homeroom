import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import WebSocket from "ws";
import { createApp, type App } from "../src/app.js";
import { Store } from "../src/store.js";
import type { Game, Team } from "../src/types.js";

let app: App;
let base: string;

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
  app = await createApp({ store: new Store(":memory:"), webDir: "/nonexistent", port: 0 });
  base = `http://127.0.0.1:${app.port}`;
}
beforeEach(boot);
afterEach(async () => {
  delete process.env.ADMIN_TOKEN;
  await app.close();
});

const json = (path: string, method: string, body?: unknown, headers: Record<string, string> = {}) =>
  fetch(base + path, { method, headers: { "content-type": "application/json", ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });



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
    expect(list.map((t) => t.id)).toEqual(expect.arrayContaining(["goal", "ppg", "powerplay", "penalty", "win", "period_end"]));
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

    // elapsed_ms discounts processing/review time from the measured delay
    const delayedReq = await json("/api/calibrate", "POST", { ...request, elapsed_ms: 10_000 });
    expect(delayedReq.status).toBe(200);
    const delayedOk = (await delayedReq.json()) as { delay_s: number };
    expect(delayedOk.delay_s).toBeGreaterThanOrEqual(25.5);
    expect(delayedOk.delay_s).toBeLessThanOrEqual(26.5);
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

  it("GET /api/teams/:league/:abbr/roster returns roster players and validates input", async () => {
    expect((await fetch(`${base}/api/teams/invalid/MTL/roster`)).status).toBe(400);
    expect((await fetch(`${base}/api/teams/nhl/toolongabbr/roster`)).status).toBe(400);
    const res = await fetch(`${base}/api/teams/nhl/MTL/roster`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
  });

  it("GET /api/games/:id/boxscore returns boxscore for sim game or 404 for unknown game", async () => {
    expect((await fetch(`${base}/api/games/unknown:999/boxscore`)).status).toBe(404);
    const res = await fetch(`${base}/api/games/nhl:sim/boxscore`);
    expect(res.status).toBe(200);
    const data = (await res.json()) as { game_id: string; home: { skaters: unknown[]; goalies: unknown[] } };
    expect(data.game_id).toBe("nhl:sim");
    expect(data.home.skaters.length).toBeGreaterThan(0);
    expect(data.home.goalies.length).toBeGreaterThan(0);
  });
});
