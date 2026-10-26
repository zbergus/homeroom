import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp, type App } from "../src/app.js";
import { cacheKey, ffmpegArgs, HornService, hornWarnings, planHorn, type HornProcSettings, type Runner } from "../src/audio/horns.js";
import { frameAt, mp3DurationS, parseMp3, truncateMp3 } from "../src/audio/mp3.js";
import { MEDIA_DIR, Store } from "../src/store.js";
import type { Game, Team } from "../src/types.js";

// ---- synthetic MPEG-1 Layer III, 128 kbps, 44.1 kHz, stereo, zero payload ----
const FRAME_S = 1152 / 44100;
/** n frames; 44.1 kHz/128k frames are 417 or 418 bytes (padding) so the average matches the real bitrate */
function frames(n: number, startAt = 0): Buffer {
  const parts: Buffer[] = [];
  let acc = 0;
  for (let i = startAt; i < startAt + n; i++) {
    acc += 0.96; // 144*128000/44100 = 417.959...
    const pad = acc >= 1 ? 1 : 0;
    if (pad) acc -= 1;
    const f = Buffer.alloc(417 + pad);
    f.set([0xff, 0xfb, pad ? 0x92 : 0x90, 0x04]);
    parts.push(f);
  }
  return Buffer.concat(parts);
}
const mp3Of = (seconds: number) => frames(Math.ceil(seconds / FRAME_S));
/** a Xing/Info metadata frame: a normal frame with the tag at the stereo MPEG-1 offset (4 + 32) */
function infoFrame(tag = "Info"): Buffer {
  const f = frames(1);
  f.write(tag, 36, "latin1");
  return f;
}
function id3v2(payload = 100): Buffer {
  const h = Buffer.alloc(10 + payload);
  h.write("ID3", 0, "latin1");
  h[3] = 3;
  h[8] = payload >> 7;
  h[9] = payload & 0x7f;
  return h;
}

describe("mp3 reader", () => {
  it("parses frame headers", () => {
    const f = frameAt(frames(2), 0)!;
    expect(f.size).toBe(417);
    expect(f.samples).toBe(1152);
    expect(f.sampleRate).toBe(44100);
    expect(frameAt(Buffer.from([0xff, 0xfb, 0x00, 0x04]), 0)).toBeUndefined(); // free format
    expect(frameAt(Buffer.from([0xff, 0xfd, 0x90, 0x04]), 0)).toBeUndefined(); // Layer II
    expect(frameAt(Buffer.alloc(3), 0)).toBeUndefined();
  });

  it("measures duration, with an ID3v2 prefix and trailing junk", () => {
    const body = mp3Of(10);
    expect(mp3DurationS(body)).toBeCloseTo(10, 1);
    expect(mp3DurationS(Buffer.concat([id3v2(), body]))).toBeCloseTo(mp3DurationS(body)!, 6);
    expect(mp3DurationS(Buffer.concat([body, Buffer.from("TAGjunk-that-is-not-audio".padEnd(128, "x"))]))).toBeCloseTo(mp3DurationS(body)!, 6);
  });

  it("does not count a Xing/Info metadata frame as audio", () => {
    const body = mp3Of(4);
    const withInfo = Buffer.concat([infoFrame(), body]);
    const info = parseMp3(withInfo)!;
    expect(info.hadVbrHeader).toBe(true);
    expect(info.durationS).toBeCloseTo(mp3DurationS(body)!, 6);
    expect(parseMp3(Buffer.concat([infoFrame("Xing"), body]))!.hadVbrHeader).toBe(true);
  });

  it("returns undefined for garbage and never throws", () => {
    expect(mp3DurationS(Buffer.alloc(0))).toBeUndefined();
    expect(mp3DurationS(Buffer.from("this is definitely not an mp3 file".repeat(50)))).toBeUndefined();
    expect(truncateMp3(Buffer.alloc(2000), 5)).toBeUndefined();
  });

  it("truncates on a frame boundary and drops ID3, Info frame and trailing junk", () => {
    const src = Buffer.concat([id3v2(), infoFrame(), mp3Of(10), Buffer.alloc(300, 0x20)]);
    const cut = truncateMp3(src, 3)!;
    expect(cut.durationS).toBeLessThanOrEqual(3);
    expect(cut.durationS).toBeGreaterThan(3 - FRAME_S - 1e-6);
    const again = parseMp3(cut.data)!;
    expect(again.hadVbrHeader).toBe(false);
    expect(again.durationS).toBeCloseTo(cut.durationS, 6);
    expect(cut.data[0]).toBe(0xff); // starts on a frame, not on the ID3 tag
    // every byte belongs to a whole frame
    expect(again.frames.reduce((n, f) => n + f.size, 0)).toBe(cut.data.length);
  });

  it("a limit longer than the clip keeps all audio", () => {
    const cut = truncateMp3(mp3Of(2), 60)!;
    expect(cut.durationS).toBeCloseTo(2, 1);
  });
});

