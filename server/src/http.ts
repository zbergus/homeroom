import fs from "node:fs";
import path from "node:path";
import formbody from "@fastify/formbody";
import multipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import { type Config, loadConfig, securityNotes } from "./config.js";
import type { Engine } from "./engine/engine.js";
import type { Poller } from "./engine/poller.js";
import { LEAGUES } from "./leagues.js";
import { parseClock, suggestDelay } from "./engine/calibrate.js";
import { isTriggerId, TRIGGERS } from "./engine/triggers.js";
import type { Dispatcher } from "./outputs/dispatch.js";
import type { HaOutputs } from "./outputs/ha.js";
import { supportsColor, type LightRules } from "./outputs/lights.js";
import type { PusherHub } from "./outputs/pusher.js";
import { HornService, hornWarnings } from "./audio/horns.js";
import {
  ABBR_RE, ActionListSchema, CalibrateBodySchema, DevicesSyncSchema, ExecuteBodySchema, firstIssue, HookQuerySchema, SyncBodySchema, TeamOverrideSchema,
  TriggerBodySchema, WsAuthBodySchema,
} from "./schemas.js";
import { errMsg, isCrossSite, RateLimiter, safeEq } from "./security.js";
import { DATA_DIR, MEDIA_DIR, migrateAction } from "./store.js";
import type { Game, LightAction, Settings } from "./types.js";

interface Deps {
  engine: Engine;
  poller: Poller;
  hub: PusherHub;
  lights: LightRules;
  ha: HaOutputs;
  dispatcher: Dispatcher;
  webDir: string;
  startedAt?: number | undefined;
  /** defaults to `loadConfig()` (the process environment) */
  config?: Config | undefined;
  /** override for tests (fake ffmpeg, temp cache dir) */
  horns?: HornService | undefined;
}

/** keys whose change means the pollers must re-plan (everything else, e.g. the delay slider, must not re-poll) */
const POLL_KEYS = ["enabled_leagues", "grid_leagues", "poll_idle_s", "poll_live_s", "nhl_fast_poll_ms", "auto_sync_favorites", "sync_excluded"] as const;

const redact = (s: Settings) => ({ ...s, ha: { url: s.ha.url, fire_rest_events: s.ha.fire_rest_events, token: "", token_set: !!s.ha.token } });

const MAX_HORN_BYTES = 10 * 1024 * 1024;

const bearer = (req: FastifyRequest): string | undefined => /^Bearer (.+)$/i.exec(req.headers.authorization ?? "")?.[1];

function looksLikeMp3(b: Buffer): boolean {
  if (b.length <= 4) return false;
  const [b0, b1, b2] = [b.readUInt8(0), b.readUInt8(1), b.readUInt8(2)];
  return (b0 === 0x49 && b1 === 0x44 && b2 === 0x33) || (b0 === 0xff && (b1 & 0xe0) === 0xe0); // "ID3" tag, or an MPEG frame sync
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** `payload` of POST /requests/execute: the integration sends the entity state as a JSON string (or, sometimes, an object) */
function parsePayload(payload: string | Record<string, unknown> | undefined): Record<string, unknown> {
  if (typeof payload !== "string") return payload ?? {};
  try {
    const v: unknown = JSON.parse(payload);
    return isRecord(v) ? v : {};
  } catch {
    return {}; // an unreadable state is "no state", which only skips the restore
  }
}

interface TeamRow { abbr: string; name: string; logo: string | undefined; options: unknown }

const clampInt = (v: unknown, def: number, min: number, max: number): number => Math.min(max, Math.max(min, Math.trunc(Number(v)) || def));

/**
 * Serve an MP3 with the same semantics as fastify-static: audio/mpeg, Accept-Ranges and 206/416 for Range (Cast and Sonos seek), conditional GET.
 * Horns are capped at 10 MB, so send Buffers: a hand-set Content-Length plus a stream left keep-alive sockets open and hung `app.close()`.
 */
async function sendAudio(req: FastifyRequest, reply: FastifyReply, file: string, etag: string) {
  const st = await fs.promises.stat(file);
  reply.header("Content-Type", "audio/mpeg").header("Accept-Ranges", "bytes").header("ETag", etag).header("Last-Modified", st.mtime.toUTCString()).header("Cache-Control", "public, max-age=0");
  if (req.headers["if-none-match"] === etag) return reply.code(304).send();
  const range = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range ?? "").trim());
  if (range && (range[1] || range[2])) {
    let start: number;
    let end: number;
    if (range[1] === "") { start = Math.max(0, st.size - Number(range[2])); end = st.size - 1; }
    else { start = Number(range[1]); end = range[2] === "" ? st.size - 1 : Math.min(Number(range[2]), st.size - 1); }
    if (start >= st.size || start > end) return reply.code(416).header("Content-Range", `bytes */${st.size}`).send();
    return reply.code(206).header("Content-Range", `bytes ${start}-${end}/${st.size}`).send((await fs.promises.readFile(file)).subarray(start, end + 1));
  }
  return reply.send(await fs.promises.readFile(file));
}

