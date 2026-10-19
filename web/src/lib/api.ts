import type { Calibration, Device, EventRecord, Game, GameLite, Horn, League, LightAction, Settings, SettingsPatch, Status, SyncState, TeamInfo, Trigger } from "../types";
import { isMockUrl } from "./live";
import { MOCK_SETTINGS, mockSchedule } from "./mock";

const TOKEN_KEY = "homeroom.admin_token";
export const getAdminToken = () => { try { return localStorage.getItem(TOKEN_KEY) ?? ""; } catch { return ""; } };
export const setAdminToken = (v: string) => { try { localStorage.setItem(TOKEN_KEY, v); } catch { /* ignore */ } };

export class ApiError extends Error {
  constructor(public status: number, msg: string) { super(msg); }
}

async function req<T>(method: string, path: string, body?: unknown, form?: FormData): Promise<T> {
  const headers: Record<string, string> = {};
  const tok = getAdminToken();
  if (tok) headers.Authorization = `Bearer ${tok}`;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const r = await fetch(path, { method, headers, body: form ?? (body !== undefined ? JSON.stringify(body) : undefined) });
  if (!r.ok) {
    let msg = r.statusText;
    try { const j = await r.json(); msg = j.error ?? j.message ?? msg; } catch { /* ignore */ }
    if (r.status === 401) msg = getAdminToken() ? "Unauthorized: the admin token was not accepted. Check the “Admin token” field at the top of the page." : "Unauthorized: this server requires an admin token. Enter it in the “Admin token” field at the top of the page.";
    throw new ApiError(r.status, msg || `HTTP ${r.status}`);
  }
  const text = await r.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

// --- mock-mode in-memory backend so the dashboard is usable without a server ---
const mem = {
  settings: structuredClone(MOCK_SETTINGS) as Settings,
  sync: { games: ["nhl:m1"], favorites: [{ league: "nhl", abbr: "MIN" }] } as SyncState,
  horns: [{ league: "nhl", abbr: "default", url: "" }, { league: "nhl", abbr: "MIN", url: "" }] as Horn[],
  actions: [
    { id: "a1", enabled: true, triggers: ["goal"], team_scope: "favorites", entities: ["light.living_room"], effect: "alternate", duration: 8, speed: 5, colors: "team", restore: true },
  ] as LightAction[],
};
const mockDevices: Device[] = [
  { entity_id: "light.living_room", name: "Living room", device_class: "light", supports_color: true, capabilities: { effect_list: ["rainbow", "pulse"] }, supports_flash_speed: true, supports_flash_duration: true, supports_alternate_speed: true, supports_alternate_duration: true },
  { entity_id: "light.tv_strip", name: "TV strip", device_class: "light", supports_color: false, supports_flash_duration: true, capabilities: { supported_color_modes: ["color_temp"] } },
  { entity_id: "switch.horn_siren", name: "Siren plug", device_class: "switch" },
];
const mockLeagues: League[] = ["nhl", "nfl", "nba", "mlb", "epl"].map((id) => ({ id, name: id.toUpperCase() }));

function mock<T>(method: string, path: string, body?: unknown): T {
  const p = path.split("?")[0];
  if (p === "/api/schedule") return mockSchedule() as T;
  if (p === "/api/leagues") return mockLeagues as T;
  if (p === "/api/sync") { if (method === "PUT") mem.sync = { ...mem.sync, ...(body as Partial<SyncState>) }; return mem.sync as T; }
  if (p === "/api/settings") { if (method === "PUT") mem.settings = { ...mem.settings, ...(body as Partial<Settings>) }; return mem.settings as T; }
  if (p === "/api/devices") return mockDevices as T;
  if (p === "/api/actions") { if (method === "PUT") mem.actions = body as LightAction[]; return mem.actions as T; }
  if (p.startsWith("/api/teams/")) {
    const l = p.split("/")[3];
    const ab: Record<string, string[]> = { nhl: ["MIN", "CBJ", "BOS", "TOR", "EDM", "VAN"], nfl: ["GB", "CHI", "DAL", "PHI"], nba: ["LAL", "BOS", "MIA", "NYK"], mlb: ["NYY", "BOS", "LAD", "SF"], epl: ["ARS", "MCI"] };
    return (ab[l] ?? []).map((abbr) => ({ abbr, name: abbr })) as T;
  }
  if (p === "/api/triggers") return [{ id: "any_score", label: "Any score" }, { id: "goal", label: "Goal", sports: ["hockey", "soccer"] }, { id: "touchdown", label: "Touchdown", sports: ["football"] }, { id: "game_end", label: "Game end" }] as T;
  if (p === "/api/status") return { version: "mock", uptime_s: 60, games: { tracked: 3, live: 1, synced: 1 }, integration: { links: [], devices: 0 }, outputs: { rest_events: false, pusher_connected: false }, horns: { files: 0, url_check: { ok: null, detail: "mock" } }, public_base_url: "", flags: { my_team_only: false, automations_enabled: true, auto_sync_favorites: true }, warnings: ["Mock mode: no server."], server_time: Date.now(), providers: [{ id: "espn:nhl", last_success_at: Date.now() - 2000, last_attempt_at: Date.now() - 2000, last_error: null, last_error_at: null, consecutive_failures: 0, failing_since: null, live_relevant: true, state: "ok" }, { id: "nhl", last_success_at: Date.now() - 1000, last_attempt_at: Date.now() - 1000, last_error: null, last_error_at: null, consecutive_failures: 0, failing_since: null, live_relevant: true, state: "ok" }] } as T;
  if (p === "/api/events/recent" || p === "/api/games/raw") return [] as T;
  if (p === "/api/trigger") return { ok: true, event: { type: "goal" } } as T;
  if (p === "/api/horns") return mem.horns as T;
  if (p === "/api/ha/test") return { ok: true, message: "mock: ok" } as T;
  return {} as T;
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  if (isMockUrl()) { await new Promise((r) => setTimeout(r, 120)); return mock<T>(method, path, body); }
  return req<T>(method, path, body);
}

/** Tolerant unwrap: accept either a bare array or {key:[...]}. */
const arr = <T,>(v: unknown, key: string): T[] =>
  Array.isArray(v) ? (v as T[]) : Array.isArray((v as Record<string, unknown>)?.[key]) ? ((v as Record<string, T[]>)[key]) : [];

export const api = {
  schedule: (days = 7) => call<{ days: { date: string; games: GameLite[] }[] }>("GET", `/api/schedule?days=${days}`),
  leagues: async () => arr<League>(await call("GET", "/api/leagues"), "leagues"),
  sync: () => call<SyncState>("GET", "/api/sync"),
  putSync: (s: Partial<SyncState>) => call<SyncState>("PUT", "/api/sync", s),
  settings: () => call<Settings>("GET", "/api/settings"),
  putSettings: (s: SettingsPatch) => call<Settings>("PUT", "/api/settings", s),
  triggers: async () => arr<Trigger>(await call("GET", "/api/triggers"), "triggers"),
  trigger: (b: { trigger: string; league?: string; team_abbr?: string; game_id?: string; apply_delay?: boolean }) => call<{ ok: boolean; event?: { type?: string; event_id?: string } }>("POST", "/api/trigger", b),
  status: () => call<Status>("GET", "/api/status"),
  recentEvents: async (n = 50) => arr<EventRecord>(await call("GET", `/api/events/recent?n=${n}`), "events"),
  gamesRaw: async () => arr<Game>(await call("GET", "/api/games/raw"), "games"),
  calibrate: (b: { game_id: string; tv_period: number; tv_clock: string }) => call<Calibration>("POST", "/api/calibrate", b),
  haTest: () => call<{ ok?: boolean; success?: boolean; message?: string; error?: string }>("POST", "/api/ha/test"),
  teams: async (league: string) => arr<TeamInfo>(await call("GET", `/api/teams/${encodeURIComponent(league)}`), "teams"),
  devices: async () => arr<Device>(await call("GET", "/api/devices"), "devices"),
  actions: async () => arr<LightAction>(await call("GET", "/api/actions"), "actions"),
  putActions: (a: LightAction[]) => call<unknown>("PUT", "/api/actions", a),
  horns: async () => arr<Horn>(await call("GET", "/api/horns"), "horns"),
  uploadHorn: async (league: string, abbr: string, file: File) => {
    if (isMockUrl()) { mem.horns = [...mem.horns.filter((h) => !(h.league === league && h.abbr === abbr)), { league, abbr, url: URL.createObjectURL(file) }]; return; }
    const f = new FormData(); f.append("file", file);
    await req("POST", `/api/horns/${encodeURIComponent(league)}/${encodeURIComponent(abbr)}`, undefined, f);
  },
  deleteHorn: async (league: string, abbr: string) => {
    if (isMockUrl()) { mem.horns = mem.horns.filter((h) => !(h.league === league && h.abbr === abbr)); return; }
    await req("DELETE", `/api/horns/${encodeURIComponent(league)}/${encodeURIComponent(abbr)}`);
  },
};

export const hornUrl = (h: Horn) => h.url || `/media/horns/${h.league}/${h.abbr}.mp3`;
