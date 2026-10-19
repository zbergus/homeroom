import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { createApp, type App } from "../src/app.js";
import { type Config, loadConfig, securityNotes } from "../src/config.js";
import { errMsg, isCrossSite, RateLimiter, safeEq } from "../src/security.js";
import { MAX_LINKS, Store } from "../src/store.js";

let app: App | undefined;
let base = "";

async function boot(over: Partial<Config> = {}): Promise<App> {
  const config = { ...loadConfig({}), ...over };
  app = await createApp({ store: new Store(":memory:"), appKey: "k", appSecret: "s", webDir: "/nonexistent", port: 0, config });
  base = `http://127.0.0.1:${app.port}`;
  return app;
}
afterEach(async () => {
  await app?.close();
  app = undefined;
});

const json = (path: string, method: string, body?: unknown, headers: Record<string, string> = {}) =>
  fetch(base + path, { method, headers: { "content-type": "application/json", ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });

describe("cross-site requests", () => {
  it("refuses browser requests from another origin on mutating routes and on the GET hook", async () => {
    await boot();
    const evil = { origin: "http://evil.example" };
    expect((await json("/api/trigger", "POST", { trigger: "goal" }, evil)).status).toBe(403);
    expect((await json("/api/settings", "PUT", { my_team_only: true }, evil)).status).toBe(403);
    expect((await fetch(`${base}/api/hook/goal`, { headers: { "sec-fetch-site": "cross-site" } })).status).toBe(403);
    expect((await fetch(`${base}/api/hook/goal`, { headers: evil })).status).toBe(403);
    expect(app!.engine.settings.my_team_only).toBe(false);
  });

  it("still serves the page's own origin, tools without an Origin header, and listed dev origins", async () => {
    await boot({ allowedOrigins: ["localhost:5173"] });
    const host = new URL(base).host;
    expect((await json("/api/trigger", "POST", { trigger: "goal" }, { origin: `http://${host}` })).status).toBe(200);
    expect((await json("/api/trigger", "POST", { trigger: "goal" })).status).toBe(200);
    expect((await json("/api/trigger", "POST", { trigger: "goal" }, { origin: "http://localhost:5173" })).status).toBe(200);
    expect((await fetch(`${base}/api/settings`, { headers: { origin: "http://evil.example" } })).status).toBe(200); // reads carry no side effects
  });

  it("refuses WebSocket upgrades from another origin", async () => {
    await boot();
    const status = await new Promise<number>((resolve) => {
      const ws = new WebSocket(`ws://127.0.0.1:${app!.port}/ws`, { headers: { origin: "http://evil.example" } });
      ws.on("unexpected-response", (_req, res) => resolve(res.statusCode ?? 0));
      ws.on("open", () => resolve(101));
    });
    expect(status).toBe(403);
  });

  it("only accepts JSON on the API (a form post is the classic CSRF carrier)", async () => {
    await boot();
    const form = await fetch(`${base}/api/trigger`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "trigger=goal" });
    expect(form.status).toBe(415);
    const text = await fetch(`${base}/api/trigger`, { method: "POST", headers: { "content-type": "text/plain" }, body: '{"trigger":"goal"}' });
    expect(text.status).toBe(415);
    // the integration routes keep taking form bodies, as the Home Assistant integration sends them
    const link = await fetch(`${base}/integrations/home-assistant/link`, { method: "POST", headers: { authorization: "Bearer k1" }, body: new URLSearchParams({ a: "b" }) });
    expect(((await link.json()) as { success: boolean }).success).toBe(true);
  });
});

