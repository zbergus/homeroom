import type { Calibration, CelebrationVideo, Device, EventRecord, Game, GameLite, HockeyBoxscore, Horn, League, LightAction, RosterPlayer, Settings, SettingsPatch, Status, SyncState, TeamInfo, Trigger } from "../types";
import { isMockUrl } from "./live";

const TOKEN_KEY = "homeroom.admin_token";
export const getAdminToken = () => { try { return localStorage.getItem(TOKEN_KEY) ?? ""; } catch { return ""; } };
export const setAdminToken = (v: string) => { try { localStorage.setItem(TOKEN_KEY, v); } catch { /* ignore */ } };

export class ApiError extends Error {
  constructor(public status: number, msg: string) { super(msg); }
}

async function req<T>(method: string, path: string, body?: unknown | undefined, form?: FormData): Promise<T> {
  const headers: Record<string, string> = {};
  const tok = getAdminToken();
  if (tok) headers.Authorization = `Bearer ${tok}`;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const payload = form ?? (body !== undefined ? JSON.stringify(body) : undefined);
  const r = await fetch(path, { method, headers, ...(payload === undefined ? {} : { body: payload }) });
  if (!r.ok) {
    let msg = r.statusText;
    try { const j = await r.json(); msg = j.error ?? j.message ?? msg; } catch { /* ignore */ }
    if (r.status === 401) msg = getAdminToken() ? "Unauthorized: the admin token was not accepted. Check the “Admin token” field at the top of the page." : "Unauthorized: this server requires an admin token. Enter it in the “Admin token” field at the top of the page.";
    throw new ApiError(r.status, msg || `HTTP ${r.status}`);
  }
  const text = await r.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  // the in-memory mock backend (?mock=1) is its own chunk: it is never downloaded in normal use
  if (isMockUrl()) return (await import("./mockApi")).mockCall<T>(method, path, body);
  return req<T>(method, path, body);
}

/** Tolerant unwrap: accept either a bare array or {key:[...]}. */
const arr = <T,>(v: unknown, key: string): T[] => {
  if (Array.isArray(v)) return v as T[];
  const inner = typeof v === "object" && v !== null ? (v as Record<string, unknown>)[key] : undefined;
  return Array.isArray(inner) ? (inner as T[]) : [];
};

export const api = {
  schedule: (days = 7) => call<{ days: { date: string; games: GameLite[] }[] }>("GET", `/api/schedule?days=${days}`),
  leagues: async () => arr<League>(await call("GET", "/api/leagues"), "leagues"),
  sync: () => call<SyncState>("GET", "/api/sync"),
  putSync: (s: Partial<SyncState>) => call<SyncState>("PUT", "/api/sync", s),
  settings: () => call<Settings>("GET", "/api/settings"),
  putSettings: (s: SettingsPatch) => call<Settings>("PUT", "/api/settings", s),
  triggers: async () => arr<Trigger>(await call("GET", "/api/triggers"), "triggers"),
  trigger: (b: { trigger: string; league?: string | undefined; team_abbr?: string | undefined; game_id?: string | undefined; apply_delay?: boolean | undefined }) =>
    call<{ ok: boolean; event?: { type?: string | undefined; event_id?: string | undefined; natural_text?: string | undefined } }>("POST", "/api/trigger", b),
  simulation: () => call<{ active: boolean; game_id?: string | undefined; started_at?: number | undefined; ends_at?: number | undefined; step_index?: number | undefined }>("GET", "/api/simulation"),
  simulationStart: () => call<{ active: boolean; game_id: string; ends_at: number }>("POST", "/api/simulation/start"),
  simulationStop: () => call<{ active: boolean }>("POST", "/api/simulation/stop"),
  status: () => call<Status>("GET", "/api/status"),
  recentEvents: async (n = 50) => arr<EventRecord>(await call("GET", `/api/events/recent?n=${n}`), "events"),
  gamesRaw: async () => arr<Game>(await call("GET", "/api/games/raw"), "games"),
  boxscore: (id: string) => call<HockeyBoxscore>("GET", `/api/games/${encodeURIComponent(id)}/boxscore`),
  calibrate: (b: { game_id: string; tv_period: number; tv_clock: string; elapsed_ms?: number | undefined }) => call<Calibration>("POST", "/api/calibrate", b),
  haTest: () => call<{ ok?: boolean | undefined; success?: boolean | undefined; message?: string | undefined; error?: string | undefined; sync?: { lights: number; media_players: number; tts_engines: number } | undefined }>("POST", "/api/ha/test"),
  haSync: () => call<{ ok: boolean; lights: number; media_players: number; tts_engines: number; error?: string | undefined }>("POST", "/api/ha/sync"),
  clearHaLinks: () => call<{ ok: boolean }>("POST", "/api/ha/links/clear"),
  entities: () => call<{ lights: Device[]; media_players: Device[]; tts_engines: Device[] }>("GET", "/api/entities"),
  teams: async (league: string) => arr<TeamInfo>(await call("GET", `/api/teams/${encodeURIComponent(league)}`), "teams"),
  roster: async (league: string, abbr: string) => arr<RosterPlayer>(await call("GET", `/api/teams/${encodeURIComponent(league)}/${encodeURIComponent(abbr)}/roster`), "players"),
  devices: async () => arr<Device>(await call("GET", "/api/devices"), "devices"),
  actions: async () => arr<LightAction>(await call("GET", "/api/actions"), "actions"),
  putActions: (a: LightAction[]) => call<unknown>("PUT", "/api/actions", a),
  horns: async () => arr<Horn>(await call("GET", "/api/horns"), "horns"),
  uploadHorn: async (league: string, abbr: string, file: File) => {
    if (isMockUrl()) return (await import("./mockApi")).mockUploadHorn(league, abbr, file);
    const f = new FormData(); f.append("file", file);
    await req("POST", `/api/horns/${encodeURIComponent(league)}/${encodeURIComponent(abbr)}`, undefined, f);
  },
  deleteHorn: async (league: string, abbr: string) => {
    if (isMockUrl()) return (await import("./mockApi")).mockDeleteHorn(league, abbr);
    await req("DELETE", `/api/horns/${encodeURIComponent(league)}/${encodeURIComponent(abbr)}`);
  },
  celebrations: async () => arr<CelebrationVideo>(await call("GET", "/api/celebrations"), "celebrations"),
  uploadCelebration: async (league: string, abbr: string, playerId: string, file: File) => {
    if (isMockUrl()) return (await import("./mockApi")).mockUploadCelebration(league, abbr, playerId, file);
    const f = new FormData(); f.append("file", file);
    await req("POST", celebrationPath(league, abbr, playerId), undefined, f);
  },
  importCelebration: async (league: string, abbr: string, playerId: string, url: string) => {
    if (isMockUrl()) return (await import("./mockApi")).mockImportCelebration(league, abbr, playerId, url);
    await req("POST", `${celebrationPath(league, abbr, playerId)}/import`, { url });
  },
  deleteCelebration: async (v: CelebrationVideo) => {
    if (isMockUrl()) return (await import("./mockApi")).mockDeleteCelebration(v);
    await req("DELETE", celebrationPath(v.league, v.abbr, v.player_id));
  },
};

export const hornUrl = (h: Horn) => h.url || `/media/horns/${h.league}/${h.abbr}.mp3`;
const celebrationPath = (league: string, abbr: string, playerId: string) =>
  `/api/celebrations/${[league, abbr, playerId].map(encodeURIComponent).join("/")}`;
