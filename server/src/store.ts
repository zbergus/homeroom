import { createRequire } from "node:module";
import type { DatabaseSync as DatabaseSyncType } from "node:sqlite";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { LEAGUES } from "./leagues.js";
import { firstIssue, SettingsPatchSchema } from "./schemas.js";
import type { LightAction, Settings } from "./types.js";

// vite (vitest) does not know `node:sqlite` is a builtin yet, so load it at runtime
const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite");

export const DATA_DIR = process.env.DATA_DIR ?? path.resolve("data");
export const MEDIA_DIR = process.env.MEDIA_DIR ?? path.resolve("media");

const DEFAULT_SETTINGS: Settings = {
  delay_global_s: 0,
  delay_by_game: {},
  poll_idle_s: 1800,
  poll_live_s: 2.5,
  nhl_fast_poll_ms: 1000,
  enabled_leagues: LEAGUES.filter((l) => !l.optIn).map((l) => l.id),
  grid_leagues: ["nhl", "iihf", "ahl"],
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
  team_languages: { MTL: "fr" },
};

/** one home has one, maybe two, Home Assistant installs */
export const MAX_LINKS = 20;

interface LinkRow {
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
    const s = {
      ...DEFAULT_SETTINGS,
      ...saved,
      team_languages: { ...DEFAULT_SETTINGS.team_languages, ...(saved.team_languages ?? {}) },
      ha: { ...DEFAULT_SETTINGS.ha, ...(saved.ha ?? {}) },
    };
    if (!s.public_base_url) s.public_base_url = DEFAULT_SETTINGS.public_base_url;
    return s;
  }
  /**
   * Validates `input` (anything: it usually comes straight from a request body) and applies it.
   * Returns an error string, or undefined when applied. Keys that are not settings are dropped.
   */
  patchSettings(input: unknown): string | undefined {
    const parsed = SettingsPatchSchema.safeParse(input);
    if (!parsed.success) return firstIssue(parsed.error);
    const patch = parsed.data;
    const cur = this.getSettings();
    const ha = { ...cur.ha, ...patch.ha };
    // the token is bound to the URL it was issued for: pointing Homeroom somewhere else without a new token drops it,
    // so a changed URL can never be used to read the stored token back out
    if (patch.ha?.url !== undefined && patch.ha.url !== cur.ha.url && !patch.ha.token) ha.token = "";
    this.kvSet("settings", { ...cur, ...patch, ha });
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
  /** Returns undefined once MAX_LINKS installs are linked, so an open link endpoint cannot grow the table without bound. */
  link(apiKey: string): LinkRow | undefined {
    const row = this.db.prepare("SELECT * FROM links WHERE api_key=?").get(apiKey) as LinkRow | undefined;
    if (row) return row;
    if (this.allLinks().length >= MAX_LINKS) return undefined;
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