const S = (over: Partial<HornProcSettings> = {}): HornProcSettings => ({ horn_max_s: 30, horn_fade_ms: 1500, horn_normalize: false, ...over });

describe("planHorn / cacheKey / ffmpeg args", () => {
  it("leaves short clips and unparseable files alone", () => {
    expect(planHorn(3, S(), "ffmpeg")).toBeNull();
    expect(planHorn(30, S(), "ffmpeg")).toBeNull(); // exactly at the limit
    expect(planHorn(undefined, S(), "ffmpeg")).toBeNull();
    expect(planHorn(55, S({ horn_max_s: null }), "ffmpeg")).toBeNull(); // no limit
  });
  it("trims long clips; fade only with ffmpeg and a non-zero fade", () => {
    expect(planHorn(55, S(), "ffmpeg")).toEqual({ trim: true, normalize: false, fade: true });
    expect(planHorn(55, S(), "truncate-only")).toEqual({ trim: true, normalize: false, fade: false });
    expect(planHorn(55, S({ horn_fade_ms: 0 }), "ffmpeg")).toEqual({ trim: true, normalize: false, fade: false });
  });
  it("normalise needs ffmpeg and also processes short clips, without a fade", () => {
    expect(planHorn(3, S({ horn_normalize: true }), "ffmpeg")).toEqual({ trim: false, normalize: true, fade: false });
    expect(planHorn(3, S({ horn_normalize: true }), "truncate-only")).toBeNull();
  });
  it("cache key changes with every input that changes the output", () => {
    const base = { src: "/m/horns/nhl/STL.mp3", mtimeMs: 1, size: 100, mode: "ffmpeg" as const, s: S() };
    const k = cacheKey(base);
    expect(cacheKey({ ...base })).toBe(k);
    for (const alt of [{ src: "/m/horns/nhl/SEA.mp3" }, { mtimeMs: 2 }, { size: 101 }, { mode: "truncate-only" as const }, { s: S({ horn_max_s: 20 }) }, { s: S({ horn_fade_ms: 0 }) }, { s: S({ horn_normalize: true }) }]) {
      expect(cacheKey({ ...base, ...alt })).not.toBe(k);
    }
  });
  it("ffmpeg args: an array (no shell), -t before -i, fade ends at the cut, loudnorm optional", () => {
    const a = ffmpegArgs("/in file; rm -rf.mp3", "/out.mp3", S({ horn_max_s: 12, horn_fade_ms: 2000 }), { trim: true, normalize: false, fade: true });
    expect(a).toContain("/in file; rm -rf.mp3"); // one argv element, never interpolated
    expect(a.indexOf("-t")).toBeLessThan(a.indexOf("-i"));
    expect(a[a.indexOf("-t") + 1]).toBe("12");
    expect(a[a.indexOf("-af") + 1]).toBe("afade=t=out:st=10.000:d=2.000");
    expect(a[a.length - 1]).toBe("/out.mp3");
    const n = ffmpegArgs("/i.mp3", "/o.mp3", S({ horn_max_s: null, horn_normalize: true }), { trim: false, normalize: true, fade: false });
    expect(n).not.toContain("-t");
    expect(n[n.indexOf("-af") + 1]).toContain("loudnorm");
  });
  it("a fade never exceeds half the clip", () => {
    const a = ffmpegArgs("/i", "/o", S({ horn_max_s: 2, horn_fade_ms: 5000 }), { trim: true, normalize: false, fade: true });
    expect(a[a.indexOf("-af") + 1]).toBe("afade=t=out:st=1.000:d=1.000");
  });
  it("warnings mention the limit and how the cut sounds", () => {
    expect(hornWarnings([3, 55], S(), "ffmpeg")[0]).toMatch(/1 horn longer than 30s.*1500 ms fade/);
    expect(hornWarnings([55], S(), "truncate-only")[0]).toMatch(/abruptly/);
    expect(hornWarnings([3], S(), "ffmpeg")).toEqual([]);
    expect(hornWarnings([50], S({ horn_max_s: null }), "ffmpeg")[0]).toMatch(/limit is off/);
  });
});