describe("settings boundary", () => {
  it("rejects non-http(s) URLs for the HA url and the public base url", async () => {
    await boot();
    for (const url of ["javascript:alert(1)", "file:///etc/passwd", "not a url", "ftp://x"]) {
      expect((await json("/api/settings", "PUT", { ha: { url } })).status, url).toBe(400);
      expect((await json("/api/settings", "PUT", { public_base_url: url })).status, url).toBe(400);
    }
    expect((await json("/api/settings", "PUT", { ha: { url: "http://ha.local:8123" }, public_base_url: "http://192.168.1.10:8080" })).status).toBe(200);
  });

  it("drops the stored HA token when the URL changes without a new token (it cannot be redirected to another host)", async () => {
    await boot();
    await json("/api/settings", "PUT", { ha: { url: "http://ha.local:8123", token: "s3cret" } });
    expect(app!.engine.settings.ha.token).toBe("s3cret");
    await json("/api/settings", "PUT", { ha: { url: "http://ha.local:8123" } }); // same url: token kept
    expect(app!.engine.settings.ha.token).toBe("s3cret");
    await json("/api/settings", "PUT", { ha: { url: "http://attacker.example" } });
    expect(app!.engine.settings.ha).toMatchObject({ url: "http://attacker.example", token: "" });
    await json("/api/settings", "PUT", { ha: { url: "http://ha2.local:8123", token: "new" } }); // a new url with its own token is fine
    expect(app!.engine.settings.ha.token).toBe("new");
  });

  it("does not persist keys that are not settings", async () => {
    await boot();
    expect((await json("/api/settings", "PUT", { my_team_only: true, __proto__x: 1, injected: { a: 1 }, token_set: true })).status).toBe(200);
    const saved = app!.store.getSettings() as unknown as Record<string, unknown>;
    expect(saved.my_team_only).toBe(true);
    expect("injected" in saved).toBe(false);
    expect("token_set" in saved).toBe(false);
  });

  it("answers malformed bodies with 400, never 500", async () => {
    await boot();
    expect((await json("/api/actions", "PUT", [null])).status).toBe(400);
    expect((await json("/api/actions", "PUT", { not: "an array" })).status).toBe(400);
    const a = { id: "a", enabled: true, triggers: ["goal"], team_scope: "any", effect: "flash", duration: 3, speed: 5, colors: "team", restore: true };
    expect((await json("/api/actions", "PUT", [{ ...a, entities: [42] }])).status).toBe(400);
    expect((await json("/api/actions", "PUT", [{ ...a, entities: ["../../etc"] }])).status).toBe(400);
    expect((await json("/api/actions", "PUT", [{ ...a, entities: ["light.den"] }])).status).toBe(200);
    expect((await json("/api/settings", "PUT", [1, 2])).status).toBe(200); // not an object: nothing to apply
    expect((await json("/api/sync", "PUT", { games: "x" })).status).toBe(400);
    expect((await json("/api/teams/nhl/MIN", "PUT", { primary_color_rgb: { r: 999, g: 0, b: 0 } })).status).toBe(400);
  });
});

describe("integration endpoints", () => {
  it("caps how many installs can link, and says no past the cap", async () => {
    await boot();
    for (let i = 0; i < MAX_LINKS; i++) app!.store.link(`key-${i}`);
    const r = await fetch(`${base}/integrations/home-assistant/link`, { method: "POST", headers: { authorization: "Bearer one-too-many" } });
    expect(((await r.json()) as { success: boolean }).success).toBe(false);
    const again = await fetch(`${base}/integrations/home-assistant/link`, { method: "POST", headers: { authorization: "Bearer key-0" } });
    expect(((await again.json()) as { success: boolean }).success).toBe(true); // an existing install can always re-link
  });

  it("only links the configured HOMEROOM_API_KEY when one is set", async () => {
    await boot({ haApiKey: "right" });
    const link = (k: string) => fetch(`${base}/integrations/home-assistant/link`, { method: "POST", headers: { authorization: `Bearer ${k}` } }).then((r) => r.json() as Promise<{ success: boolean }>);
    expect((await link("wrong")).success).toBe(false);
    expect((await link("right")).success).toBe(true);
  });

  it("rate-limits link attempts per client", async () => {
    await boot();
    const codes: number[] = [];
    for (let i = 0; i < 12; i++) codes.push((await fetch(`${base}/integrations/home-assistant/link`, { method: "POST", headers: { authorization: `Bearer k${i}` } })).status);
    expect(codes.slice(0, 10).every((c) => c === 200)).toBe(true);
    expect(codes.slice(10)).toEqual([429, 429]);
  });
});

