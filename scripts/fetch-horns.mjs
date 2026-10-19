#!/usr/bin/env node
// Download goal horns listed in a manifest into ./media/horns/<league>/<ABBR>.mp3
//
//   node scripts/fetch-horns.mjs [manifest.json] [--out media/horns] [--league nhl[,nfl]] [--force] [--dry-run]
//
//   --dry-run   verify every URL/file (status, type, size, duration) and print a report; writes nothing
//   --league    only these leagues (comma separated or repeated)
//   --force     overwrite files that already exist (default: never overwrite)
//   --delay ms  minimum gap between requests to the same host (default 1000)
//
// Manifest: { "nhl": { "MIN": "https://example.com/min.mp3", "TOR": "./my-horns/tor.mp3", "default": "…" }, "nfl": { … } }
// Values are http(s) URLs or local file paths (relative to the manifest). Keys starting with "_" are comments.
// Homeroom does NOT ship horn audio: most team horns are copyrighted. See docs/HORNS.md for where the
// bundled manifest's files come from and the personal-use caveats. MP3 only (no ffmpeg in this project).
import fs from "node:fs";
import path from "node:path";
import { validateAudio, MAX_BYTES } from "./horn-validate.mjs";

const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const vals = (n) => args.flatMap((a, i) => (a === n && args[i + 1] ? args[i + 1].split(",") : []));
const val = (n, d) => (args.includes(n) ? args[args.indexOf(n) + 1] : d);
const valueFlags = new Set(["--out", "--league", "--delay"]);
const manifestPath = args.find((a, i) => !a.startsWith("--") && !valueFlags.has(args[i - 1])) ?? "horns.manifest.json";
const outDir = val("--out", "media/horns");
const dryRun = flag("--dry-run");
const force = flag("--force");
const only = new Set(vals("--league").map((s) => s.toLowerCase()));
const delayMs = Number(val("--delay", 1000));
const LEAGUES = new Set(["nhl", "nfl", "nba", "mlb", "mls", "epl", "laliga", "bundesliga", "ucl", "wnba", "ncaaf", "ncaah"]);
const UA = "Homeroom-fetch-horns/1.0 (personal-use home automation; +https://github.com/zbergus/homeroom)";
const HEAD_BYTES = 16 * 1024;

if (!fs.existsSync(manifestPath)) {
  console.error(`No manifest at ${manifestPath}. Copy horns.manifest.example.json and fill in URLs.`);
  process.exit(1);
}
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Per-host politeness: at most one request per `delayMs` per host.
const lastHit = new Map();
async function polite(url) {
  const host = new URL(url).host;
  const wait = (lastHit.get(host) ?? 0) + delayMs - Date.now();
  lastHit.set(host, Math.max(Date.now(), Date.now() + wait));
  if (wait > 0) await sleep(wait);
}

/** GET with redirects, UA, timeout and one retry. `headOnly` asks for the first bytes and stops reading. */
async function get(url, headOnly) {
  let lastErr;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await polite(url);
      const res = await fetch(url, {
        redirect: "follow",
        headers: { "User-Agent": UA, Accept: "audio/mpeg,audio/*;q=0.9,*/*;q=0.5", ...(headOnly ? { Range: `bytes=0-${HEAD_BYTES - 1}` } : {}) },
        signal: AbortSignal.timeout(45000),
      });
      if (res.status >= 500 && attempt === 0) { await res.body?.cancel(); lastErr = new Error(`HTTP ${res.status}`); await sleep(1500); continue; }
      if (!res.ok) { await res.body?.cancel(); throw new Error(`HTTP ${res.status}`); }
      const contentType = res.headers.get("content-type") ?? "";
      const range = /\/(\d+)$/.exec(res.headers.get("content-range") ?? "");
      let total = range ? Number(range[1]) : Number(res.headers.get("content-length")) || undefined;
      let buf;
      if (headOnly) {
        const chunks = []; let n = 0;
        for await (const c of res.body) { chunks.push(c); n += c.length; if (n >= HEAD_BYTES) break; }
        await res.body.cancel().catch(() => {});
        buf = Buffer.concat(chunks).subarray(0, HEAD_BYTES);
      } else {
        const declared = Number(res.headers.get("content-length"));
        if (declared > MAX_BYTES) { await res.body?.cancel(); throw new Error(`too large (${(declared / 1048576).toFixed(1)} MB, max 8 MB)`); }
        buf = Buffer.from(await res.arrayBuffer());
        total = buf.length;
      }
      return { buf, contentType, total: total ?? buf.length, finalUrl: res.url };
    } catch (e) {
      lastErr = e;
      if (attempt === 0 && !/HTTP 4\d\d|too large/.test(e.message)) { await sleep(1500); continue; }
      break;
    }
  }
  throw lastErr;
}

