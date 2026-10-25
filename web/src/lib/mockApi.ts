import type { CelebrationVideo, Device, Horn, League, LightAction, Settings, SyncState } from "../types";
import { MOCK_SETTINGS, mockHockeyBoxscore, mockSchedule } from "./mock";

// --- mock-mode in-memory backend so the dashboard is usable without a server ---
const mem = {
  settings: structuredClone(MOCK_SETTINGS) as Settings,
  sync: { games: ["nhl:m1"], favorites: [{ league: "nhl", abbr: "MIN" }] } as SyncState,
  horns: [{ league: "nhl", abbr: "default", url: "" }, { league: "nhl", abbr: "MIN", url: "" }] as Horn[],
  celebrations: [] as CelebrationVideo[],
  actions: [
    { id: "a1", enabled: true, triggers: ["goal"], team_scope: "favorites", entities: ["light.living_room"], effect: "alternate", duration: 8, speed: 5, colors: "team", restore: true },
  ] as LightAction[],
};
const mockDevices: Device[] = [
  { entity_id: "light.living_room", name: "Living room", device_class: "light", supports_color: true, capabilities: { effect_list: ["rainbow", "pulse"] }, supports_flash_speed: true, supports_flash_duration: true, supports_alternate_speed: true, supports_alternate_duration: true },
  { entity_id: "light.tv_strip", name: "TV strip", device_class: "light", supports_color: false, supports_flash_duration: true, capabilities: { supported_color_modes: ["color_temp"] } },
  { entity_id: "switch.horn_siren", name: "Siren plug", device_class: "switch" },
];
const mockLeagues: League[] = ["nhl", "iihf", "ahl"].map((id) => ({ id, name: id.toUpperCase() }));

function mock<T>(method: string, path: string, body?: unknown): T {
  const p = path.split("?")[0] ?? path;
  if (p === "/api/schedule") return mockSchedule() as T;
  if (p.startsWith("/api/games/") && p.endsWith("/boxscore")) {
    const rawId = p.replace(/^\/api\/games\//, "").replace(/\/boxscore$/, "");
    const gameId = decodeURIComponent(rawId);
    return mockHockeyBoxscore(gameId) as T;
  }
  if (p === "/api/leagues") return mockLeagues as T;
  if (p === "/api/sync") { if (method === "PUT") mem.sync = { ...mem.sync, ...(body as Partial<SyncState>) }; return mem.sync as T; }
  if (p === "/api/settings") { if (method === "PUT") mem.settings = { ...mem.settings, ...(body as Partial<Settings>) }; return mem.settings as T; }
  if (p === "/api/devices") return mockDevices as T;
  if (p === "/api/actions") { if (method === "PUT") mem.actions = body as LightAction[]; return mem.actions as T; }
  if (p.endsWith("/roster")) {
    return [
      { id: "nhl:8481559", name: "Cole Caufield", number: "22" },
      { id: "nhl:8480018", name: "Nick Suzuki", number: "14" },
      { id: "nhl:8483421", name: "Juraj Slafkovsky", number: "20" },
    ] as T;
  }
  if (p.startsWith("/api/teams/")) {
    const l = p.split("/")[3] ?? "";
    const ab: Record<string, string[]> = {
      nhl: ["MIN", "CBJ", "BOS", "TOR", "EDM", "VAN", "COL", "DAL", "SEA", "NJD"],
      iihf: ["USA", "CAN", "SWE", "FIN", "CZE", "SUI", "GER", "SVK"],
      ahl: ["HER", "CVF", "MIL", "PRO", "TEX", "ROC", "GRG", "SYR"],
    };
    return (ab[l] ?? []).map((abbr) => ({ abbr, name: abbr })) as T;
  }
  if (p === "/api/triggers") return [
    { id: "any_score", label: "Any score" },
    { id: "goal", label: "Goal" },
    { id: "ppg", label: "Power play goal" },
    { id: "shg", label: "Shorthanded goal" },
    { id: "powerplay", label: "Power play start" },
    { id: "game_end", label: "Game end" },
  ] as T;
  if (p === "/api/status") return { version: "mock", uptime_s: 60, games: { tracked: 3, live: 1, synced: 1 }, integration: { links: [], devices: 0 }, outputs: { rest_events: false, pusher_connected: false }, horns: { files: 0, url_check: { ok: null, detail: "mock" } }, public_base_url: "", flags: { my_team_only: false, automations_enabled: true, auto_sync_favorites: true }, simulation: { active: false }, warnings: ["Mock mode: no server."], server_time: Date.now(), providers: [{ id: "espn:nhl", last_success_at: Date.now() - 2000, last_attempt_at: Date.now() - 2000, last_error: null, last_error_at: null, consecutive_failures: 0, failing_since: null, live_relevant: true, state: "ok" }, { id: "nhl", last_success_at: Date.now() - 1000, last_attempt_at: Date.now() - 1000, last_error: null, last_error_at: null, consecutive_failures: 0, failing_since: null, live_relevant: true, state: "ok" }] } as T;
  if (p === "/api/events/recent") return [] as T;
  if (p === "/api/games/raw") return (mockSchedule().days[0]?.games ?? []) as T;
  if (p === "/api/trigger") return { ok: true, event: { type: "goal", natural_text: "Goal, City Wild! Test Player scores. Wild 1, Blue Jackets 0." } } as T;
  if (p === "/api/simulation") return { active: false } as T;
  if (p === "/api/simulation/start") return { active: true, game_id: "nhl:sim", ends_at: Date.now() + 600_000 } as T;
  if (p === "/api/simulation/stop") return { active: false } as T;
  if (p === "/api/horns") return mem.horns as T;
  if (p === "/api/celebrations") return mem.celebrations as T;
  if (p === "/api/ha/test") return { ok: true, message: "mock: ok" } as T;
  return {} as T;
}


/** Same shape as a real request, after a short pretend network delay. */
export async function mockCall<T>(method: string, path: string, body?: unknown): Promise<T> {
  await new Promise((r) => setTimeout(r, 120));
  return mock<T>(method, path, body);
}

export function mockUploadHorn(league: string, abbr: string, file: File): void {
  mem.horns = [...mem.horns.filter((h) => !(h.league === league && h.abbr === abbr)), { league, abbr, url: URL.createObjectURL(file) }];
}

export function mockDeleteHorn(league: string, abbr: string): void {
  mem.horns = mem.horns.filter((h) => !(h.league === league && h.abbr === abbr));
}

export function mockUploadCelebration(league: string, abbr: string, playerId: string, file: File): void {
  mockDeleteCelebration({ league, abbr, player_id: playerId, url: "" });
  mem.celebrations.push({ league, abbr, player_id: playerId, url: URL.createObjectURL(file) });
}

export function mockImportCelebration(league: string, abbr: string, playerId: string, url: string): void {
  mockDeleteCelebration({ league, abbr, player_id: playerId, url: "" });
  mem.celebrations.push({ league, abbr, player_id: playerId, url });
}

export function mockDeleteCelebration(v: CelebrationVideo): void {
  mem.celebrations = mem.celebrations.filter((c) => {
    if (c.league !== v.league || c.abbr !== v.abbr || c.player_id !== v.player_id) return true;
    URL.revokeObjectURL(c.url);
    return false;
  });
}
