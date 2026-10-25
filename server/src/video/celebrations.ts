import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import fastifyStatic from "@fastify/static";
import type { FastifyPluginAsync } from "fastify";
import { LEAGUES } from "../leagues.js";
import { CelebrationMediaParamsSchema, CelebrationParamsSchema, ImportCelebrationSchema } from "../schemas.js";

export const MAX_CELEBRATION_BYTES = 50 * 1024 * 1024;

/** Resolves Giphy page or media URLs to direct MP4 streaming URLs. */
export function resolveCelebrationUrl(rawUrl: string): string {
  try {
    const u = new URL(rawUrl);
    // Giphy page link: https://giphy.com/gifs/canadiensmtl-habs-caufield-xyz123 or https://giphy.com/gifs/xyz123
    const match = u.pathname.match(/^\/gifs\/(?:.*-)?([a-zA-Z0-9]+)$/);
    if ((u.hostname === "giphy.com" || u.hostname === "www.giphy.com") && match?.[1]) {
      return `https://media.giphy.com/media/${match[1]}/giphy.mp4`;
    }
    // Giphy media link: https://media.giphy.com/media/xyz123/giphy.gif or /giphy.mp4 or i.giphy.com
    const mediaMatch = u.pathname.match(/^\/media\/([a-zA-Z0-9]+)\//);
    if ((u.hostname === "media.giphy.com" || u.hostname === "i.giphy.com") && mediaMatch?.[1]) {
      return `https://media.giphy.com/media/${mediaMatch[1]}/giphy.mp4`;
    }
    return rawUrl;
  } catch {
    return rawUrl;
  }
}

/** Check if host is a local/private IP or loopback to prevent SSRF. */
export function isPrivateHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (h === "localhost" || h === "127.0.0.1" || h === "::1" || h === "0.0.0.0") return true;
  if (/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}$/.test(h)) return true;
  if (/^192\.168\.\d{1,3}\.\d{1,3}$/.test(h)) return true;
  if (/^169\.254\.\d{1,3}\.\d{1,3}$/.test(h)) return true;
  return false;
}

type Assignment = { league: string; abbr: string; player_id: string };
const relativeFile = (p: Assignment) => path.join(p.league, p.abbr, `${p.player_id}.mp4`);
const urlFor = (p: Assignment) => `/media/celebrations/${[p.league, p.abbr, `${p.player_id}.mp4`].map(encodeURIComponent).join("/")}`;

/** Reject symlinks at every component, including the library root. */
async function directory(dir: string, create = false): Promise<boolean> {
  if (create) await fs.promises.mkdir(dir, { recursive: true });
  try { return (await fs.promises.lstat(dir)).isDirectory(); }
  catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return false; throw e; }
}

async function assignmentDir(root: string, p: Assignment, create = false): Promise<boolean> {
  for (const dir of [root, path.join(root, p.league), path.join(root, p.league, p.abbr)]) {
    if (!await directory(dir, create)) return false;
  }
  return true;
}

async function regular(file: string): Promise<boolean> {
  try { return (await fs.promises.lstat(file)).isFile(); }
  catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return false; throw e; }
}

/** ISO-BMFF ftyp with an MP4-compatible brand, not just an arbitrary .mp4 filename. */
async function isMp4(file: string): Promise<boolean> {
  const handle = await fs.promises.open(file, "r");
  try {
    const header = Buffer.alloc(4096);
    const { bytesRead } = await handle.read(header, 0, header.length, 0);
    if (bytesRead < 16 || header.toString("ascii", 4, 8) !== "ftyp") return false;
    const size = header.readUInt32BE(0);
    if (size < 16 || size > bytesRead || size % 4 !== 0) return false;
    const brands = [header.toString("ascii", 8, 12)];
    for (let i = 16; i < size; i += 4) brands.push(header.toString("ascii", i, i + 4));
    return brands.some((b) => /^(?:isom|iso[2-9]|mp4[12]|avc1|M4V |dash|MSNV)$/.test(b));
  } finally { await handle.close(); }
}

