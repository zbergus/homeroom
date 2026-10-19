/**
 * Minimal MP3 reader (MPEG-1/2/2.5 Layer III only): enough to measure a horn and cut it on a frame boundary.
 * No dependencies, never throws on garbage: anything it cannot parse yields `undefined`.
 */

const BITRATES_V1 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
const BITRATES_V2 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
const RATES: Record<number, number[]> = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] };

interface FrameHeader {
  size: number;
  samples: number;
  sampleRate: number;
  /** offset of the Xing/Info/VBRI tag if this frame carries one (relative to the frame start) */
  tagOffsets: number[];
}

/** Parse the 4-byte frame header at `pos`; undefined when it is not a valid Layer III header. */
export function frameAt(b: Uint8Array, pos: number): FrameHeader | undefined {
  if (pos < 0 || pos + 4 > b.length) return undefined;
  const h1 = b[pos + 1];
  if (b[pos] !== 0xff || (h1 & 0xe0) !== 0xe0) return undefined;
  const version = (h1 >> 3) & 3; // 3 = MPEG1, 2 = MPEG2, 0 = MPEG2.5, 1 = reserved
  if (version === 1) return undefined;
  if (((h1 >> 1) & 3) !== 1) return undefined; // Layer III only
  const h2 = b[pos + 2];
  const bi = h2 >> 4;
  const si = (h2 >> 2) & 3;
  if (bi === 0 || bi === 15 || si === 3) return undefined; // free-format and bad indexes are not supported
  const mpeg1 = version === 3;
  const bitrate = (mpeg1 ? BITRATES_V1 : BITRATES_V2)[bi] * 1000;
  const sampleRate = RATES[version][si];
  const pad = (h2 >> 1) & 1;
  const samples = mpeg1 ? 1152 : 576;
  const size = Math.floor(((mpeg1 ? 144 : 72) * bitrate) / sampleRate) + pad;
  const mono = (b[pos + 3] >> 6) === 3;
  const crc = (h1 & 1) === 0 ? 2 : 0;
  const side = mpeg1 ? (mono ? 17 : 32) : mono ? 9 : 17;
  return { size, samples, sampleRate, tagOffsets: [4 + crc + side, 4 + 32] };
}

/** Length of an ID3v2 tag at the start of the buffer (0 when absent). */
function id3v2Length(b: Uint8Array): number {
  if (b.length < 10 || b[0] !== 0x49 || b[1] !== 0x44 || b[2] !== 0x33) return 0;
  if ((b[6] | b[7] | b[8] | b[9]) & 0x80) return 0;
  const size = (b[6] << 21) | (b[7] << 14) | (b[8] << 7) | b[9];
  return 10 + size + (b[5] & 0x10 ? 10 : 0);
}

const tagAt = (b: Uint8Array, p: number, s: string) => p + 4 <= b.length && s.split("").every((c, i) => b[p + i] === c.charCodeAt(0));

interface Mp3Info {
  /** audio frames in order (the Xing/Info/VBRI metadata frame is excluded) */
  frames: { offset: number; size: number; samples: number; sampleRate: number }[];
  durationS: number;
  /** a Xing/Info/VBRI frame was present (its stored length cannot be trusted after a cut) */
  hadVbrHeader: boolean;
}

/** Walk the frames. Resyncs over junk but only accepts a header confirmed by a following header or the end of data. */
export function parseMp3(b: Uint8Array): Mp3Info | undefined {
  const frames: Mp3Info["frames"] = [];
  let pos = id3v2Length(b);
  let hadVbr = false;
  let first = true;
  while (pos + 4 <= b.length) {
    const f = frameAt(b, pos);
    if (f && pos + f.size <= b.length) {
      const next = pos + f.size;
      const confirmed = next + 4 > b.length || frameAt(b, next) !== undefined || frames.length > 0;
      if (confirmed) {
        if (first && f.tagOffsets.some((o) => tagAt(b, pos + o, "Xing") || tagAt(b, pos + o, "Info") || tagAt(b, pos + o, "VBRI"))) {
          hadVbr = true;
        } else frames.push({ offset: pos, size: f.size, samples: f.samples, sampleRate: f.sampleRate });
        first = false;
        pos = next;
        continue;
      }
    }
    pos++;
  }
  if (!frames.length) return undefined;
  const durationS = frames.reduce((s, f) => s + f.samples / f.sampleRate, 0);
  return { frames, durationS, hadVbrHeader: hadVbr };
}

export function mp3DurationS(b: Uint8Array): number | undefined {
  return parseMp3(b)?.durationS;
}

/**
 * Cut at the last whole frame that ends at or before `maxS`. ID3 tags, a Xing/Info header frame and trailing junk are
 * dropped so players measure the real length. Returns undefined when the input is unparseable.
 */
export function truncateMp3(b: Buffer, maxS: number): { data: Buffer; durationS: number } | undefined {
  const info = parseMp3(b);
  if (!info) return undefined;
  const parts: Buffer[] = [];
  let t = 0;
  let runStart = -1;
  let runEnd = -1;
  for (const f of info.frames) {
    const d = f.samples / f.sampleRate;
    if (t + d > maxS + 1e-9) break;
    t += d;
    if (f.offset === runEnd) runEnd += f.size;
    else {
      if (runStart >= 0) parts.push(b.subarray(runStart, runEnd));
      runStart = f.offset;
      runEnd = f.offset + f.size;
    }
  }
  if (runStart >= 0) parts.push(b.subarray(runStart, runEnd));
  if (!parts.length) return undefined;
  return { data: Buffer.concat(parts), durationS: t };
}
