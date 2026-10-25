import http from "node:http";
import { randomBytes } from "node:crypto";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp, type App } from "../src/app.js";
import { HornVolume } from "../src/outputs/horn_volume.js";
import { Store } from "../src/store.js";
import type { EventPayload, Game, Team } from "../src/types.js";

/** body of a Home Assistant media_player.volume_set call, as the fake HA server receives it */
interface VolumeSet {
  entity_id?: string;
  volume_level?: number;
}

/** A throw-away stand-in for Home Assistant's REST API. Never talks to anything real. */
function mockHa(token: string) {
  const players: Record<string, { state: string; volume?: number }> = {
    "media_player.den": { state: "idle", volume: 0.3 },
    "media_player.off": { state: "off" },
    "media_player.bad": { state: "idle", volume: 0.5 },
  };
  const calls: { method: string; url: string; body: VolumeSet; auth?: string }[] = [];
  let failSet = false;
  let playingFor = 0; // GETs after a volume_set that still report "playing"
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const body: VolumeSet = raw ? JSON.parse(raw) : {};
      calls.push({ method: req.method!, url: req.url!, body, auth: req.headers.authorization });
      if (req.headers.authorization !== `Bearer ${token}`) return void res.writeHead(401).end();
      const m = /^\/api\/states\/(.+)$/.exec(req.url!);
      if (req.method === "GET" && m) {
        const p = players[decodeURIComponent(m[1])];
        if (!p) return void res.writeHead(404).end("{}");
        const state = playingFor > 0 ? (playingFor--, "playing") : p.state;
        return void res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ state, attributes: p.volume === undefined ? {} : { volume_level: p.volume } }));
      }
      if (req.method === "POST" && req.url === "/api/services/media_player/volume_set") {
        const target = players[body.entity_id ?? ""];
        if (failSet || body.entity_id === "media_player.bad" || !target) return void res.writeHead(500).end("{}");
        target.volume = body.volume_level;
        if (body.volume_level !== 0.3) playingFor = 2;
        return void res.writeHead(200, { "content-type": "application/json" }).end("[]");
      }
      res.writeHead(404).end();
    });
  });
  return {
    players, calls,
    set failSet(v: boolean) { failSet = v; },
    listen: () => new Promise<string>((r) => server.listen(0, "127.0.0.1", () => r(`http://127.0.0.1:${(server.address() as AddressInfo).port}`))),
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}

const fast = { firstCheckMs: 5, pollMs: 5, maxPlayMs: 2000, timeoutMs: 500, prepareBudgetMs: 1000 };
let ha: ReturnType<typeof mockHa>;
let url: string;
let token: string;
beforeEach(async () => {
  token = randomBytes(8).toString("hex"); // random per run: no real credential ever appears in the repo
  ha = mockHa(token);
  url = await ha.listen();
});
afterEach(async () => {
  await ha.close();
});

const cfg = (over: Record<string, unknown> = {}) => () => ({ horn_volume: 0.9, horn_players: ["media_player.den"], ha: { url, token, fire_rest_events: false }, ...over }) as never;
const waitRestore = (entity: string, v: number) => vi.waitFor(() => expect(ha.players[entity].volume).toBe(v), { timeout: 1500 });

describe("HornVolume against a mock HA", () => {
  it("reads the volume, sets the horn volume before the horn, restores afterwards", async () => {
    const hv = new HornVolume(cfg(), fast);
    await hv.prepare("e1");
    expect(ha.players["media_player.den"].volume).toBe(0.9);
    expect(ha.calls.map((c) => `${c.method} ${c.url}`).slice(0, 2)).toEqual(["GET /api/states/media_player.den", "POST /api/services/media_player/volume_set"]);
    expect(ha.calls.every((c) => c.auth === `Bearer ${token}`)).toBe(true);
    await waitRestore("media_player.den", 0.3);
    const sets = ha.calls.filter((c) => c.method === "POST").map((c) => c.body.volume_level);
    expect(sets).toEqual([0.9, 0.3]);
  });

  it("two quick goals keep the ORIGINAL volume as the one to restore", async () => {
    const hv = new HornVolume(cfg(), { ...fast, firstCheckMs: 50 });
    await Promise.all([hv.prepare("e1"), hv.prepare("e2")]);
    await waitRestore("media_player.den", 0.3);
    await new Promise((r) => setTimeout(r, 150));
    expect(ha.players["media_player.den"].volume).toBe(0.3);
    expect(ha.calls.filter((c) => c.method === "GET" && c.url.endsWith("den")).length).toBeGreaterThan(0);
    expect(ha.calls.filter((c) => c.method === "POST").map((c) => c.body.volume_level).pop()).toBe(0.3);
  });

  it("is a strict no-op unless configured (volume null, no players, no token) and never touches non-media_player ids", async () => {
    for (const over of [{ horn_volume: null }, { horn_players: [] }, { ha: { url, token: "", fire_rest_events: false } }, { ha: { url: "", token, fire_rest_events: false } }]) {
      await new HornVolume(cfg(over), fast).prepare("x");
    }
    expect(ha.calls).toEqual([]);
  });

  it("leaves players alone when their volume cannot be read (off) and survives HA errors", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const hv = new HornVolume(cfg({ horn_players: ["media_player.off", "media_player.bad", "media_player.den", "media_player.missing"] }), fast);
    await expect(hv.prepare("e1")).resolves.toBeUndefined();
    expect(ha.calls.some((c) => c.method === "POST" && c.body.entity_id === "media_player.off")).toBe(false);
    expect(ha.players["media_player.den"].volume).toBe(0.9); // the healthy player still worked
    expect(ha.players["media_player.bad"].volume).toBe(0.5);
    expect(warn).toHaveBeenCalled();
    expect(warn.mock.calls.flat().join(" ")).not.toContain(token);
  });

  it("an unreachable or wrong-token HA never throws and never blocks past the budget", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const t0 = Date.now();
    await new HornVolume(cfg({ ha: { url: "http://127.0.0.1:9", token, fire_rest_events: false } }), fast).prepare("e1");
    await new HornVolume(cfg({ ha: { url, token: "wrong", fire_rest_events: false } }), fast).prepare("e1");
    expect(Date.now() - t0).toBeLessThan(1500);
    expect(ha.players["media_player.den"].volume).toBe(0.3);
    // a hung HA: prepare resolves at the budget
    const hung = http.createServer(() => {});
    await new Promise<void>((r) => hung.listen(0, "127.0.0.1", r));
    const hungUrl = `http://127.0.0.1:${(hung.address() as AddressInfo).port}`;
    const t1 = Date.now();
    await new HornVolume(cfg({ ha: { url: hungUrl, token, fire_rest_events: false } }), { ...fast, timeoutMs: 5000, prepareBudgetMs: 150 }).prepare("e1");
    expect(Date.now() - t1).toBeLessThan(600);
    hung.closeAllConnections();
    await new Promise<void>((r) => hung.close(() => r()));
  });
});