// ---- service + HTTP route with an injected runner (no ffmpeg needed) ----
const FAKE_OUT = Buffer.concat([mp3Of(2), Buffer.from("fake-ffmpeg-output")]);
let app: App;
let base: string;
let cache: string;
let calls: string[][];
let settings: HornProcSettings;
let failProcessing = false;
let ffmpegPresent = true;
const written: string[] = [];

const fakeRunner: Runner = async (_file, args) => {
  calls.push(args);
  if (args[0] === "-version") {
    if (!ffmpegPresent) throw new Error("spawn ffmpeg ENOENT");
    return;
  }
  if (failProcessing) throw new Error("ffmpeg exploded");
  fs.writeFileSync(args[args.length - 1], FAKE_OUT);
};

function putHorn(abbr: string, data: Buffer, league = "nhl"): string {
  const f = path.join(MEDIA_DIR, "horns", league, `${abbr}.mp3`);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, data);
  written.push(f);
  return f;
}

beforeEach(async () => {
  cache = fs.mkdtempSync(path.join(os.tmpdir(), "hr-horn-cache-"));
  calls = [];
  settings = S({ horn_max_s: 5 });
  failProcessing = false;
  ffmpegPresent = true;
  const horns = new HornService({ mediaDir: MEDIA_DIR, cacheDir: cache, settings: () => settings, runner: fakeRunner, log: () => {} });
  app = await createApp({ store: new Store(":memory:"), webDir: "/nonexistent", port: 0, horns });
  base = `http://127.0.0.1:${app.port}`;
});
afterEach(async () => {
  await app.close();
  for (const f of written.splice(0)) fs.rmSync(f, { force: true });
  fs.rmSync(cache, { recursive: true, force: true });
});

const get = (p: string, headers: Record<string, string> = {}) => fetch(base + p, { headers });
const bytes = async (r: Response) => Buffer.from(await r.arrayBuffer());

