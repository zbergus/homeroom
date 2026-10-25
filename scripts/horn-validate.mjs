// Pure helpers used by fetch-horns.mjs (kept separate so `node --test scripts/` can cover them).
// MP3 only: there is no ffmpeg in this project, so we never transcode.

export const MIN_BYTES = 20 * 1024;
export const MAX_BYTES = 8 * 1024 * 1024;
export const LONG_SECONDS = 40; // a goal horn is ~3-20 s; anything past this is flagged (not rejected)

const BR_V1 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
const BR_V2 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
const SR = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] };

export const isId3 = (b) => b.length > 3 && b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33;
export const isFrameSync = (b, i = 0) => b.length > i + 1 && b[i] === 0xff && (b[i + 1] & 0xe0) === 0xe0;
export const looksLikeMp3 = (b) => isId3(b) || isFrameSync(b);

export function looksLikeHtml(b) {
  const head = Buffer.from(b.subarray(0, 512)).toString("latin1").trimStart().toLowerCase();
  return head.startsWith("<!doctype") || head.startsWith("<html") || head.startsWith("<?xml") || head.includes("<head") || head.includes("<body");
}

/** Offset of the first MPEG frame (after any ID3v2 tag), or -1. */
export function firstFrameOffset(b) {
  let i = 0;
  if (isId3(b) && b.length >= 10) {
    const size = ((b[6] & 0x7f) << 21) | ((b[7] & 0x7f) << 14) | ((b[8] & 0x7f) << 7) | (b[9] & 0x7f);
    i = 10 + size + (b[5] & 0x10 ? 10 : 0);
  }
  for (let n = i; n < Math.min(b.length - 3, i + 8192); n++) {
    if (isFrameSync(b, n) && ((b[n + 1] >> 1) & 3) === 1 && (b[n + 2] >> 4) !== 15 && (b[n + 2] >> 2 & 3) !== 3) return n;
  }
  return -1;
}

/**
 * Estimated duration in seconds from the first frame (Xing/Info frame count if present, else CBR bitrate).
 * `totalBytes` is the full file size (the buffer may be just the first few KB). Returns null if unknown.
 */
export function estimateDuration(b, totalBytes = b.length) {
  const at = firstFrameOffset(b);
  if (at < 0) return null;
  const ver = (b[at + 1] >> 3) & 3; // 3 = MPEG1, 2 = MPEG2, 0 = MPEG2.5
  if (ver === 1) return null;
  const br = (ver === 3 ? BR_V1 : BR_V2)[b[at + 2] >> 4] * 1000;
  const sr = SR[ver][(b[at + 2] >> 2) & 3];
  if (!br || !sr) return null;
  const spf = ver === 3 ? 1152 : 576;
  const mono = (b[at + 3] >> 6) === 3;
  const side = ver === 3 ? (mono ? 17 : 32) : mono ? 9 : 17;
  const tag = at + 4 + side + (b[at + 1] & 1 ? 0 : 2);
  const id = b.length >= tag + 12 ? b.subarray(tag, tag + 4).toString("latin1") : "";
  if ((id === "Xing" || id === "Info") && b[tag + 7] & 1) return (b.readUInt32BE(tag + 8) * spf) / sr;
  return ((totalBytes - at) * 8) / br;
}

/**
 * Validate audio bytes (whole file or just a head) against the manifest rules.
 * Returns { ok, reason?, duration, long, warnings[] }.
 */
export function validateAudio(buf, { contentType = "", totalBytes = buf.length } = {}) {
  const ct = contentType.split(";")[0].trim().toLowerCase();
  const warnings = [];
  if (/^text\//.test(ct) || /html|json|xml/.test(ct)) return { ok: false, reason: `content-type ${ct} (not audio)`, warnings };
  if (looksLikeHtml(buf)) return { ok: false, reason: "HTML page, not audio", warnings };
  if (!looksLikeMp3(buf)) {
    const sig = buf.subarray(0, 4).toString("latin1");
    const hint = sig === "RIFF" ? " (looks like WAV)" : sig === "OggS" ? " (looks like OGG)" : sig === "PK\x03\x04" ? " (looks like a ZIP)" : buf.subarray(4, 8).toString("latin1") === "ftyp" ? " (looks like M4A/MP4)" : "";
    return { ok: false, reason: `not an MP3${hint}: convert to MP3 first (see docs/HORNS.md)`, warnings };
  }
  if (totalBytes < MIN_BYTES) return { ok: false, reason: `too small (${totalBytes} bytes, min ${MIN_BYTES})`, warnings };
  if (totalBytes > MAX_BYTES) return { ok: false, reason: `too large (${(totalBytes / 1048576).toFixed(1)} MB, max 8 MB)`, warnings };
  if (ct && !/^(audio\/(mpeg|mp3|x-mpeg|mpeg3)|application\/octet-stream|binary\/octet-stream)$/.test(ct)) warnings.push(`unusual content-type ${ct}`);
  const duration = estimateDuration(buf, totalBytes);
  const long = duration != null && duration > LONG_SECONDS;
  if (long) warnings.push(`long (${duration.toFixed(0)} s)`);
  if (duration == null) warnings.push("duration unknown");
  return { ok: true, duration, long, warnings };
}