export async function buildHttp(d: Deps): Promise<FastifyInstance> {
  const { engine, poller, hub, lights, ha, dispatcher } = d;
  const store = engine.store;
  const horns = d.horns ?? new HornService({ mediaDir: MEDIA_DIR, cacheDir: path.join(DATA_DIR, "cache", "horns"), settings: () => engine.settings });
  // pre-build processed horns in the background (production wiring only; tests inject their own service)
  const warmHorns = () => { if (!d.horns) void horns.warm(hornFileList()).catch((e) => console.warn("[horns] warm-up failed:", errMsg(e))); };
  const config = d.config ?? loadConfig();
  const app = Fastify({ logger: { level: config.logLevel } });
  await app.register(formbody);
  await app.register(multipart, { limits: { fileSize: MAX_HORN_BYTES, files: 1 } });

  // Optional shared secret for mutating control-plane calls (the integration endpoints use their own keys).
  const admin = config.adminToken;
  const authFailures = new RateLimiter(20, 60_000);
  const linkAttempts = new RateLimiter(10, 60_000);
  const integrationCalls = new RateLimiter(600, 60_000);
  const isRead = (m: string) => m === "GET" || m === "HEAD";

  app.addHook("onSend", async (_req, reply) => {
    reply.header("X-Content-Type-Options", "nosniff").header("X-Frame-Options", "SAMEORIGIN").header("Referrer-Policy", "same-origin");
  });

  app.addHook("onRequest", async (req, reply) => {
    const api = req.url.startsWith("/api/");
    // a page on another site must not be able to drive the control plane from a browser on this network
    // (form posts and <img src=".../api/hook/..."> skip CORS preflight; the API does not use cookies, so this is the only guard)
    if (api && (!isRead(req.method) || req.url.startsWith("/api/hook/")) && isCrossSite(req.headers, config.allowedOrigins)) {
      return reply.code(403).send({ error: "cross-site request refused" });
    }
    // the API speaks JSON (horn uploads are multipart); urlencoded and text bodies are only for the integration routes
    if (api && !isRead(req.method) && req.method !== "OPTIONS") {
      const ct = (req.headers["content-type"] ?? "").toLowerCase();
      const upload = req.method === "POST" && req.url.startsWith("/api/horns/") && ct.startsWith("multipart/form-data");
      if (ct && !upload && !ct.startsWith("application/json")) return reply.code(415).send({ error: "content-type must be application/json" });
    }
    if (!admin || !api || isRead(req.method)) return;
    if (authFailures.blocked(req.ip)) return reply.code(429).send({ error: "too many failed attempts, try again in a minute" });
    if (!safeEq(bearer(req), admin)) {
      authFailures.allow(req.ip);
      return reply.code(401).send({ error: "ADMIN_TOKEN required" });
    }
  });

  app.addHook("onRequest", async (req, reply) => {
    if (!/^\/(integrations|auth|requests)\//.test(req.url)) return;
    const limiter = req.url.startsWith("/integrations/home-assistant/link") ? linkAttempts : integrationCalls;
    if (!limiter.allow(req.ip)) return reply.code(429).send({ error: "slow down" });
  });

  app.get("/healthz", async () => ({ ok: true, games: engine.games.size }));

  // ================= Home Assistant integration compatibility (see SPEC §1) =================
  app.post("/integrations/home-assistant/link", async (req) => {
    const key = bearer(req);
    if (!key || (config.haApiKey && !safeEq(key, config.haApiKey))) return { success: false };
    const l = store.link(key);
    if (!l) return { success: false };
    return { success: true, unique_id: l.unique_id, websocket_key: l.websocket_key, integration_key: l.integration_key };
  });

  app.post("/integrations/home-assistant/devices/sync", async (req) => {
    const key = bearer(req);
    const l = key ? store.linkByApiKey(key) : undefined;
    if (!l) return { success: false };
    const body = DevicesSyncSchema.safeParse(req.body ?? {});
    if (!body.success) return { success: false };
    store.replaceDevices(l.integration_key, body.data.devices);
    return { success: true };
  });

  app.post("/auth/websockets", async (req, reply) => {
    const wsKey = req.headers["x-websocket-key"];
    const l = typeof wsKey === "string" ? store.linkByWebsocketKey(wsKey) : undefined;
    const { socket_id, channel_name } = WsAuthBodySchema.safeParse(req.body ?? {}).data ?? {};
    const mine = l ? [`private-${l.unique_id}`, `private-home-assistant.${l.integration_key}`] : [];
    if (!l || !socket_id || !channel_name || !mine.includes(channel_name)) return reply.code(403).send({ error: "forbidden" });
    return { auth: hub.sign(socket_id, channel_name) };
  });

  app.post("/requests/execute", async (req) => {
    const key = bearer(req);
    if (!key || !store.linkByApiKey(key)) return { success: false };
    const b = ExecuteBodySchema.safeParse(req.body ?? {}).data ?? {};
    return { success: !!b.request_id && lights.receiveState(b.request_id, parsePayload(b.payload)) };
  });

  // ================= control plane =================
  app.get("/api/leagues", async () => LEAGUES.map(({ id, name, sport }) => ({ id, name, sport })));

  app.get("/api/schedule", async (req) => {
    const days = clampInt((req.query as { days?: unknown | undefined }).days, 7, 1, 14);
    const games = await poller.getSchedule(days);
    const byDate = new Map<string, Game[]>();
    for (const g of games) {
      const dt = new Date(g.start_time);
      const key = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
      (byDate.get(key) ?? byDate.set(key, []).get(key)!).push(g);
    }
    const out = [...byDate.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, gs]) => ({ date, games: gs.sort((a, b) => a.start_time.localeCompare(b.start_time)) }));
    return { days: out, synced: store.getSyncedGames() };
  });

  /** `games` = what the user ticked; `effective` = what actually fires (ticked + auto-synced favourites, minus exclusions) */
  const syncState = () => {
    const ticked = store.getSyncedGames();
    const effective = [...new Set([...ticked, ...engine.games.keys()])].filter((id) => engine.isSynced(id));
    return { games: ticked, favorites: store.getFavorites(), effective };
  };
  app.get("/api/sync", async () => syncState());
  app.put("/api/sync", async (req, reply) => {
    const parsed = SyncBodySchema.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: firstIssue(parsed.error) });
    const b = parsed.data;
    if (b.games !== undefined) store.setSyncedGames(b.games);
    if (b.favorites !== undefined) store.setFavorites(b.favorites);
    engine.invalidateSync();
    poller.poke();
    return syncState();
  });

  app.get("/api/settings", async () => redact(engine.settings));
  app.put("/api/settings", async (req, reply) => {
    const body: Record<string, unknown> = isRecord(req.body) ? { ...req.body } : {};
    if (isRecord(body.ha)) {
      // the token is write-only: an empty/missing value keeps the stored one, `clear_token` removes it
      const { clear_token, ...rest } = body.ha;
      if (clear_token === true) rest.token = "";
      else if (!rest.token) delete rest.token;
      body.ha = rest;
    }
    const before = engine.settings;
    const err = store.patchSettings(body);
    if (err) return reply.code(400).send({ error: err });
    engine.invalidateSettings();
    const touched = (...keys: string[]) => keys.some((k) => body[k] !== undefined);
    if (touched("horn_max_s", "horn_fade_ms", "horn_normalize")) warmHorns();
    if (touched("auto_sync_favorites", "sync_excluded")) engine.invalidateSync();
    const after = engine.settings;
    if (POLL_KEYS.some((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]))) poller.poke();
    return redact(after);
  });

  app.get("/api/triggers", async () => TRIGGERS.map(({ id, label, sports }) => ({ id, label, sports })));

  app.get("/api/games/live", async () => [...engine.shown.values()]);

  /** undelayed state, for the control plane only (delay calibration); never hand this to a TV view */
  app.get("/api/games/raw", async () => [...engine.games.values()]);

  /** "I see 2nd period 12:50 on my TV": how far behind the live feed is it? */
  app.post("/api/calibrate", async (req, reply) => {
    const b = CalibrateBodySchema.safeParse(req.body ?? {}).data ?? {};
    const g = b.game_id ? engine.games.get(b.game_id) : undefined;
    if (!g) return reply.code(404).send({ error: "unknown game" });
    const tv = parseClock(b.tv_clock ?? "");
    if (tv === undefined || b.tv_period === undefined || !Number.isInteger(b.tv_period) || b.tv_period < 1) return reply.code(400).send({ error: "tv_period (1..) and tv_clock (M:SS) are required" });
    if (g.status !== "in" || g.clock_s === undefined || !g.clock_dir) return reply.code(409).send({ error: "this game has no live clock to compare against" });
    return suggestDelay(
      { league: g.league, period: g.period, clock_s: g.clock_s, clock_running: !!g.clock_running, clock_dir: g.clock_dir, age_s: engine.rawAgeS(g.id) },
      { period: b.tv_period, clock_s: tv },
    );
  });

  const fire = (o: { trigger?: string | undefined; league?: string | undefined; team_abbr?: string | undefined; game_id?: string | undefined; apply_delay?: boolean | undefined }) => {
    if (o.trigger && !isTriggerId(o.trigger)) throw Object.assign(new Error(`unknown trigger "${o.trigger}"`), { statusCode: 400 });
    if (o.league && !LEAGUES.some((l) => l.id === o.league)) throw Object.assign(new Error("unknown league"), { statusCode: 400 });
    return engine.fireTrigger(o);
  };

  app.post("/api/trigger", async (req) => {
    return { ok: true, event: fire(TriggerBodySchema.safeParse(req.body ?? {}).data ?? {}) };
  });

  // For Stream Deck / HA rest_command / physical buttons that can only issue a GET.
  // Side effects on GET are normally avoided, so this one demands the admin token whenever one is configured.
  app.get("/api/hook/:trigger", async (req, reply) => {
    const q = HookQuerySchema.safeParse(req.query ?? {}).data ?? {};
    if (admin) {
      if (authFailures.blocked(req.ip)) return reply.code(429).send({ error: "too many failed attempts, try again in a minute" });
      if (!safeEq(bearer(req), admin) && !safeEq(q.token, admin)) {
        authFailures.allow(req.ip);
        return reply.code(401).send({ error: "token required" });
      }
    }
    const ev = fire({ trigger: (req.params as { trigger: string }).trigger, league: q.league, team_abbr: q.team, game_id: q.game, apply_delay: q.delay === "1" });
    return { ok: true, event_id: ev.event_id, type: ev.type };
  });

  app.post("/api/test/goal", async (req) => {
    const b = TriggerBodySchema.safeParse(req.body ?? {}).data ?? {};
    return { ok: true, event: fire({ trigger: "goal", league: b.league, team_abbr: b.team_abbr, apply_delay: b.bypass_delay === false }) };
  });

  app.get("/api/events/recent", async (req) => dispatcher.log.recent(clampInt((req.query as { n?: unknown | undefined }).n, 50, 1, 100)));

  let hornCheck: { at: number; ok: boolean | null; detail: string } | undefined;
  const checkHornUrl = async () => {
    if (hornCheck && Date.now() - hornCheck.at < 60_000) return hornCheck;
    const base = engine.settings.public_base_url.replace(/\/$/, "");
    let file: string | undefined;
    for (const l of LEAGUES) {
      const dir = path.join(MEDIA_DIR, "horns", l.id);
      if (fs.existsSync(dir)) file = fs.readdirSync(dir).filter((f) => f.endsWith(".mp3")).map((f) => `${l.id}/${f}`)[0] ?? file;
      if (file) break;
    }
    if (!base) hornCheck = { at: Date.now(), ok: null, detail: "PUBLIC_BASE_URL is not set" };
    else if (!file) hornCheck = { at: Date.now(), ok: null, detail: "no horn files uploaded yet" };
    else {
      try {
        const r = await fetch(`${base}/media/horns/${file}`, { method: "HEAD", redirect: "error", signal: AbortSignal.timeout(3000) });
        hornCheck = { at: Date.now(), ok: r.ok, detail: r.ok ? `${base}/media/horns/${file} is reachable from the server` : `HTTP ${r.status} for ${base}/media/horns/${file}` };
      } catch (e) {
        hornCheck = { at: Date.now(), ok: false, detail: `cannot fetch ${base}: ${errMsg(e)}` };
      }
    }
    return hornCheck;
  };

  app.get("/api/status", async () => {
    const s = engine.settings;
    const links = store.allLinks().map((l) => ({
      id: l.unique_id,
      events_connected: hub.subscribers(`private-${l.unique_id}`) > 0,
      devices_connected: hub.subscribers(`private-home-assistant.${l.integration_key}`) > 0,
    }));
    const devices = store.getDevices();
    const games = [...engine.games.values()];
    const hornFiles = LEAGUES.reduce((n, l) => n + (fs.existsSync(hornDir(l.id)) ? fs.readdirSync(hornDir(l.id)).filter((f) => f.endsWith(".mp3")).length : 0), 0);
    const horn = await checkHornUrl();
    const audioMode = await horns.mode();
    const durations = hornFileList().map((h) => horns.durationOf(h.file)).filter((x): x is number => x !== undefined);
    const restOn = s.ha.fire_rest_events && !!s.ha.url && !!s.ha.token;
    const pusherOn = links.some((l) => l.events_connected);
    const warnings: string[] = [];
    if (!links.length) warnings.push("No Home Assistant integration has linked yet. Install the patched integration (see README) and add it in Home Assistant.");
    else if (!pusherOn) warnings.push("A Home Assistant integration is linked but not connected right now. Check that Home Assistant can reach this server.");
    if (pusherOn && restOn) warnings.push("The HA integration and REST events are both active: any automation fed by both will fire twice (lights flash twice, horn plays twice).");
    if (!s.public_base_url) warnings.push("PUBLIC_BASE_URL is not set, so goal horns cannot be sent.");
    else if (/^https?:\/\/(127\.|localhost|0\.0\.0\.0)/.test(s.public_base_url)) warnings.push("PUBLIC_BASE_URL points at localhost; your speakers cannot reach that. Use this machine's LAN address.");
    if (horn.ok === false) warnings.push(`Horn URL check failed: ${horn.detail}`);
    warnings.push(...hornWarnings(durations, s, audioMode));
    warnings.push(...poller.providerWarnings());
    warnings.push(...securityNotes(config));
    if (!s.automations_enabled) warnings.push("Automations are disabled: only manual triggers fire.");
    const known = new Set(devices.map((d) => d.entity_id));
    const missing = store.getActions().flatMap((a) => a.entities).filter((e) => !known.has(e));
    if (missing.length) warnings.push(`Light actions reference devices Home Assistant has not synced: ${[...new Set(missing)].slice(0, 3).join(", ")}`);
    return {
      version: "0.2.0",
      uptime_s: Math.round((Date.now() - (d.startedAt ?? Date.now())) / 1000),
      games: { tracked: games.length, live: games.filter((g) => g.status === "in").length, synced: games.filter((g) => engine.isSynced(g.id)).length },
      integration: { links, devices: devices.length },
      providers: poller.providerRows(),
      server_time: Date.now(),
      outputs: { rest_events: restOn, pusher_connected: pusherOn },
      horns: { files: hornFiles, url_check: horn },
      audio: { ffmpeg: audioMode === "ffmpeg", mode: audioMode },
      public_base_url: s.public_base_url,
      flags: { my_team_only: s.my_team_only, automations_enabled: s.automations_enabled, auto_sync_favorites: s.auto_sync_favorites },
      warnings,
    };
  });

  app.get("/api/teams/:league", async (req, reply) => {
    const { league } = req.params as { league: string };
    if (!LEAGUES.some((l) => l.id === league)) return reply.code(404).send({ error: "unknown league" });
    const seen = new Map<string, TeamRow>();
    for (const g of [...engine.games.values(), ...(await poller.getSchedule(7))]) {
      if (g.league !== league) continue;
      for (const t of [g.home, g.away]) seen.set(t.abbr, { abbr: t.abbr, name: t.display_name, logo: t.logo, options: t.options });
    }
    return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
  });

  app.get("/api/teams/:league/:abbr", async (req) => {
    const { league, abbr } = req.params as { league: string; abbr: string };
    return store.getTeamOverride(league, abbr) ?? {};
  });
  app.put("/api/teams/:league/:abbr", async (req, reply) => {
    const { league, abbr } = req.params as { league: string; abbr: string };
    if (!LEAGUES.some((l) => l.id === league) || !ABBR_RE.test(abbr)) return reply.code(400).send({ error: "bad league/abbr" });
    const parsed = TeamOverrideSchema.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: `${firstIssue(parsed.error)} (colours are {r,g,b} 0-255)` });
    const clean = parsed.data;
    store.setTeamOverride(league, abbr, clean);
    engine.invalidateOverrides();
    return clean;
  });

  app.get("/api/devices", async () => store.getDevices().map((d) => ({ ...d, supports_color: supportsColor(d) })));
  app.get("/api/actions", async () => store.getActions());
  app.put("/api/actions", async (req, reply) => {
    const parsed = ActionListSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: `invalid actions: ${firstIssue(parsed.error)}` });
    const out: LightAction[] = [];
    for (const raw of parsed.data) {
      const a = migrateAction(raw);
      if (a.effect === "light_effect" && !a.light_effect?.trim()) return reply.code(400).send({ error: `action ${a.id}: light_effect needs the effect name` });
      a.duration = Math.min(300, Math.max(0.5, a.duration || 3));
      a.speed = Math.min(10, Math.max(1, Math.round(a.speed || 5)));
      out.push(a);
    }
    store.setActions(out);
    return out;
  });

  app.post("/api/ha/test", async () => ha.test());

  // ---- horns ----
  const hornDir = (league: string) => path.join(MEDIA_DIR, "horns", league);
  const hornFileList = () => {
    const out: { league: string; abbr: string; file: string }[] = [];
    for (const l of LEAGUES) {
      const dir = hornDir(l.id);
      if (!fs.existsSync(dir)) continue;
      for (const f of fs.readdirSync(dir)) if (f.endsWith(".mp3")) out.push({ league: l.id, abbr: f.slice(0, -4), file: path.join(dir, f) });
    }
    return out;
  };
  app.get("/api/horns", async () => {
    const out: { league: string; abbr: string; url: string; size: number; duration_s: number | null; processed: boolean; trimmed: boolean }[] = [];
    for (const h of hornFileList()) {
      out.push({ league: h.league, abbr: h.abbr, url: `/media/horns/${h.league}/${h.abbr}.mp3`, size: fs.statSync(h.file).size, ...(await horns.describe(h.league, h.abbr)) });
    }
    return out;
  });

  const hornTarget = (p: { league: string; abbr: string }) => {
    if (!LEAGUES.some((l) => l.id === p.league)) return undefined;
    const abbr = p.abbr.toLowerCase() === "default" ? "default" : p.abbr.toUpperCase();
    if (abbr !== "default" && !ABBR_RE.test(abbr)) return undefined;
    return path.join(hornDir(p.league), `${abbr}.mp3`);
  };

  app.post("/api/horns/:league/:abbr", async (req, reply) => {
    const target = hornTarget(req.params as { league: string; abbr: string });
    if (!target) return reply.code(400).send({ error: "bad league/abbr" });
    const file = await req.file();
    if (!file) return reply.code(400).send({ error: "multipart field `file` required" });
    const buf = await file.toBuffer(); // throws on > MAX_HORN_BYTES
    if (file.file.truncated) return reply.code(413).send({ error: "file too large (10 MB max)" });
    if (!looksLikeMp3(buf)) return reply.code(415).send({ error: "not an MP3 file" });
    await fs.promises.mkdir(path.dirname(target), { recursive: true });
    await fs.promises.writeFile(target, buf);
    warmHorns();
    return { ok: true, size: buf.length };
  });

  app.delete("/api/horns/:league/:abbr", async (req, reply) => {
    const target = hornTarget(req.params as { league: string; abbr: string });
    if (!target) return reply.code(400).send({ error: "bad league/abbr" });
    if (fs.existsSync(target)) fs.unlinkSync(target);
    return { ok: true };
  });

  // ================= static: horns + web build =================
  warmHorns();
  fs.mkdirSync(path.join(MEDIA_DIR, "horns"), { recursive: true });
  // horns go through the processing layer (trim/fade/normalise, cached); everything else under /media is plain static
  app.get("/media/horns/:league/:file", async (req, reply) => {
    const { league, file } = req.params as { league: string; file: string };
    const m = /^(default|[A-Za-z0-9]{1,8})\.mp3$/.exec(file);
    const abbr = m?.[1];
    if (!abbr || !LEAGUES.some((l) => l.id === league)) return reply.code(404).send({ error: "not found" });
    const r = await horns.resolve(league, abbr);
    if (!r) return reply.code(404).send({ error: "not found" });
    try { return await sendAudio(req, reply, r.file, r.etag); }
    catch (e) {
      // the processed file vanished between resolve and send: the original is always a valid answer
      const orig = horns.sourcePath(league, abbr);
      if (!r.processed || !fs.existsSync(orig)) throw e;
      const st = fs.statSync(orig);
      return await sendAudio(req, reply, orig, `W/"${st.size}-${Math.round(st.mtimeMs)}"`);
    }
  });
  await app.register(fastifyStatic, { root: MEDIA_DIR, prefix: "/media/", decorateReply: false, index: false });
  if (fs.existsSync(d.webDir)) {
    await app.register(fastifyStatic, { root: d.webDir, prefix: "/", wildcard: false });
    app.setNotFoundHandler((req, reply) => {
      if (req.method !== "GET" || /^\/(api|media|app|auth|integrations|requests)\b/.test(req.url)) return reply.code(404).send({ error: "not found" });
      return reply.sendFile("index.html");
    });
  } else {
    app.get("/", async () => ({ name: "homeroom", note: `web build not found at ${d.webDir}; run the web build or use the Docker image` }));
  }

  return app;
}