describe("/media/horns route", () => {
  it("serves a short clip byte-for-byte and never calls ffmpeg to process it", async () => {
    const orig = mp3Of(3);
    putHorn("ZZSHORT", orig);
    const r = await get("/media/horns/nhl/ZZSHORT.mp3");
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toBe("audio/mpeg");
    expect(r.headers.get("accept-ranges")).toBe("bytes");
    expect((await bytes(r)).equals(orig)).toBe(true);
    expect(calls.filter((c) => c[0] !== "-version")).toHaveLength(0);
  });

  it("serves the processed variant of a long clip, caches it, and leaves the original untouched", async () => {
    const orig = mp3Of(20);
    const file = putHorn("ZZLONG", orig);
    const r = await get("/media/horns/nhl/ZZLONG.mp3");
    expect(r.status).toBe(200);
    expect((await bytes(r)).equals(FAKE_OUT)).toBe(true);
    const run = calls.filter((c) => c[0] !== "-version");
    expect(run).toHaveLength(1);
    expect(run[0]).toContain(file);
    expect(run[0][run[0].indexOf("-t") + 1]).toBe("5");
    await get("/media/horns/nhl/ZZLONG.mp3");
    expect(calls.filter((c) => c[0] !== "-version")).toHaveLength(1); // cached
    expect(fs.readFileSync(file).equals(orig)).toBe(true);
    expect(fs.readdirSync(cache).filter((f) => f.includes(".tmp-"))).toHaveLength(0);
  });

  it("rebuilds a cached variant that disappeared instead of failing", async () => {
    putHorn("ZZLONG", mp3Of(20));
    await get("/media/horns/nhl/ZZLONG.mp3");
    for (const f of fs.readdirSync(cache)) fs.rmSync(path.join(cache, f));
    const r = await get("/media/horns/nhl/ZZLONG.mp3");
    expect(r.status).toBe(200);
    expect((await bytes(r)).equals(FAKE_OUT)).toBe(true);
    expect(calls.filter((c) => c[0] !== "-version")).toHaveLength(2);
  });

  it("a changed setting builds a new variant and drops the stale one", async () => {
    putHorn("ZZLONG", mp3Of(20));
    await get("/media/horns/nhl/ZZLONG.mp3");
    const first = fs.readdirSync(cache);
    settings = S({ horn_max_s: 8 });
    await get("/media/horns/nhl/ZZLONG.mp3");
    const second = fs.readdirSync(cache);
    expect(second).toHaveLength(1);
    expect(second[0]).not.toBe(first[0]);
  });

  it("supports Range (206/416) and conditional GET on a processed file", async () => {
    putHorn("ZZLONG", mp3Of(20));
    const size = FAKE_OUT.length;
    const part = await get("/media/horns/nhl/ZZLONG.mp3", { Range: "bytes=10-19" });
    expect(part.status).toBe(206);
    expect(part.headers.get("content-range")).toBe(`bytes 10-19/${size}`);
    expect((await bytes(part)).equals(FAKE_OUT.subarray(10, 20))).toBe(true);
    const open = await get("/media/horns/nhl/ZZLONG.mp3", { Range: "bytes=100-" });
    expect(open.status).toBe(206);
    expect((await bytes(open)).length).toBe(size - 100);
    const tail = await get("/media/horns/nhl/ZZLONG.mp3", { Range: "bytes=-5" });
    expect((await bytes(tail)).equals(FAKE_OUT.subarray(size - 5))).toBe(true);
    const bad = await get("/media/horns/nhl/ZZLONG.mp3", { Range: `bytes=${size + 10}-` });
    expect(bad.status).toBe(416);
    expect(bad.headers.get("content-range")).toBe(`bytes */${size}`);
    const full = await get("/media/horns/nhl/ZZLONG.mp3");
    const etag = full.headers.get("etag")!;
    expect((await get("/media/horns/nhl/ZZLONG.mp3", { "If-None-Match": etag })).status).toBe(304);
  });

  it("Range works on an unprocessed original too", async () => {
    const orig = mp3Of(3);
    putHorn("ZZSHORT", orig);
    const r = await get("/media/horns/nhl/ZZSHORT.mp3", { Range: "bytes=0-99" });
    expect(r.status).toBe(206);
    expect((await bytes(r)).equals(orig.subarray(0, 100))).toBe(true);
  });

  it("falls back to the original bytes when processing fails, and does not retry every request", async () => {
    const orig = mp3Of(20);
    putHorn("ZZLONG", orig);
    failProcessing = true;
    for (let i = 0; i < 3; i++) {
      const r = await get("/media/horns/nhl/ZZLONG.mp3");
      expect(r.status).toBe(200);
      expect((await bytes(r)).equals(orig)).toBe(true);
    }
    expect(calls.filter((c) => c[0] !== "-version")).toHaveLength(1);
    expect(fs.readdirSync(cache)).toHaveLength(0);
  });

  it("without ffmpeg it cuts on a frame boundary (no fade) and the result is a valid shorter MP3", async () => {
    ffmpegPresent = false;
    const orig = Buffer.concat([id3v2(), infoFrame(), mp3Of(20)]);
    putHorn("ZZLONG", orig);
    const r = await get("/media/horns/nhl/ZZLONG.mp3");
    const body = await bytes(r);
    const info = parseMp3(body)!;
    expect(info.durationS).toBeLessThanOrEqual(5);
    expect(info.durationS).toBeGreaterThan(5 - FRAME_S - 1e-6);
    expect(body.length).toBeLessThan(orig.length);
    expect(calls.filter((c) => c[0] !== "-version")).toHaveLength(0);
  });

  it("an unparseable file is served as is", async () => {
    const junk = Buffer.from("ID3-not-really".repeat(100));
    putHorn("ZZJUNK", junk);
    const r = await get("/media/horns/nhl/ZZJUNK.mp3");
    expect(r.status).toBe(200);
    expect((await bytes(r)).equals(junk)).toBe(true);
  });

  it("404s for a missing file, an unknown league, and traversal attempts", async () => {
    expect((await get("/media/horns/nhl/ZZNONE.mp3")).status).toBe(404);
    expect((await get("/media/horns/quidditch/default.mp3")).status).toBe(404);
    expect((await get("/media/horns/nhl/..%2F..%2Fsecret.mp3")).status).toBe(404);
    expect((await get("/media/horns/nhl/a.b.mp3")).status).toBe(404);
  });

  it("HEAD works", async () => {
    putHorn("ZZSHORT", mp3Of(3));
    const r = await fetch(`${base}/media/horns/nhl/ZZSHORT.mp3`, { method: "HEAD" });
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toBe("audio/mpeg");
  });

  it("/api/horns reports duration and trimming; /api/status reports the audio mode and warnings", async () => {
    putHorn("ZZLONG", mp3Of(20));
    putHorn("ZZSHORT", mp3Of(3));
    app.store.patchSettings({ horn_max_s: 5 }); // status warnings read the store; the service reads `settings`
    app.engine.invalidateSettings();
    const list = (await (await get("/api/horns")).json()) as { abbr: string; duration_s: number | null; processed: boolean; trimmed: boolean }[];
    const long = list.find((h) => h.abbr === "ZZLONG")!;
    const short = list.find((h) => h.abbr === "ZZSHORT")!;
    expect(long).toMatchObject({ processed: true, trimmed: true });
    expect(long.duration_s).toBeCloseTo(20, 0);
    expect(short).toMatchObject({ processed: false, trimmed: false });
    const st = (await (await get("/api/status")).json()) as { audio: { ffmpeg: boolean; mode: string }; warnings: string[] };
    expect(st.audio).toEqual({ ffmpeg: true, mode: "ffmpeg" });
    expect(st.warnings.some((w) => /longer than 5s will be cut off/.test(w))).toBe(true);
  });
});

