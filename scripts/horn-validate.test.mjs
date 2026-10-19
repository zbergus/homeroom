// Run: node --test scripts/
import test from "node:test";
import assert from "node:assert/strict";
import { validateAudio, looksLikeMp3, looksLikeHtml, estimateDuration } from "./horn-validate.mjs";

// MPEG1 Layer III, 128 kbps, 44.1 kHz, stereo -> header FF FB 90 00; frame = 417 bytes.
const frame = () => { const f = Buffer.alloc(417); f.set([0xff, 0xfb, 0x90, 0x00]); return f; };
const mp3 = (frames) => Buffer.concat(Array.from({ length: frames }, frame)); // ~26 ms each
const id3 = (body) => Buffer.concat([Buffer.from([0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0x08, 0x00]), Buffer.alloc(1024), body]);

test("sniffs ID3 and bare frame sync", () => {
  assert.ok(looksLikeMp3(id3(mp3(2))));
  assert.ok(looksLikeMp3(mp3(2)));
  assert.ok(!looksLikeMp3(Buffer.from("RIFF....WAVE")));
});

test("CBR duration estimate (no ID3, and after an ID3 tag)", () => {
  const b = mp3(200); // 83400 bytes at 128 kbps = 5.2 s
  assert.ok(Math.abs(estimateDuration(b) - 5.2125) < 0.05);
  assert.ok(Math.abs(estimateDuration(id3(mp3(200))) - 5.2125) < 0.05);
  assert.ok(Math.abs(estimateDuration(b.subarray(0, 4096), b.length) - 5.2125) < 0.05); // head + total size
});

test("accepts a plausible horn", () => {
  const r = validateAudio(mp3(200), { contentType: "audio/mpeg" });
  assert.equal(r.ok, true);
  assert.equal(r.long, false);
});

test("rejects HTML saved as .mp3", () => {
  const html = Buffer.from("<!DOCTYPE html><html><body>Not found</body></html>".padEnd(30000, " "));
  assert.equal(validateAudio(html, { contentType: "text/html" }).ok, false);
  assert.equal(validateAudio(html, { contentType: "audio/mpeg" }).ok, false);
  assert.ok(looksLikeHtml(html));
});

test("rejects WAV/OGG with a conversion hint, too small, too large", () => {
  const wav = Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(40000)]);
  assert.match(validateAudio(wav).reason, /WAV/);
  assert.match(validateAudio(Buffer.concat([Buffer.from("OggS"), Buffer.alloc(40000)])).reason, /OGG/);
  assert.match(validateAudio(mp3(10)).reason, /too small/);
  assert.match(validateAudio(mp3(10), { totalBytes: 9 * 1048576 }).reason, /too large/);
});

test("flags long files without rejecting them", () => {
  const r = validateAudio(mp3(2000)); // ~52 s
  assert.equal(r.ok, true);
  assert.equal(r.long, true);
});

test("audio without ID3 but with audio/mpeg is fine (frame sync)", () => {
  assert.equal(validateAudio(mp3(200), { contentType: "audio/mpeg; charset=binary" }).ok, true);
});
