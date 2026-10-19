import { createRequire } from "node:module";
import type { DatabaseSync as DatabaseSyncType } from "node:sqlite";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { LEAGUES } from "./leagues.js";
import { validDelay } from "./engine/delay.js";
import { MEDIA_PLAYER_RE } from "./outputs/horn_volume.js";
import type { LightAction, Settings } from "./types.js";

// vite (vitest) does not know `node:sqlite` is a builtin yet, so load it at runtime
const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite");

export const DATA_DIR = process.env.DATA_DIR ?? path.resolve("data");
export const MEDIA_DIR = process.env.MEDIA_DIR ?? path.resolve("media");

export const DEFAULT_SETTINGS: Settings = {
  delay_global_s: 0,
  delay_by_game: {},
  poll_idle_s: 1800,
  poll_live_s: 2.5,
  nhl_fast_poll_ms: 1000,
  enabled_leagues: LEAGUES.filter((l) => !l.optIn).map((l) => l.id),
  grid_leagues: ["nhl", "nfl", "nba", "mlb"],
  public_base_url: process.env.PUBLIC_BASE_URL ?? "",
  horn_scope: "favorites",
  horn_max_s: 30,
  horn_fade_ms: 1500,
  horn_normalize: false,
  tts_enabled: true,
  my_team_only: false,
  automations_enabled: true,
  auto_sync_favorites: true,
  sync_excluded: [],
  delay_by_league: {},
  ha: { url: "", token: "", fire_rest_events: false },
  horn_volume: null,
  horn_players: [],
};

export interface LinkRow {
  api_key: string;
  unique_id: string;
  websocket_key: string;
  integration_key: string;
}

export class Store {
  db: DatabaseSyncType;

