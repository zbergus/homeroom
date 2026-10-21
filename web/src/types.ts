// API types mirroring SPEC.md sections 2, 3 and 4.4.
// Fields the SPEC leaves unspecified are marked "(assumed)".

export type RGB = { r: number; g: number; b: number };

interface TeamOptions {
  primary_color_rgb?: RGB | undefined;
  secondary_color_rgb?: RGB | undefined;
  alternate_color_rgb?: RGB | undefined;
}

export interface Team {
  id: string;
  abbr: string;
  name: string;
  display_name: string;
  logo?: string | undefined;
  score?: number | undefined;
  /** overall record as ESPN prints it, e.g. "4-3-1" */
  record?: string | undefined;
  options?: TeamOptions | undefined;
}

type GameStatus = "pre" | "in" | "post";

export type StatValue = number | string;

/** One scoring play inside Game.goals (shape assumed; SPEC only names "ScoringPlay"). */
export interface ScoringPlay {
  key?: string | undefined;
  period: number;
  period_label?: string | undefined;
  clock?: string | undefined;
  team_abbr?: string | undefined;
  team_id?: string | undefined;
  scorer?: string | undefined;
  scorer_id?: string | undefined;
  scorer_number?: string | undefined;
  assists?: string[] | undefined;
  strength?: "ev" | "pp" | "sh" | "en" | string | undefined; // server normalises to ev | pp | sh | en
  tags?: string[] | undefined;
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
  lower_is_better?: boolean | undefined;
}

export interface FormGame {
  opp_abbr: string;
  opp_logo?: string | undefined;
  venue: "H" | "A";
  gf: number;
  ga: number;
  result: "W" | "L" | "OTL" | "T";
  date: string;
}

export interface TeamForm {
  record?: string | undefined;
  /** oldest first, up to 10 */
  games: FormGame[];
}

export interface PlayerWatch {
  id: string;
  name: string;
  first: string;
  last: string;
  jersey?: string | undefined;
  position?: string | undefined;
  headshot?: string | undefined;
  team_abbr: string;
  tiles: { label: string; value: string }[];
  /** oldest first; `value` is the plotted number */
  log: { opp_abbr: string; value: number }[];
  log_label: string;
}

/** Context for break screens and the scoreboard side panel. Every part is optional: hide what is missing. */
export interface Insight {
  form?: { home: TeamForm; away: TeamForm; rows: StatRow[] };
  players?: { home?: PlayerWatch | undefined; away?: PlayerWatch | undefined };
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
  clock_s?: number | undefined;
  /** Wall-clock anchor (epoch ms) on the server's delayed replay timeline. */
  clock_at_ms?: number | undefined;
  clock_running?: boolean | undefined;
  clock_dir?: "down" | "up" | undefined;
  intermission: boolean;
  home: Team;
  away: Team;
  linescores: { home: (number | string)[]; away: (number | string)[] };
  stats: { home: Record<string, StatValue>; away: Record<string, StatValue> };
  goals: ScoringPlay[];
  /** canonical comparison rows from the boxscore; prefer over `stats` when present */
  stat_rows?: StatRow[] | undefined;
  insight?: Insight | undefined;
  football_situation?: FootballSituation | undefined;
  baseball_situation?: BaseballSituation | undefined;
  odds?: unknown | undefined;
  authority?: "espn" | "nhl" | "mlb" | undefined;
  nhl_id?: number | undefined;
  mlb_id?: number | undefined;
}

/** Football down, distance and possession situation (ESPN scoreboard). */
export interface FootballSituation {
  down: number;
  distance: number;
  yard_line?: number | undefined;
  down_distance_text?: string | undefined;
  possession?: string | undefined; // team abbreviation
  is_red_zone?: boolean | undefined;
}

/** Baseball inning, count, outs and runners situation (MLB Stats API). */
export interface BaseballSituation {
  inning: number;
  half: "top" | "bottom";
  inning_state: string; // "Top", "Bottom", "Middle", "End"
  balls: number;
  strikes: number;
  outs: number;
  on_first: boolean;
  on_second: boolean;
  on_third: boolean;
  batter?: string | undefined;
  pitcher?: string | undefined;
}

/** /api/schedule row (assumed: Game fields, possibly without live detail). */
export type GameLite = Pick<Game, "id" | "league" | "sport" | "status" | "start_time" | "home" | "away"> &
  Partial<Game>;

type EventType = "goal" | "game_start" | "game_end" | "period_start" | "period_end";
/** informational, UI/REST only */
type UiEventType = EventType | "goal_overturned" | "card" | "powerplay" | "first_down" | "third_down";

export interface Scoring {
  label: string;
  scorer?: string | undefined;
  scorer_id?: string | undefined;
  scorer_number?: string | undefined;
  assists?: string[] | undefined;
  strength?: string | undefined;
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
  team?: Team | undefined;
  scoring?: Scoring | undefined;
  natural_text?: string | undefined;
  goal_horn?: string | undefined;
  football?: FootballSituation | undefined;
  baseball?: BaseballSituation | undefined;
}

