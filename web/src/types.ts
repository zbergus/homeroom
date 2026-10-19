// API types mirroring SPEC.md sections 2, 3 and 4.4.
// Fields the SPEC leaves unspecified are marked "(assumed)".

export type RGB = { r: number; g: number; b: number };

export interface TeamOptions {
  primary_color_rgb?: RGB;
  secondary_color_rgb?: RGB;
  alternate_color_rgb?: RGB;
}

export interface Team {
  id: string;
  abbr: string;
  name: string;
  display_name: string;
  logo?: string;
  score?: number;
  /** overall record as ESPN prints it, e.g. "4-3-1" */
  record?: string;
  options?: TeamOptions;
}

export type GameStatus = "pre" | "in" | "post";

export type StatValue = number | string;

/** One scoring play inside Game.goals (shape assumed; SPEC only names "ScoringPlay"). */
export interface ScoringPlay {
  key?: string;
  period: number;
  period_label?: string;
  clock?: string;
  team_abbr?: string;
  team_id?: string;
  scorer?: string;
  assists?: string[];
  strength?: "ev" | "pp" | "sh" | "en" | string; // server normalises to ev | pp | sh | en
  tags?: string[];
  home_score: number;
  away_score: number;
}

/** One mirrored comparison row on a break screen / stats panel. */
export interface StatRow {
  key: string;
  label: string;
  home: string;
  away: string;
  home_n: number;
  away_n: number;
  lower_is_better?: boolean;
}

export interface FormGame {
  opp_abbr: string;
  opp_logo?: string;
  venue: "H" | "A";
  gf: number;
  ga: number;
  result: "W" | "L" | "OTL" | "T";
  date: string;
}

export interface TeamForm {
  record?: string;
  /** oldest first, up to 10 */
  games: FormGame[];
}

export interface PlayerWatch {
  id: string;
  name: string;
  first: string;
  last: string;
  jersey?: string;
  position?: string;
  headshot?: string;
  team_abbr: string;
  tiles: { label: string; value: string }[];
  /** oldest first; `value` is the plotted number */
  log: { opp_abbr: string; value: number }[];
  log_label: string;
}

/** Context for break screens and the scoreboard side panel. Every part is optional: hide what is missing. */
export interface Insight {
  form?: { home: TeamForm; away: TeamForm; rows: StatRow[] };
  players?: { home?: PlayerWatch; away?: PlayerWatch };
  updated_at: number;
}

export interface Game {
  id: string;
  league: string;
  sport: string;
  status: GameStatus;
  start_time: string | number; // ISO string or epoch seconds (assumed: either)
  period: number;
  period_label: string;
  clock: string;
  /** numeric clock for client-side interpolation between updates */
  clock_s?: number;
  clock_running?: boolean;
  clock_dir?: "down" | "up";
  intermission: boolean;
  home: Team;
  away: Team;
  linescores: { home: (number | string)[]; away: (number | string)[] };
  stats: { home: Record<string, StatValue>; away: Record<string, StatValue> };
  goals: ScoringPlay[];
  /** canonical comparison rows from the boxscore; prefer over `stats` when present */
  stat_rows?: StatRow[];
  insight?: Insight;
  odds?: unknown;
}

/** /api/schedule row (assumed: Game fields, possibly without live detail). */
export type GameLite = Pick<Game, "id" | "league" | "sport" | "status" | "start_time" | "home" | "away"> &
  Partial<Game>;

export type EventType = "goal" | "game_start" | "game_end" | "period_start" | "period_end";
/** informational, UI/REST only */
export type UiEventType = EventType | "goal_overturned";

export interface Scoring {
  label: string;
  scorer?: string;
  assists?: string[];
  strength?: string;
  delta: number;
  home_score: number;
  away_score: number;
}

export interface EventPayload {
  event_id: string;
  type: UiEventType;
  emitted_at: number;
  delay_s: number;
  league: string;
  sport: string;
  game: Pick<Game, "id" | "status" | "period" | "period_label" | "clock" | "home" | "away">;
  team?: Team;
  scoring?: Scoring;
  natural_text?: string;
  goal_horn?: string;
}

export interface League {
  id: string;
  name: string;
  sport?: string;
  enabled?: boolean;
}

export interface TeamRef { league: string; abbr: string }
/** GET/PUT /api/sync (shape confirmed by backend). */
export interface SyncState {
  /** games the user ticked */
  games: string[];
  favorites: TeamRef[];
  /** games that actually fire: ticked + auto-synced favourites, minus exclusions */
  effective?: string[];
}

export interface TeamInfo { abbr: string; name: string; logo?: string; options?: TeamOptions }