describe("admin token", () => {
  it("locks a client out after repeated wrong tokens", async () => {
    await boot({ adminToken: "tok" });
    const bad = () => json("/api/trigger", "POST", { trigger: "goal" }, { authorization: "Bearer nope" });
    for (let i = 0; i < 20; i++) expect((await bad()).status).toBe(401);
    expect((await bad()).status).toBe(429);
    expect((await json("/api/trigger", "POST", { trigger: "goal" }, { authorization: "Bearer tok" })).status).toBe(429); // blocked until the window passes
  });

  it("is reported on the dashboard when it is missing", async () => {
    await boot();
    const st = (await (await fetch(`${base}/api/status`)).json()) as { warnings: string[] };
    expect(st.warnings.join(" ")).toMatch(/ADMIN_TOKEN is not set/);
    await app!.close();
    await boot({ adminToken: "tok", haApiKey: "k", appSecret: "not-the-default" });
    const quiet = (await (await fetch(`${base}/api/status`)).json()) as { warnings: string[] };
    expect(quiet.warnings.join(" ")).not.toMatch(/ADMIN_TOKEN|HOMEROOM_API_KEY|PUSHER_APP_SECRET/);
  });
});

describe("websockets", () => {
  async function closeCodeAfter(path: string, send: Buffer | string): Promise<number> {
    return new Promise((resolve) => {
      const ws = new WebSocket(`ws://127.0.0.1:${app!.port}${path}`);
      ws.on("open", () => ws.send(send));
      ws.on("close", (code) => resolve(code));
      ws.on("error", () => undefined);
    });
  }

  it("closes a connection that sends an oversized frame (1009) instead of buffering it", async () => {
    await boot();
    expect(await closeCodeAfter("/app/k", Buffer.alloc(64 * 1024, 0x61))).toBe(1009);
    expect(await closeCodeAfter("/ws", Buffer.alloc(64 * 1024, 0x61))).toBe(1009);
  });
});

describe("helpers", () => {
  it("safeEq compares like === without throwing on different lengths", () => {
    expect(safeEq("abc", "abc")).toBe(true);
    expect(safeEq("abc", "abd")).toBe(false);
    expect(safeEq("abc", "abcd")).toBe(false);
    expect(safeEq(undefined, "abc")).toBe(false);
    expect(safeEq("abc", undefined)).toBe(false);
  });

  it("isCrossSite", () => {
    expect(isCrossSite({ host: "h:1" })).toBe(false);
    expect(isCrossSite({ host: "h:1", origin: "http://h:1" })).toBe(false);
    expect(isCrossSite({ host: "h:1", origin: "http://other" })).toBe(true);
    expect(isCrossSite({ host: "h:1", origin: "null" })).toBe(true);
    expect(isCrossSite({ host: "h:1", "sec-fetch-site": "cross-site" })).toBe(true);
    expect(isCrossSite({ host: "h:1", "sec-fetch-site": "same-origin" })).toBe(false);
    expect(isCrossSite({ host: "h:1", origin: "http://dev:5173" }, ["dev:5173"])).toBe(false);
  });

  it("RateLimiter counts per key and resets after the window", () => {
    let t = 0;
    const rl = new RateLimiter(2, 1000, () => t);
    expect([rl.allow("a"), rl.allow("a"), rl.allow("a")]).toEqual([true, true, false]);
    expect(rl.blocked("a")).toBe(true);
    expect(rl.allow("b")).toBe(true);
    t = 1001;
    expect(rl.blocked("a")).toBe(false);
    expect(rl.allow("a")).toBe(true);
  });

  it("errMsg handles things that are not Errors", () => {
    expect(errMsg(new Error("boom"))).toBe("boom");
    expect(errMsg("plain")).toBe("plain");
    expect(errMsg({ code: 7 })).toBe('{"code":7}');
    expect(errMsg(undefined)).toBe("undefined");
  });

  it("loadConfig treats blank variables as unset and rejects nonsense", () => {
    const c = loadConfig({ ADMIN_TOKEN: "", PORT: "", HOMEROOM_ALLOWED_ORIGINS: " Dev:5173 , ,b:1" });
    expect(c).toMatchObject({ adminToken: undefined, port: 8080, allowedOrigins: ["dev:5173", "b:1"] });
    expect(() => loadConfig({ PORT: "eighty" })).toThrow(/invalid environment: PORT/);
    expect(() => loadConfig({ LOG_LEVEL: "loud" })).toThrow(/LOG_LEVEL/);
    expect(securityNotes(loadConfig({}))).toHaveLength(3);
  });
});
