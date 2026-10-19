/**
 * Serves a PROCESSED variant of a horn on demand (trim to horn_max_s, fade, loudness) without ever touching the original.
 *
 * - ffmpeg on PATH: trim + afade + optional loudnorm, re-encoded to 128k/44.1 kHz MP3.
 * - otherwise: pure-JS cut on an MP3 frame boundary (no fade, no loudness).
 * Results are cached in `${DATA_DIR}/cache/horns/`, keyed by (source path, mtime, size, settings), so a changed setting or
 * replaced file simply produces a new key. Any failure falls back to the original bytes (logged once per key).
 */
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { mp3DurationS, truncateMp3 } from "./mp3.js";
import type { Settings } from "../types.js";

export type HornProcSettings = Pick<Settings, "horn_max_s" | "horn_fade_ms" | "horn_normalize">;
export type AudioMode = "ffmpeg" | "truncate-only";
export interface Plan { trim: boolean; normalize: boolean; fade: boolean }

/** What (if anything) has to be done to a clip of `durationS` seconds. null = serve the original bytes. */
export function planHorn(durationS: number | undefined, s: HornProcSettings, mode: AudioMode): Plan | null {
  if (durationS === undefined) return null;
  const trim = s.horn_max_s != null && durationS > s.horn_max_s;
  const normalize = mode === "ffmpeg" && s.horn_normalize;
  if (!trim && !normalize) return null;
  return { trim, normalize, fade: mode === "ffmpeg" && trim && s.horn_fade_ms > 0 };
}

export interface CacheKeyInput { src: string; mtimeMs: number; size: number; mode: AudioMode; s: HornProcSettings }
export function cacheKey(i: CacheKeyInput): string {
  return createHash("sha1").update(JSON.stringify([i.src, i.mtimeMs, i.size, i.mode, i.s.horn_max_s, i.s.horn_fade_ms, i.s.horn_normalize])).digest("hex").slice(0, 16);
}

export type Runner = (file: string, args: string[], timeoutMs: number) => Promise<void>;
const defaultRunner: Runner = (file, args, timeout) =>
  new Promise((resolve, reject) => execFile(file, args, { timeout, maxBuffer: 4 * 1024 * 1024 }, (err, _o, stderr) => (err ? reject(new Error(`${err.message} ${String(stderr).slice(-300)}`)) : resolve())));

export function ffmpegArgs(src: string, out: string, s: HornProcSettings, plan: Plan): string[] {
  const maxS = s.horn_max_s ?? 0;
  const filters: string[] = [];
  // -t is an INPUT option so loudnorm measures the clip that will actually play, not the whole song
  const input = plan.trim ? ["-t", String(maxS)] : [];
  if (plan.normalize) filters.push("loudnorm=I=-16:TP=-1.5:LRA=11", "aresample=44100"); // loudnorm upsamples internally
  if (plan.fade) {
    const fade = Math.min(s.horn_fade_ms / 1000, maxS / 2);
    filters.push(`afade=t=out:st=${(maxS - fade).toFixed(3)}:d=${fade.toFixed(3)}`);
  }
  return ["-hide_banner", "-nostdin", "-loglevel", "error", "-y", ...input, "-i", src, "-vn", "-map_metadata", "-1",
    ...(filters.length ? ["-af", filters.join(",")] : []),
    "-codec:a", "libmp3lame", "-b:a", "128k", "-ar", "44100", "-write_id3v2", "0", "-write_id3v1", "0", "-f", "mp3", out];
}

/** stat, not existsSync: a cache file that vanished (cleaned by hand, flaky bind mount) must be rebuilt, not served */
function cachedOk(file: string): boolean {
  try { return fs.statSync(file).size > 0; } catch { return false; }
}

export interface HornServiceOptions {
  mediaDir: string;
  cacheDir: string;
  settings: () => HornProcSettings;
  /** executable name; tests inject a runner instead of a real binary */
  ffmpegPath?: string;
  runner?: Runner;
  log?: (msg: string) => void;
  timeoutMs?: number;
}

export interface Resolved {
  /** file to send */
  file: string;
  processed: boolean;
  /** validator for HTTP caching */
  etag: string;
}

export class HornService {
  private probe?: Promise<boolean>;
  private inflight = new Map<string, Promise<string | undefined>>();
  private failed = new Set<string>();
  private durations = new Map<string, number | undefined>();
  private swept = false;
  private run: Runner;
  private ffmpeg: string;
  private log: (m: string) => void;

  constructor(private o: HornServiceOptions) {
    this.run = o.runner ?? defaultRunner;
    this.ffmpeg = o.ffmpegPath ?? "ffmpeg";
    this.log = o.log ?? ((m) => console.warn(`[horns] ${m}`));
  }

  /** `ffmpeg -version`, probed once per process. */
  ffmpegAvailable(): Promise<boolean> {
    this.probe ??= this.run(this.ffmpeg, ["-version"], 5000).then(() => true, () => false);
    return this.probe;
  }
  async mode(): Promise<AudioMode> {
    return (await this.ffmpegAvailable()) ? "ffmpeg" : "truncate-only";
  }

  sourcePath(league: string, abbr: string): string {
    return path.join(this.o.mediaDir, "horns", league, `${abbr}.mp3`);
  }

  /** Duration of a horn file (memoised on path+mtime+size). undefined when it cannot be parsed. */
  durationOf(file: string): number | undefined {
    let st: fs.Stats;
    try { st = fs.statSync(file); } catch { return undefined; }
    const k = `${file}|${st.mtimeMs}|${st.size}`;
    if (this.durations.has(k)) return this.durations.get(k);
    let d: number | undefined;
    try { d = mp3DurationS(fs.readFileSync(file)); } catch { d = undefined; }
    if (this.durations.size > 500) this.durations.clear();
    this.durations.set(k, d);
    return d;
  }