describe("settings validation", () => {
  it("validates horn_volume and horn_players in patchSettings", () => {
    const s = new Store(":memory:");
    expect(s.getSettings()).toMatchObject({ horn_volume: null, horn_players: [] });
    expect(s.patchSettings({ horn_volume: 1.5 })).toMatch(/horn_volume/);
    expect(s.patchSettings({ horn_volume: -0.1 })).toMatch(/horn_volume/);
    expect(s.patchSettings({ horn_volume: "loud" as never })).toMatch(/horn_volume/);
    expect(s.patchSettings({ horn_players: ["light.kitchen"] })).toMatch(/horn_players/);
    expect(s.patchSettings({ horn_players: ["media_player.Den"] })).toMatch(/horn_players/);
    expect(s.patchSettings({ horn_players: "media_player.den" as never })).toMatch(/horn_players/);
    expect(s.patchSettings({ horn_volume: 0.6, horn_players: ["media_player.den", "media_player.kitchen_2"] })).toBeUndefined();
    expect(s.getSettings()).toMatchObject({ horn_volume: 0.6, horn_players: ["media_player.den", "media_player.kitchen_2"] });
    expect(s.patchSettings({ horn_volume: null })).toBeUndefined();
    expect(s.getSettings().horn_volume).toBeNull();
  });
});

describe("wired into the goal path", () => {
  let app: App;
  afterEach(async () => {
    await app.close();
  });
  const rgb = { r: 1, g: 2, b: 3 };
  const team = (abbr: string): Team => ({ id: abbr, abbr, name: abbr, display_name: abbr, logo: "", score: 1, options: { primary_color_rgb: rgb, secondary_color_rgb: rgb, alternate_color_rgb: rgb } });
  const game: Game = { id: "nhl:1", league: "nhl", sport: "hockey", status: "in", start_time: "", period: 1, period_label: "1st", clock: "1:00", intermission: false, home: team("MIN"), away: team("CBJ"), linescores: { home: [], away: [] }, stats: { home: {}, away: {} }, goals: [] };
  const goal = (horn?: string): EventPayload => ({ event_id: `evt_${Math.random()}`, type: "goal", emitted_at: 0, delay_s: 0, league: "nhl", sport: "hockey", game, team: game.home, natural_text: "goal", goal_horn: horn });

  it("sets the volume BEFORE goal_horn goes out, goal is not delayed, and nothing happens without a horn", async () => {
    app = await createApp({ store: new Store(":memory:"), appKey: "k", appSecret: "s", webDir: "/nonexistent", port: 0 });
    app.store.link("some-key");
    expect(app.store.patchSettings({ ha: { url, token, fire_rest_events: false }, horn_volume: 0.8, horn_players: ["media_player.den"] })).toBeUndefined();
    app.engine.invalidateSettings();
    (app.ha as { hornVolume: HornVolume }).hornVolume = new HornVolume(() => app.engine.settings, fast);
    const order: string[] = [];
    vi.spyOn(app.hub, "broadcast").mockImplementation((_ch, event) => {
      order.push(`${event}@vol=${ha.players["media_player.den"].volume}`);
      return 1;
    });
    app.ha.publishPusher(goal(undefined));
    await new Promise((r) => setTimeout(r, 50));
    expect(ha.calls).toEqual([]); // no horn file => no volume change
    order.length = 0;
    app.ha.publishPusher(goal("http://x/media/horns/nhl/default.mp3"));
    expect(order).toEqual(["goal@vol=0.3"]); // goal is immediate
    await vi.waitFor(() => expect(order).toHaveLength(2));
    expect(order[1]).toBe("goal_horn@vol=0.8");
    await waitRestore("media_player.den", 0.3);
  });
});