export interface HASettings {
  url: string;
  /** write-only: the server never returns it ("" on read) */
  token: string;
  token_set?: boolean;
  fire_rest_events: boolean;
}

export interface Settings {
  delay_global_s: number;
  delay_by_game: Record<string, number>;
  delay_by_league?: Record<string, number>;
  poll_idle_s?: number;
  poll_live_s?: number;
  nhl_fast_poll_ms?: number;
  ha: HASettings;
  enabled_leagues?: string[];
  grid_leagues?: string[];
  public_base_url: string;
  horn_scope?: "favorites" | "all" | "home";
  /** longest horn that plays, seconds (2..120); null = no limit */
  horn_max_s?: number | null;
  /** fade-out at the trim point, ms (0..5000); needs ffmpeg */
  horn_fade_ms?: number;
  /** loudness-normalise horns; needs ffmpeg */
  horn_normalize?: boolean;
  tts_enabled?: boolean;
  my_team_only?: boolean;
  automations_enabled?: boolean;
  auto_sync_favorites?: boolean;
  sync_excluded?: string[];
  /** goal-horn volume 0..1 set through HA's REST API around each horn; null/absent = off */
  horn_volume?: number | null;
  /** media_player.* entities the horn volume applies to */
  horn_players?: string[];
}

/** PUT /api/settings body: partial; ha.token only when changed, ha.clear_token removes it. */
export type SettingsPatch = Partial<Omit<Settings, "ha">> & { ha?: Partial<Omit<HASettings, "token_set">> & { clear_token?: boolean } };

export interface Trigger { id: string; label: string; sports?: string[] }

export interface EventRecord {
  at: number;
  event_id: string;
  type: string;
  league: string;
  game: string;
  team?: string;
  label?: string;
  triggers: string[];
  manual: boolean;
  delay_s: number;
  outcome: "delivered" | "filtered";
  reason?: string;
  sent: { pusher_clients: number; rest: boolean; lights: number };
}

export interface Status {
  version: string;
  uptime_s: number;
  games: { tracked: number; live: number; synced: number };
  integration: { links: { id: string; events_connected: boolean; devices_connected: boolean }[]; devices: number };
  outputs: { rest_events: boolean; pusher_connected: boolean };
  horns: { files: number; url_check: { ok: boolean | null; detail: string } };
  audio?: { ffmpeg: boolean; mode: "ffmpeg" | "truncate-only" };
  public_base_url: string;
  flags: { my_team_only: boolean; automations_enabled: boolean; auto_sync_favorites: boolean };
  warnings: string[];
  /** per-provider feed health (ESPN per league, NHL, summary, insight, schedule) */
  providers?: ProviderStatus[];
  /** server clock when this response was built, so ages do not depend on the browser's clock */
  server_time?: number;
}

export interface ProviderStatus {
  id: string;
  last_success_at: number | null;
  last_attempt_at: number | null;
  last_error: string | null;
  last_error_at: number | null;
  consecutive_failures: number;
  failing_since: number | null;
  live_relevant: boolean;
  state: "ok" | "failing" | "stale" | "idle";
}

export interface Calibration { delay_s: number; measured_s: number; uncertainty_s: number; warning?: string }

export interface Horn {
  league: string;
  abbr: string; // "default" for fallback (assumed)
  url: string;
  size?: number;
  /** seconds, null when the file could not be parsed */
  duration_s?: number | null;
  /** will be altered (trimmed and/or normalised) under the current settings */
  processed?: boolean;
  /** will be cut shorter under the current settings */
  trimmed?: boolean;
}

export interface Device {
  entity_id: string;
  name: string;
  device_class: "light" | "switch";
  capabilities?: { supported_color_modes?: string[]; effect_list?: string[] };
  supports_color?: boolean;
  supports_flash_speed?: boolean;
  supports_flash_duration?: boolean;
  supports_alternate_speed?: boolean;
  supports_alternate_duration?: boolean;
  integration_key?: string;
}

export type ActionEffect = "flash" | "alternate" | "set_color" | "light_effect";
export type TeamScope = "any" | "favorites" | "scoring_team";

export interface LightAction {
  id: string;
  enabled: boolean;
  triggers: string[];
  team_scope: TeamScope;
  entities: string[];
  effect: ActionEffect;
  light_effect?: string;
  duration: number;
  speed: number;
  colors: "team" | (RGB | null)[];
  restore: boolean;
}

export type ServerMsg =
  | { t: "snapshot"; games: Game[]; settings?: Settings }
  | { t: "game"; game: Game }
  | { t: "event"; event: EventPayload };

export type ViewName = "scoreboard" | "grid" | "ticker" | "control";