async function load(url, headOnly) {
  if (/^https?:\/\//i.test(url)) return get(url, headOnly);
  const buf = fs.readFileSync(path.resolve(path.dirname(manifestPath), url)); // local file, relative to the manifest
  return { buf, contentType: "", total: buf.length };
}

function writeAtomic(dest, buf) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const tmp = `${dest}.${process.pid}.tmp`;
  try { fs.writeFileSync(tmp, buf); fs.renameSync(tmp, dest); } finally { fs.rmSync(tmp, { force: true }); }
}

const rows = [];
let ok = 0, skipped = 0, failed = 0, long = 0;
for (const [league, teams] of Object.entries(manifest)) {
  if (league.startsWith("_")) continue;
  if (!LEAGUES.has(league)) { console.warn(`! unknown league "${league}" skipped`); continue; }
  if (only.size && !only.has(league)) continue;
  for (const [abbr, url] of Object.entries(teams)) {
    if (!url || abbr.startsWith("_")) continue;
    const name = abbr.toLowerCase() === "default" ? "default" : abbr.toUpperCase();
    const label = `${league}/${name}`;
    if (!/^[A-Za-z0-9]{1,8}$/.test(name)) { console.warn(`! bad abbreviation "${abbr}"`); failed++; continue; }
    const dest = path.join(outDir, league, `${name}.mp3`);
    if (!dryRun && fs.existsSync(dest) && !force) { console.log(`- ${label} already present (use --force to replace)`); skipped++; continue; }
    try {
      const { buf, contentType, total } = await load(url, dryRun);
      const v = validateAudio(buf, { contentType, totalBytes: total });
      if (!v.ok) throw new Error(v.reason);
      const dur = v.duration == null ? "?" : `${v.duration.toFixed(1)}s`;
      const note = v.warnings.length ? `  [${v.warnings.join("; ")}]` : "";
      if (v.long) long++;
      if (dryRun) console.log(`✓ ${label.padEnd(12)} ${(total / 1024).toFixed(0).padStart(5)} KB ${dur.padStart(7)}${note}`);
      else { writeAtomic(dest, buf); console.log(`✓ ${label}.mp3 (${(total / 1024).toFixed(0)} KB, ${dur})${note}`); }
      rows.push({ label, ok: true }); ok++;
    } catch (e) {
      console.error(`✗ ${label}: ${e.message}`);
      rows.push({ label, ok: false }); failed++;
    }
  }
}
const per = {};
for (const r of rows) { const l = r.label.split("/")[0]; (per[l] ??= { ok: 0, bad: 0 })[r.ok ? "ok" : "bad"]++; }
console.log(`\n${dryRun ? "dry run (nothing written)" : "done"}: ${ok} ${dryRun ? "verified" : "downloaded"}, ${skipped} already present, ${failed} failed, ${long} long (>40s)`);
if (Object.keys(per).length) console.log(Object.entries(per).map(([l, c]) => `  ${l}: ${c.ok} ok${c.bad ? `, ${c.bad} failed` : ""}`).join("\n"));
process.exit(failed ? 1 : 0);