export const celebrationRoutes: FastifyPluginAsync<{
  mediaDir: string;
  findPlayerName?: (league: string, abbr: string, playerId: string) => string | undefined;
}> = async (app, options) => {
  const root = path.join(options.mediaDir, "celebrations");
  if (!await directory(root, true)) throw new Error("celebrations must be a directory, not a symlink");
  // Scoped decoration avoids depending on whether a web build exists. Explicit routes stay dynamic.
  await app.register(fastifyStatic, { root, serve: false });

  app.get("/api/celebrations", async () => {
    const out: (Assignment & { url: string; player_name?: string | undefined })[] = [];
    if (!await directory(root)) return out;
    for (const l of LEAGUES) {
      const leagueDir = path.join(root, l.id);
      if (!await directory(leagueDir)) continue;
      for (const entry of await fs.promises.readdir(leagueDir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const dir = path.join(leagueDir, entry.name);
        for (const f of await fs.promises.readdir(dir, { withFileTypes: true })) {
          if (!f.isFile()) continue;
          const p = CelebrationMediaParamsSchema.safeParse({ league: l.id, abbr: entry.name, file: f.name });
          if (!p.success || p.data.abbr !== entry.name || !await isMp4(path.join(dir, f.name))) continue;
          const name = options.findPlayerName?.(p.data.league, p.data.abbr, p.data.player_id);
          out.push({ ...p.data, url: urlFor(p.data), ...(name ? { player_name: name } : {}) });
        };
      }
    }
    return out.sort((a, b) => a.url.localeCompare(b.url));
  });

  app.post("/api/celebrations/:league/:abbr/:player_id", async (req, reply) => {
    const parsed = CelebrationParamsSchema.safeParse(req.params);
    if (!parsed.success) return reply.code(400).send({ error: "bad league/abbr/player_id" });
    const p = parsed.data;
    if (!await assignmentDir(root, p, true)) return reply.code(400).send({ error: "invalid library directory" });
    const target = path.join(root, relativeFile(p));
    const pending = path.join(path.dirname(target), `.${randomUUID()}.upload`);
    let uploaded = false;
    try {
      const parts = req.parts({ limits: { fileSize: MAX_CELEBRATION_BYTES, files: 1, fields: 0, parts: 1 } });
      let next = await parts.next();
      while (!next.done) {
        const part = next.value;
        if (part.type !== "file" || part.fieldname !== "file" || !/\.mp4$/i.test(part.filename) || !["video/mp4", "application/octet-stream"].includes(part.mimetype)) {
          if (part.type === "file") part.file.resume();
          return reply.code(415).send({ error: "multipart field `file` must be an MP4 video" });
        }
        if (part.file.destroyed) return reply.code(400).send({ error: "truncated multipart upload" });
        // Observe parser errors while streaming, including a missing closing multipart boundary.
        const controller = new AbortController();
        const writing = pipeline(part.file, fs.createWriteStream(pending, { flags: "wx", mode: 0o600 }), { signal: controller.signal });
        const following = parts.next();
        try { [, next] = await Promise.all([writing, following]); }
        catch (e) {
          controller.abort();
          await Promise.allSettled([writing, following]);
          throw e;
        }
        if (part.file.truncated) return reply.code(413).send({ error: "file too large (50 MiB max)" });
        uploaded = true;
      }
      if (!uploaded) return reply.code(400).send({ error: "multipart field `file` required" });
      if (!await isMp4(pending)) return reply.code(415).send({ error: "not an MP4 file" });
      const size = (await fs.promises.stat(pending)).size;
      await fs.promises.rename(pending, target);
      return { ok: true, size };
    } finally { await fs.promises.rm(pending, { force: true }); }
  });

  app.post("/api/celebrations/:league/:abbr/:player_id/import", async (req, reply) => {
    const parsed = CelebrationParamsSchema.safeParse(req.params);
    if (!parsed.success) return reply.code(400).send({ error: "bad league/abbr/player_id" });
    const p = parsed.data;
    if (!await assignmentDir(root, p, true)) return reply.code(400).send({ error: "invalid library directory" });

    const bodyParsed = ImportCelebrationSchema.safeParse(req.body);
    if (!bodyParsed.success) return reply.code(400).send({ error: "valid url required" });

    let resolvedUrl: string;
    try {
      resolvedUrl = resolveCelebrationUrl(bodyParsed.data.url);
      const parsedUrl = new URL(resolvedUrl);
      if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
        return reply.code(400).send({ error: "URL must be http:// or https://" });
      }
      if (isPrivateHost(parsedUrl.hostname)) {
        return reply.code(400).send({ error: "private or loopback addresses are not permitted" });
      }
    } catch {
      return reply.code(400).send({ error: "invalid URL" });
    }

    const target = path.join(root, relativeFile(p));
    const pending = path.join(path.dirname(target), `.${randomUUID()}.upload`);
    try {
      const res = await fetch(resolvedUrl, {
        headers: { "User-Agent": "Homeroom/1.0 (celebration-import)" },
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) {
        return reply.code(400).send({ error: `failed to fetch video (HTTP ${res.status})` });
      }
      const len = res.headers.get("content-length");
      if (len && parseInt(len, 10) > MAX_CELEBRATION_BYTES) {
        return reply.code(413).send({ error: "file too large (50 MiB max)" });
      }
      if (!res.body) {
        return reply.code(400).send({ error: "empty response body" });
      }

      let written = 0;
      const fileStream = fs.createWriteStream(pending, { flags: "wx", mode: 0o600 });
      const reader = res.body.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          written += value.byteLength;
          if (written > MAX_CELEBRATION_BYTES) {
            await reader.cancel();
            return reply.code(413).send({ error: "file too large (50 MiB max)" });
          }
          if (!fileStream.write(value)) {
            await new Promise((resolve) => fileStream.once("drain", resolve));
          }
        }
      } finally {
        await new Promise((resolve) => fileStream.end(resolve));
      }

      if (!await isMp4(pending)) {
        return reply.code(415).send({ error: "not an MP4 file or unsupported video encoding" });
      }

      await fs.promises.rename(pending, target);
      return { ok: true, size: written };
    } catch (e) {
      return reply.code(502).send({ error: `download failed: ${(e as Error).message}` });
    } finally {
      await fs.promises.rm(pending, { force: true });
    }
  });

  app.delete("/api/celebrations/:league/:abbr/:player_id", async (req, reply) => {
    const parsed = CelebrationParamsSchema.safeParse(req.params);
    if (!parsed.success) return reply.code(400).send({ error: "bad league/abbr/player_id" });
    if (await assignmentDir(root, parsed.data)) await fs.promises.rm(path.join(root, relativeFile(parsed.data)), { force: true });
    return { ok: true };
  });

  app.get("/media/celebrations/:league/:abbr/:file", async (req, reply) => {
    const parsed = CelebrationMediaParamsSchema.safeParse(req.params);
    if (!parsed.success || !await assignmentDir(root, parsed.data) || !await regular(path.join(root, relativeFile(parsed.data)))) {
      return reply.code(404).send({ error: "not found" });
    }
    return reply.type("video/mp4").sendFile(relativeFile(parsed.data), { cacheControl: true, maxAge: 0 });
  });
  // Never let the general /media static route expose staging files or malformed assignments.
  app.get("/media/celebrations/*", async (_req, reply) => reply.code(404).send({ error: "not found" }));
}