  constructor(file = path.join(DATA_DIR, "homeroom.db")) {
    if (file !== ":memory:") fs.mkdirSync(path.dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    this.db.exec(`
      PRAGMA journal_mode=WAL;
      CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS sync_games (game_id TEXT PRIMARY KEY);
      CREATE TABLE IF NOT EXISTS favorites (league TEXT, abbr TEXT, PRIMARY KEY (league, abbr));
      CREATE TABLE IF NOT EXISTS links (api_key TEXT PRIMARY KEY, unique_id TEXT, websocket_key TEXT, integration_key TEXT);
      CREATE TABLE IF NOT EXISTS devices (entity_id TEXT PRIMARY KEY, json TEXT NOT NULL, integration_key TEXT);
      CREATE TABLE IF NOT EXISTS team_overrides (league TEXT, abbr TEXT, json TEXT, PRIMARY KEY (league, abbr));
      CREATE TABLE IF NOT EXISTS emitted (key TEXT PRIMARY KEY, at INTEGER);
      CREATE TABLE IF NOT EXISTS pending_events (event_id TEXT PRIMARY KEY, game_id TEXT NOT NULL, release_at INTEGER NOT NULL, json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS shown_games (game_id TEXT PRIMARY KEY, saved_at INTEGER NOT NULL, json TEXT NOT NULL);
    `);
  }

  private kvGet<T>(key: string): T | undefined {
    const row = this.db.prepare("SELECT value FROM kv WHERE key=?").get(key) as { value: string } | undefined;
    return row ? (JSON.parse(row.value) as T) : undefined;
  }
  private kvSet(key: string, v: unknown): void {
    this.db.prepare("INSERT INTO kv(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(key, JSON.stringify(v));
  }

  // ---- settings
  getSettings(): Settings {
    const saved = this.kvGet<Partial<Settings>>("settings") ?? {};
    const s = { ...DEFAULT_SETTINGS, ...saved, ha: { ...DEFAULT_SETTINGS.ha, ...(saved.ha ?? {}) } };
    if (!s.public_base_url) s.public_base_url = DEFAULT_SETTINGS.public_base_url;
    return s;
  }
  /** Returns an error string, or undefined when applied. */
  patchSettings(patch: Partial<Settings>): string | undefined {
    if (patch.delay_global_s !== undefined && !validDelay(patch.delay_global_s)) return "delay_global_s must be 0..120 in 0.5 steps";
    if (patch.delay_by_game) {
      for (const [k, v] of Object.entries(patch.delay_by_game)) if (!validDelay(v)) return `delay_by_game[${k}] must be 0..120 in 0.5 steps`;
    }
    if (patch.delay_by_league) {
      for (const [k, v] of Object.entries(patch.delay_by_league)) {
        if (!LEAGUES.some((l) => l.id === k)) return `delay_by_league: unknown league ${k}`;
        if (!validDelay(v)) return `delay_by_league[${k}] must be 0..120 in 0.5 steps`;
      }
    }
    for (const k of ["my_team_only", "automations_enabled", "auto_sync_favorites", "tts_enabled"] as const) {
      if (patch[k] !== undefined && typeof patch[k] !== "boolean") return `${k} must be a boolean`;
    }
    if (patch.sync_excluded !== undefined && (!Array.isArray(patch.sync_excluded) || patch.sync_excluded.some((x) => typeof x !== "string"))) {
      return "sync_excluded must be string[]";
    }
    if (patch.enabled_leagues !== undefined || patch.grid_leagues !== undefined) {
      for (const list of [patch.enabled_leagues, patch.grid_leagues]) {
        if (list !== undefined && (!Array.isArray(list) || list.some((id) => !LEAGUES.some((l) => l.id === id)))) return "league lists must contain known league ids";
      }
    }
    for (const k of ["poll_idle_s", "poll_live_s", "nhl_fast_poll_ms"] as const) {
      const v = patch[k];
      if (v !== undefined && !(typeof v === "number" && v > 0)) return `${k} must be a positive number`;
    }
    if (patch.poll_live_s !== undefined && patch.poll_live_s < 1) return "poll_live_s must be >= 1";
    if (patch.nhl_fast_poll_ms !== undefined && patch.nhl_fast_poll_ms < 250) return "nhl_fast_poll_ms must be >= 250";
    if (patch.horn_volume !== undefined && patch.horn_volume !== null && !(typeof patch.horn_volume === "number" && patch.horn_volume >= 0 && patch.horn_volume <= 1)) {
      return "horn_volume must be a number between 0 and 1, or null to leave the volume alone";
    }
    if (patch.horn_scope !== undefined && !["favorites", "all", "home"].includes(patch.horn_scope)) return "horn_scope must be favorites, all or home";
    if (patch.horn_max_s !== undefined && patch.horn_max_s !== null && !(typeof patch.horn_max_s === "number" && Number.isFinite(patch.horn_max_s) && patch.horn_max_s >= 2 && patch.horn_max_s <= 120)) {
      return "horn_max_s must be a number between 2 and 120, or null for no limit";
    }
    if (patch.horn_fade_ms !== undefined && !(typeof patch.horn_fade_ms === "number" && Number.isFinite(patch.horn_fade_ms) && patch.horn_fade_ms >= 0 && patch.horn_fade_ms <= 5000)) {
      return "horn_fade_ms must be a number between 0 and 5000";
    }
    if (patch.horn_normalize !== undefined && typeof patch.horn_normalize !== "boolean") return "horn_normalize must be a boolean";
    if (patch.horn_players !== undefined) {
      const l = patch.horn_players;
      if (!Array.isArray(l) || l.length > 20 || l.some((e) => typeof e !== "string" || !MEDIA_PLAYER_RE.test(e))) return "horn_players must be up to 20 media_player.* entity ids";
    }
    const cur = this.getSettings();
    this.kvSet("settings", { ...cur, ...patch, ha: { ...cur.ha, ...(patch.ha ?? {}) } });
    return undefined;
  }

  // ---- sync + favorites
  getSyncedGames(): string[] {
    return (this.db.prepare("SELECT game_id FROM sync_games").all() as { game_id: string }[]).map((r) => r.game_id);
  }
  setSyncedGames(ids: string[]): void {
    this.db.exec("DELETE FROM sync_games");
    const st = this.db.prepare("INSERT OR IGNORE INTO sync_games(game_id) VALUES(?)");
    for (const id of ids) st.run(id);
  }
  getFavorites(): { league: string; abbr: string }[] {
    return this.db.prepare("SELECT league, abbr FROM favorites").all() as { league: string; abbr: string }[];
  }
  setFavorites(f: { league: string; abbr: string }[]): void {
    this.db.exec("DELETE FROM favorites");
    const st = this.db.prepare("INSERT OR IGNORE INTO favorites(league,abbr) VALUES(?,?)");
    for (const x of f) st.run(x.league, x.abbr.toUpperCase());
  }

  // ---- HA integration links (one stable identity per api key)
  link(apiKey: string): LinkRow {
    const row = this.db.prepare("SELECT * FROM links WHERE api_key=?").get(apiKey) as LinkRow | undefined;
    if (row) return row;
    const fresh: LinkRow = {
      api_key: apiKey,
      unique_id: randomBytes(8).toString("hex"),
      websocket_key: randomBytes(16).toString("hex"),
      integration_key: randomBytes(8).toString("hex"),
    };
    this.db.prepare("INSERT INTO links VALUES(?,?,?,?)").run(fresh.api_key, fresh.unique_id, fresh.websocket_key, fresh.integration_key);
    return fresh;
  }
  linkByApiKey(k: string): LinkRow | undefined {
    return this.db.prepare("SELECT * FROM links WHERE api_key=?").get(k) as LinkRow | undefined;
  }
  linkByWebsocketKey(k: string): LinkRow | undefined {
    return this.db.prepare("SELECT * FROM links WHERE websocket_key=?").get(k) as LinkRow | undefined;
  }
  allLinks(): LinkRow[] {
    return this.db.prepare("SELECT * FROM links").all() as unknown as LinkRow[];
  }

  // ---- devices synced from HA
  replaceDevices(integrationKey: string, devices: Record<string, unknown>[]): void {
    this.db.prepare("DELETE FROM devices WHERE integration_key=?").run(integrationKey);
    const st = this.db.prepare("INSERT OR REPLACE INTO devices(entity_id,json,integration_key) VALUES(?,?,?)");
    for (const d of devices) if (typeof d.entity_id === "string") st.run(d.entity_id, JSON.stringify(d), integrationKey);
  }
  getDevices(): (Record<string, unknown> & { entity_id: string; integration_key: string })[] {
    return (this.db.prepare("SELECT json, integration_key FROM devices").all() as { json: string; integration_key: string }[]).map((r) => ({
      ...JSON.parse(r.json),
      integration_key: r.integration_key,
    }));
  }

  // ---- light actions
  getActions(): LightAction[] {
    return (this.kvGet<LightAction[]>("actions") ?? []).map(migrateAction);
  }
  setActions(a: LightAction[]): void {
    this.kvSet("actions", a);
  }

  // ---- team colour overrides
  getTeamOverride(league: string, abbr: string): Record<string, unknown> | undefined {
    const r = this.db.prepare("SELECT json FROM team_overrides WHERE league=? AND abbr=?").get(league, abbr.toUpperCase()) as { json: string } | undefined;
    return r ? JSON.parse(r.json) : undefined;
  }
  setTeamOverride(league: string, abbr: string, v: Record<string, unknown>): void {
    this.db.prepare("INSERT INTO team_overrides VALUES(?,?,?) ON CONFLICT(league,abbr) DO UPDATE SET json=excluded.json").run(league, abbr.toUpperCase(), JSON.stringify(v));
  }

  // ---- delay buffer persistence (survive a restart; see Engine.restore)
  savePending(eventId: string, gameId: string, releaseAt: number, json: string): void {
    this.db.prepare("INSERT OR REPLACE INTO pending_events(event_id,game_id,release_at,json) VALUES(?,?,?,?)").run(eventId, gameId, releaseAt, json);
  }
  deletePending(eventId: string): void {
    this.db.prepare("DELETE FROM pending_events WHERE event_id=?").run(eventId);
  }
  /** oldest release time first, so per-game order is preserved on restore */
  listPending(): { event_id: string; game_id: string; release_at: number; json: string }[] {
    return this.db.prepare("SELECT event_id, game_id, release_at, json FROM pending_events ORDER BY release_at, rowid").all() as {
      event_id: string; game_id: string; release_at: number; json: string;
    }[];
  }
  saveShown(gameId: string, savedAt: number, json: string): void {
    this.db.prepare("INSERT OR REPLACE INTO shown_games(game_id,saved_at,json) VALUES(?,?,?)").run(gameId, savedAt, json);
  }
  listShown(): { game_id: string; saved_at: number; json: string }[] {
    return this.db.prepare("SELECT game_id, saved_at, json FROM shown_games").all() as { game_id: string; saved_at: number; json: string }[];
  }
  deleteShown(gameId: string): void {
    this.db.prepare("DELETE FROM shown_games WHERE game_id=?").run(gameId);
  }

  // ---- idempotency for emitted events
  /** true if newly recorded, false if already seen */
  markEmitted(key: string): boolean {
    const r = this.db.prepare("INSERT OR IGNORE INTO emitted(key,at) VALUES(?,?)").run(key, Date.now());
    return Number(r.changes) > 0;
  }
  pruneEmitted(olderThanMs = 7 * 864e5): void {
    this.db.prepare("DELETE FROM emitted WHERE at < ?").run(Date.now() - olderThanMs);
  }
}

const LEGACY_ON: Record<string, string> = {
  goal: "any_score",
  game_start: "game_start",
  game_end: "game_end",
  period_start: "period_start",
  period_end: "period_end",
};

/** Actions saved before triggers existed carry `on: EventType[]`; map them to trigger ids once, on read. */
export function migrateAction(a: LightAction): LightAction {
  if (a.triggers) return a;
  const { on, ...rest } = a;
  return { ...rest, triggers: (on ?? []).map((t) => LEGACY_ON[t] ?? t) };
}