describe("HornService.warm", () => {
  it("pre-builds only the horns that need processing", async () => {
    putHorn("ZZLONG", mp3Of(20));
    putHorn("ZZSHORT", mp3Of(3));
    const svc = new HornService({ mediaDir: MEDIA_DIR, cacheDir: cache, settings: () => settings, runner: fakeRunner, log: () => {} });
    await svc.warm([{ league: "nhl", abbr: "ZZLONG" }, { league: "nhl", abbr: "ZZSHORT" }, { league: "nhl", abbr: "ZZGONE" }]);
    expect(fs.readdirSync(cache)).toHaveLength(1);
  });
});

describe("settings: horn_max_s / horn_fade_ms / horn_normalize / horn_scope", () => {
  it("defaults", () => {
    expect(new Store(":memory:").getSettings()).toMatchObject({ horn_max_s: 30, horn_fade_ms: 1500, horn_normalize: false, horn_scope: "favorites" });
  });
  it("validates", () => {
    const s = new Store(":memory:");
    expect(s.patchSettings({ horn_max_s: 1 })).toMatch(/horn_max_s/);
    expect(s.patchSettings({ horn_max_s: 121 })).toMatch(/horn_max_s/);
    expect(s.patchSettings({ horn_max_s: "30" as never })).toMatch(/horn_max_s/);
    expect(s.patchSettings({ horn_max_s: NaN })).toMatch(/horn_max_s/);
    expect(s.patchSettings({ horn_fade_ms: -1 })).toMatch(/horn_fade_ms/);
    expect(s.patchSettings({ horn_fade_ms: 5001 })).toMatch(/horn_fade_ms/);
    expect(s.patchSettings({ horn_normalize: "yes" as never })).toMatch(/horn_normalize/);
    expect(s.patchSettings({ horn_scope: "away" as never })).toMatch(/horn_scope/);
    expect(s.getSettings().horn_max_s).toBe(30); // nothing was applied
    expect(s.patchSettings({ horn_max_s: null, horn_fade_ms: 0, horn_normalize: true, horn_scope: "home" })).toBeUndefined();
    expect(s.getSettings()).toMatchObject({ horn_max_s: null, horn_fade_ms: 0, horn_normalize: true, horn_scope: "home" });
    expect(s.patchSettings({ horn_max_s: 2 })).toBeUndefined();
    expect(s.patchSettings({ horn_max_s: 120 })).toBeUndefined();
  });
  it("is reachable through PUT /api/settings with a 400 on bad input", async () => {
    const bad = await fetch(`${base}/api/settings`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ horn_max_s: 500 }) });
    expect(bad.status).toBe(400);
    const ok = await fetch(`${base}/api/settings`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ horn_max_s: 12 }) });
    expect(((await ok.json()) as { horn_max_s: number }).horn_max_s).toBe(12);
  });
});

describe('horn_scope "home"', () => {
  const team = (abbr: string) => ({ abbr }) as Team;
  const game = { league: "nhl", home: team("ZZH"), away: team("ZZA") } as Game;
  it("plays a horn for the home team only", () => {
    putHorn("ZZH", mp3Of(3));
    putHorn("ZZA", mp3Of(3));
    app.store.patchSettings({ public_base_url: "http://192.168.1.5:8080", horn_scope: "home" });
    app.engine.invalidateSettings();
    expect(app.engine.hornUrl(game, game.home)).toBe("http://192.168.1.5:8080/media/horns/nhl/ZZH.mp3");
    expect(app.engine.hornUrl(game, game.away)).toBeUndefined();
    app.store.patchSettings({ horn_scope: "all" });
    app.engine.invalidateSettings();
    expect(app.engine.hornUrl(game, game.away)).toBe("http://192.168.1.5:8080/media/horns/nhl/ZZA.mp3");
  });
});