  /** Pick the file to serve for league/abbr. Never throws; the original is the fallback for everything. */
  async resolve(league: string, abbr: string): Promise<Resolved | undefined> {
    const src = this.sourcePath(league, abbr);
    let st: fs.Stats;
    try { st = fs.statSync(src); } catch { return undefined; }
    const original: Resolved = { file: src, processed: false, etag: `W/"${st.size}-${Math.round(st.mtimeMs)}"` };
    try {
      const mode = await this.mode();
      const s = this.o.settings();
      const plan = planHorn(this.durationOf(src), s, mode);
      if (!plan) return original;
      const key = cacheKey({ src, mtimeMs: st.mtimeMs, size: st.size, mode, s });
      const out = path.join(this.o.cacheDir, `${league}-${abbr}-${key}.mp3`);
      if (cachedOk(out)) return { file: out, processed: true, etag: `"${key}"` };
      if (this.failed.has(key)) return original;
      let p = this.inflight.get(out);
      if (!p) {
        p = this.build(src, out, s, plan, mode, `${league}-${abbr}-`, key).finally(() => this.inflight.delete(out));
        this.inflight.set(out, p);
      }
      const built = await p;
      return built ? { file: built, processed: true, etag: `"${key}"` } : original;
    } catch (e) {
      this.log(`unexpected error serving ${league}/${abbr}, using the original: ${(e as Error).message}`);
      return original;
    }
  }

  private async build(src: string, out: string, s: HornProcSettings, plan: Plan, mode: AudioMode, prefix: string, key: string): Promise<string | undefined> {
    const tmp = `${out}.tmp-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
    try {
      fs.mkdirSync(this.o.cacheDir, { recursive: true });
      if (mode === "ffmpeg") {
        await this.run(this.ffmpeg, ffmpegArgs(src, tmp, s, plan), this.o.timeoutMs ?? 60_000);
        if (!fs.existsSync(tmp) || fs.statSync(tmp).size < 400) throw new Error("ffmpeg produced no output");
      } else {
        const cut = truncateMp3(fs.readFileSync(src), s.horn_max_s ?? Infinity);
        if (!cut) throw new Error("could not cut the MP3 (unparseable)");
        fs.writeFileSync(tmp, cut.data);
      }
      fs.renameSync(tmp, out); // atomic: readers see the whole file or none
      this.cleanStale(prefix, path.basename(out));
      return out;
    } catch (e) {
      this.failed.add(key);
      this.log(`processing ${path.basename(src)} failed, serving the original: ${(e as Error).message}`);
      try { fs.rmSync(tmp, { force: true }); } catch { /* ignore */ }
      return undefined;
    }
  }

  /** Remove older variants of the same horn, and (once per process) leftovers of horns that no longer exist. */
  private cleanStale(prefix: string, keep: string): void {
    try {
      for (const f of fs.readdirSync(this.o.cacheDir)) {
        if (f !== keep && f.startsWith(prefix) && /^[0-9a-f]{16}\.mp3$/.test(f.slice(prefix.length))) fs.rmSync(path.join(this.o.cacheDir, f), { force: true });
      }
      if (this.swept) return;
      this.swept = true;
      for (const f of fs.readdirSync(this.o.cacheDir)) {
        const m = /^([a-z0-9]+)-([A-Za-z0-9]+)-[0-9a-f]{16}\.mp3$/.exec(f);
        const orphan = m ? !fs.existsSync(this.sourcePath(m[1], m[2])) : f.includes(".tmp-") && Date.now() - fs.statSync(path.join(this.o.cacheDir, f)).mtimeMs > 600_000;
        if (orphan) fs.rmSync(path.join(this.o.cacheDir, f), { force: true });
      }
    } catch { /* cache hygiene is best effort */ }
  }

  /**
   * Build every variant that would be served under the current settings, one at a time, so the first goal after a
   * settings change or upload does not wait for ffmpeg (the integration speaks TTS ~3 s after the horn event).
   */
  async warm(list: { league: string; abbr: string }[]): Promise<void> {
    for (const h of list) await this.resolve(h.league, h.abbr);
  }

  /** Dashboard/status view of one horn under the current settings. */
  async describe(league: string, abbr: string): Promise<{ duration_s: number | null; processed: boolean; trimmed: boolean }> {
    const d = this.durationOf(this.sourcePath(league, abbr));
    const plan = planHorn(d, this.o.settings(), await this.mode());
    return { duration_s: d === undefined ? null : Math.round(d * 10) / 10, processed: !!plan, trimmed: !!plan?.trim };
  }
}

/** Status warnings about horns vs. the limit. `durations` are seconds. */
export function hornWarnings(durations: number[], s: HornProcSettings, mode: AudioMode): string[] {
  const out: string[] = [];
  if (s.horn_max_s != null) {
    const n = durations.filter((d) => d > s.horn_max_s!).length;
    if (n) out.push(`${n} horn${n === 1 ? "" : "s"} longer than ${s.horn_max_s}s will be cut off${mode === "truncate-only" ? " (cut only: no fade without ffmpeg, so they stop abruptly)" : ` with a ${s.horn_fade_ms} ms fade`}.`);
  } else if (durations.some((d) => d > 45)) {
    out.push("The horn limit is off and some horns are longer than 45 s: a long horn also delays the spoken announcement.");
  }
  return out;
}