export interface League {
  id: string;
  name: string;
  sport?: string | undefined;
  enabled?: boolean | undefined;
}

export interface TeamRef { league: string; abbr: string }
/** GET/PUT /api/sync (shape confirmed by backend). */
export interface SyncState {
  /** games the user ticked */
  games: string[];
  favorites: TeamRef[];
  /** games that actually fire: ticked + auto-synced favourites, minus exclusions */
  effective?: string[] | undefined;
}

export interface TeamInfo { abbr: string; name: string; logo?: string | undefined; options?: TeamOptions | undefined }

export interface CelebrationVideo {
  league: string;
  abbr: string;
  player_id: string;
  url: string;
}

export interface HASettings {
  url: string;
  /** write-only: the server never returns it ("" on read) */
  token: string;
  token_set?: boolean | undefined;
  fire_rest_events: boolean;
}

export interface Settings {
  delay_global_s: number;
  delay_by_game: Record<string, number>;
  delay_by_league?: Record<string, number> | undefined;
  poll_idle_s?: number | undefined;
  poll_live_s?: number | undefined;
  nhl_fast_poll_ms?: number | undefined;
  mlb_fast_poll_ms?: number | undefined;
  ha: HASettings;
  enabled_leagues?: string[] | undefined;
  grid_leagues?: string[] | undefined;
  public_base_url: string;
  horn_scope?: "favorites" | "all" | "home" | undefined;
  /** longest horn that plays, seconds (2..120); null = no limit */
  horn_max_s?: number | null | undefined;
  /** fade-out at the trim point, ms (0..5000); needs ffmpeg */
  horn_fade_ms?: number | undefined;
  /** loudness-normalise horns; needs ffmpeg */
  horn_normalize?: boolean | undefined;
  tts_enabled?: boolean | undefined;
  my_team_only?: boolean | undefined;
  automations_enabled?: boolean | undefined;
  auto_sync_favorites?: boolean | undefined;
  sync_excluded?: string[] | undefined;
  /** goal-horn volume 0..1 set through HA's REST API around each horn; null/absent = off */
  horn_volume?: number | null | undefined;
  /** media_player.* entities the horn volume applies to */
  horn_players?: string[] | undefined;
}

/** PUT /api/settings body: partial; ha.token only when changed, ha.clear_token removes it. */
export type SettingsPatch = Partial<Omit<Settings, "ha">> & { ha?: Partial<Omit<HASettings, "token_set">> & { clear_token?: boolean | undefined } };

export interface Trigger { id: string; label: string; sports?: string[] | undefined }

export interface EventRecord {
  at: number;
  event_id: string;
  type: string;
  league: string;
  game: string;
  team?: string | undefined;
  label?: string | undefined;
  triggers: string[];
  manual: boolean;
  delay_s: number;
  outcome: "delivered" | "filtered";
  reason?: string | undefined;
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
  providers?: ProviderStatus[] | undefined;
  /** server clock when this response was built, so ages do not depend on the browser's clock */
  server_time?: number | undefined;
  /** in-app NHL simulation (scripted fake game); fail-safe off on process start */
  simulation?: { active: boolean; game_id?: string | undefined; started_at?: number | undefined; ends_at?: number | undefined; step_index?: number | undefined } | undefined;
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

export interface Calibration { delay_s: number; measured_s: number; uncertainty_s: number; warning?: string | undefined }

export interface Horn {
  league: string;
  abbr: string; // "default" for fallback (assumed)
  url: string;
  size?: number | undefined;
  /** seconds, null when the file could not be parsed */
  duration_s?: number | null | undefined;
  /** will be altered (trimmed and/or normalised) under the current settings */
  processed?: boolean | undefined;
  /** will be cut shorter under the current settings */
  trimmed?: boolean | undefined;
}

export interface Device {
  entity_id: string;
  name: string;
  device_class: "light" | "switch";
  capabilities?: { supported_color_modes?: string[] | undefined; effect_list?: string[] | undefined };
  supports_color?: boolean | undefined;
  supports_flash_speed?: boolean | undefined;
  supports_flash_duration?: boolean | undefined;
  supports_alternate_speed?: boolean | undefined;
  supports_alternate_duration?: boolean | undefined;
  integration_key?: string | undefined;
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
  light_effect?: string | undefined;
  duration: number;
  speed: number;
  colors: "team" | (RGB | null)[];
  restore: boolean;
}

export type ServerMsg =
  | { t: "snapshot"; games: Game[]; settings?: Settings | undefined; server_now_ms?: number | undefined }
  | { t: "game"; game: Game; server_now_ms?: number | undefined }
  | { t: "event"; event: EventPayload };

export type ViewName = "scoreboard" | "grid" | "ticker" | "control";
