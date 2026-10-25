import fs from "node:fs";
import path from "node:path";
import multipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { MEDIA_DIR, Store } from "../src/store.js";
import { celebrationRoutes, isPrivateHost, MAX_CELEBRATION_BYTES, resolveCelebrationUrl } from "../src/video/celebrations.js";

const mediaDir = path.join(MEDIA_DIR, "celebrations-test");
const library = path.join(mediaDir, "celebrations");
const target = path.join(library, "nhl", "MIN", "nhl:8483525.mp4");
const api = "/api/celebrations/nhl/MIN/nhl%3A8483525";
const media = "/media/celebrations/nhl/MIN/nhl%3A8483525.mp4";
const mp4 = Buffer.from("000000186674797069736f6d0000020069736f6d6d703432000000086d646174", "hex");
const boundary = "homeroom-celebration-test";
const headers = { "content-type": `multipart/form-data; boundary=${boundary}` };
function form(data: Buffer, filename = "celebration.mp4", type = "video/mp4", complete = true): Buffer {
  return Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${type}\r\n\r\n`),
    data, Buffer.from(complete ? `\r\n--${boundary}--\r\n` : ""),
  ]);
}

let app: FastifyInstance;
beforeEach(async () => {
  fs.mkdirSync(mediaDir, { recursive: true });
  app = Fastify();
  await app.register(multipart, { limits: { fileSize: 10 * 1024 * 1024, files: 1 } });
  await app.register(celebrationRoutes, { mediaDir });
  // Production's generic media and web static registrations must not shadow these routes.
  await app.register(fastifyStatic, { root: mediaDir, prefix: "/media/", decorateReply: false, index: false });
  const web = path.join(mediaDir, "web");
  fs.mkdirSync(web, { recursive: true });
  fs.writeFileSync(path.join(web, "index.html"), "web");
  await app.register(fastifyStatic, { root: web, prefix: "/", wildcard: false });
  await app.ready();
});
afterEach(async () => {
  await app.close();
  fs.rmSync(mediaDir, { recursive: true, force: true });
});
const upload = (data = mp4, url = api, filename = "celebration.mp4", type = "video/mp4") =>
  app.inject({ method: "POST", url, headers, payload: form(data, filename, type) });

describe("local celebration library", () => {
  it("lists dynamic uploads with encoded URLs, streams GET/HEAD/ranges, replaces and deletes idempotently", async () => {
    expect((await app.inject("/api/celebrations")).json()).toEqual([]);
    expect((await upload()).statusCode).toBe(200);
    expect((await app.inject("/api/celebrations")).json()).toEqual([{ league: "nhl", abbr: "MIN", player_id: "nhl:8483525", url: media }]);
    const full = await app.inject(media);
    expect(full.statusCode).toBe(200);
    expect(full.headers["content-type"]).toBe("video/mp4");
    expect(full.rawPayload).toEqual(mp4);
    expect(full.headers["accept-ranges"]).toBe("bytes");
    const head = await app.inject({ method: "HEAD", url: media });
    expect(head.headers["content-length"]).toBe(String(mp4.length));
    expect(head.body).toBe("");
    const ranged = await app.inject({ url: media, headers: { range: "bytes=4-11" } });
    expect(ranged.statusCode).toBe(206);
    expect(ranged.headers["content-range"]).toBe(`bytes 4-11/${mp4.length}`);
    expect(ranged.rawPayload).toEqual(mp4.subarray(4, 12));
    expect((await app.inject({ url: media, headers: { range: "bytes=-4" } })).rawPayload).toEqual(mp4.subarray(-4));
    expect((await app.inject({ url: media, headers: { range: "bytes=9999-" } })).statusCode).toBe(416);
    expect((await app.inject({ url: media, headers: { "if-none-match": String(full.headers.etag) } })).statusCode).toBe(304);
    const replacement = Buffer.concat([mp4, Buffer.alloc(10)]);
    expect((await upload(replacement)).statusCode).toBe(200);
    expect((await app.inject(media)).rawPayload).toEqual(replacement);
    for (let i = 0; i < 2; i++) expect((await app.inject({ method: "DELETE", url: api })).statusCode).toBe(200);
    expect((await app.inject(media)).statusCode).toBe(404);
    expect((await app.inject("/api/celebrations")).json()).toEqual([]);
  });

  it("supports team default and future namespaced numeric identifiers, canonicalizing abbreviations", async () => {
    for (const id of ["default", "espn:123", "ahl:456"]) {
      expect((await upload(mp4, `/api/celebrations/nhl/min/${encodeURIComponent(id)}`)).statusCode).toBe(200);
    }
    const rows = (await app.inject("/api/celebrations")).json<{ abbr: string; player_id: string }[]>();
    expect(rows.map((r) => r.player_id).sort()).toEqual(["ahl:456", "default", "espn:123"]);
    expect(rows.every((r) => r.abbr === "MIN")).toBe(true);
  });

  it("rejects bad assignments and traversal for mutation and media", async () => {
    for (const suffix of ["bad/MIN/default", "nhl/TOOLONGABC/default", "nhl/MIN/123", "nhl/MIN/nhl:abc", "nhl/MIN/nhl:-1", "nhl/MIN/%2e%2e%2fescape", "nhl/%2e%2e/default", "nhl/MIN/default%00"]) {
      expect([400, 404]).toContain((await upload(mp4, `/api/celebrations/${suffix}`)).statusCode);
      expect([400, 404]).toContain((await app.inject({ method: "DELETE", url: `/api/celebrations/${suffix}` })).statusCode);
      expect((await app.inject(`/media/celebrations/${suffix}.mp4`)).statusCode).toBe(404);
    }
  });

  it("preserves the good assignment on wrong extension, MIME, signature, malformed/truncated multipart and extra files", async () => {
    await upload();
    for (const [data, filename, type] of [
      [mp4, "clip.webm", "video/mp4"], [mp4, "clip.mp4", "text/html"],
      [Buffer.from("not video"), "clip.mp4", "video/mp4"],
      [Buffer.from("000000186674797071742020000000007174202071742020", "hex"), "clip.mp4", "video/mp4"],
    ] as const) expect((await upload(data, api, filename, type)).statusCode).toBe(415);
    const incomplete = await app.inject({ method: "POST", url: api, headers, payload: form(mp4, "clip.mp4", "video/mp4", false) });
    expect(incomplete.statusCode).toBeGreaterThanOrEqual(400);
    const two = Buffer.concat([form(mp4).subarray(0, -(boundary.length + 6)), Buffer.from("\r\n"), form(mp4)]);
    expect((await app.inject({ method: "POST", url: api, headers, payload: two })).statusCode).toBeGreaterThanOrEqual(400);
    expect(fs.readFileSync(target)).toEqual(mp4);
    expect(fs.readdirSync(path.dirname(target))).toEqual(["nhl:8483525.mp4"]);
  });

  it("accepts above the horn limit and at 50 MiB, rejects overflow with cleanup and atomic preservation", async () => {
    const large = Buffer.alloc(MAX_CELEBRATION_BYTES);
    mp4.copy(large);
    expect((await upload(large)).statusCode).toBe(200);
    expect(fs.statSync(target).size).toBe(MAX_CELEBRATION_BYTES);
    const tooLarge = Buffer.concat([large, Buffer.alloc(1)]);
    expect((await upload(tooLarge)).statusCode).toBe(413);
    expect(fs.statSync(target).size).toBe(MAX_CELEBRATION_BYTES);
    expect(fs.readdirSync(path.dirname(target))).toEqual(["nhl:8483525.mp4"]);
  });

  it("ignores staging, malformed and symlink files and denies static fallback access", async () => {
    await upload();
    const dir = path.dirname(target);
    for (const f of [".pending.upload", "bad.mp4", "nhl:abc.mp4", "default.mp4.upload"]) fs.writeFileSync(path.join(dir, f), mp4);
    fs.writeFileSync(path.join(dir, "nhl:123.mp4"), "malformed");
    fs.symlinkSync(target, path.join(dir, "default.mp4"));
    fs.symlinkSync(dir, path.join(library, "nhl", "STL"));
    expect((await app.inject("/api/celebrations")).json()).toHaveLength(1);
    for (const f of [".pending.upload", "bad.mp4", "nhl:abc.mp4", "default.mp4.upload", "default.mp4"]) {
      expect((await app.inject(`/media/celebrations/nhl/MIN/${encodeURIComponent(f)}`)).statusCode).toBe(404);
    }
    expect((await app.inject("/media/celebrations/nhl/STL/nhl%3A8483525.mp4")).statusCode).toBe(404);
    expect((await upload(mp4, "/api/celebrations/nhl/STL/default")).statusCode).toBe(400);
    // Replacement replaces the link itself, never the file it points at.
    expect((await upload(mp4, "/api/celebrations/nhl/MIN/default")).statusCode).toBe(200);
    expect(fs.lstatSync(path.join(dir, "default.mp4")).isSymbolicLink()).toBe(false);
  });

  it("resolves Giphy URLs and enforces SSRF host protections", () => {
    expect(resolveCelebrationUrl("https://giphy.com/gifs/canadiensmtl-caufield-xyz123")).toBe("https://media.giphy.com/media/xyz123/giphy.mp4");
    expect(resolveCelebrationUrl("https://giphy.com/gifs/xyz123")).toBe("https://media.giphy.com/media/xyz123/giphy.mp4");
    expect(resolveCelebrationUrl("https://media.giphy.com/media/xyz123/giphy.gif")).toBe("https://media.giphy.com/media/xyz123/giphy.mp4");
    expect(resolveCelebrationUrl("https://example.com/goal.mp4")).toBe("https://example.com/goal.mp4");

    expect(isPrivateHost("localhost")).toBe(true);
    expect(isPrivateHost("127.0.0.1")).toBe(true);
    expect(isPrivateHost("192.168.1.50")).toBe(true);
    expect(isPrivateHost("10.0.0.1")).toBe(true);
    expect(isPrivateHost("172.20.0.1")).toBe(true);
    expect(isPrivateHost("media.giphy.com")).toBe(false);
    expect(isPrivateHost("cdn.example.com")).toBe(false);
  });

  it("imports celebration videos via URL with validation and MP4 check", async () => {
    const importUrl = "/api/celebrations/nhl/MIN/nhl%3A8483525/import";
    // Bad params
    expect((await app.inject({ method: "POST", url: "/api/celebrations/nhl/MIN/bad_id/import", payload: { url: "https://example.com/video.mp4" } })).statusCode).toBe(400);
    // Missing/invalid URL
    expect((await app.inject({ method: "POST", url: importUrl, payload: {} })).statusCode).toBe(400);
    // Private host
    expect((await app.inject({ method: "POST", url: importUrl, payload: { url: "http://127.0.0.1/video.mp4" } })).statusCode).toBe(400);
    expect((await app.inject({ method: "POST", url: importUrl, payload: { url: "http://localhost/video.mp4" } })).statusCode).toBe(400);

    // Mock global fetch to return mp4
    const originalFetch = globalThis.fetch;
    try {
      globalThis.fetch = (async (input: RequestInfo | URL) => {
        const u = String(input);
        if (u.includes("not-mp4")) {
          return new Response("not a video", { status: 200, headers: { "content-type": "video/mp4" } });
        }
        if (u.includes("not-found")) {
          return new Response("not found", { status: 404 });
        }
        return new Response(mp4, { status: 200, headers: { "content-type": "video/mp4" } });
      }) as typeof fetch;

      // 404 from upstream
      expect((await app.inject({ method: "POST", url: importUrl, payload: { url: "https://example.com/not-found.mp4" } })).statusCode).toBe(400);
      // Not MP4 content
      expect((await app.inject({ method: "POST", url: importUrl, payload: { url: "https://example.com/not-mp4.mp4" } })).statusCode).toBe(415);
      // Valid MP4 import
      const okRes = await app.inject({ method: "POST", url: importUrl, payload: { url: "https://giphy.com/gifs/test-xyz123" } });
      expect(okRes.statusCode).toBe(200);
      expect(okRes.json()).toEqual({ ok: true, size: mp4.length });

      // File was saved
      const video = await app.inject(media);
      expect(video.statusCode).toBe(200);
      expect(video.rawPayload).toEqual(mp4);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe("celebration HTTP boundary", () => {
  it("enforces admin auth, browser origin, multipart route allowlist and the unchanged 10 MiB horn cap", async () => {
    const config = { ...loadConfig({}), adminToken: "local-test-admin" };
    const whole = await createApp({ store: new Store(":memory:"), appKey: "test", appSecret: "test", webDir: path.join(mediaDir, "web"), config });
    const url = "/api/celebrations/nhl/TST/default";
    const authorized = { ...headers, authorization: ["Bearer", config.adminToken].join(" ") };
    try {
      expect((await whole.http.inject({ method: "POST", url, headers, payload: form(mp4) })).statusCode).toBe(401);
      expect((await whole.http.inject({ method: "DELETE", url })).statusCode).toBe(401);
      expect((await whole.http.inject({ method: "POST", url, headers: { ...authorized, "sec-fetch-site": "cross-site" }, payload: form(mp4) })).statusCode).toBe(403);
      expect((await whole.http.inject({ method: "DELETE", url, headers: { ...authorized, origin: "https://evil.example" } })).statusCode).toBe(403);
      expect((await whole.http.inject({ method: "POST", url: "/api/settings", headers: authorized, payload: form(mp4) })).statusCode).toBe(415);
      expect((await whole.http.inject({ method: "POST", url: `${url}/extra`, headers: authorized, payload: form(mp4) })).statusCode).toBe(415);
      expect((await whole.http.inject({ method: "POST", url, headers: authorized, payload: form(mp4) })).statusCode).toBe(200);
      const video = await whole.http.inject("/media/celebrations/nhl/TST/default.mp4");
      expect(video.headers["content-type"]).toBe("video/mp4");
      const bigHorn = Buffer.alloc(10 * 1024 * 1024 + 1);
      bigHorn.write("ID3");
      expect((await whole.http.inject({ method: "POST", url: "/api/horns/nhl/TST", headers: authorized, payload: form(bigHorn, "horn.mp3", "audio/mpeg") })).statusCode).toBe(413);
    } finally {
      await whole.close();
      fs.rmSync(path.join(MEDIA_DIR, "celebrations", "nhl", "TST"), { recursive: true, force: true });
    }
  });
});
