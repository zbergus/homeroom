export type Rgb = { r: number; g: number; b: number };

export interface TeamColors {
  primary_color_rgb: Rgb;
  secondary_color_rgb: Rgb;
  alternate_color_rgb: Rgb;
}

export interface Team {
  id: string;
  abbr: string;
  name: string;
  display_name: string;
  logo: string;
  score: number;
  /** overall record as ESPN prints it, e.g. "4-3-1" */
  record?: string;
  options: TeamColors;
}

export interface ScoringPlay {
  key: string;
  period: number;
  period_label: string;
  clock: string;
  team_abbr: string;
  scorer?: string;
  assists: string[];
  strength?: string;
  text?: string;
  home_score: number;
  away_score: number;
}

/** One mirrored comparison row on a break screen (shots, hits, faceoff %, ...). */
export interface StatRow {
  key: string;
  label: string;
  home: string;
  away: string;
  home_n: number;
  away_n: number;
  lower_is_better?: boolean;
}

/** One finished game from a team's recent schedule. */
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
  /** season tiles, e.g. GOALS 4 / ASSISTS 3 / POINTS 7 / SHOTS 26 */
  tiles: { label: string; value: string }[];
  /** last games, oldest first; `value` is the plotted number (points per game) */
  log: { opp_abbr: string; value: number }[];
  log_label: string;
}

export interface LeaderRef {
  id: string;
  name: string;
  first: string;
  last: string;
  jersey?: string;
  position?: string;
  headshot?: string;
}

/** Context data for break screens and the scoreboard side panel. Every part is optional. */
export interface Insight {
  form?: { home: TeamForm; away: TeamForm; rows: StatRow[] };
  players?: { home?: PlayerWatch; away?: PlayerWatch };
  updated_at: number;
}

/** A booking in a football (soccer) match, from the scoreboard's `details[]`. */
export interface Incident {
  key: string;
  kind: "yellow" | "red";
  team_abbr: string;
  clock: string;
  player?: string;
}

/** Skater situation from the NHL feed. `advantage` is the side on the power play (null = even or an empty net). */
export interface Situation {
  advantage: "home" | "away" | null;
  home_skaters: number;
  away_skaters: number;
}

export type GameStatus = "pre" | "in" | "post";

export interface Game {
  id: string; // "<league>:<espnEventId>"
  league: string;
  sport: string;
  status: GameStatus;
  start_time: string; // ISO
  period: number;
  period_label: string;
  clock: string;
  /** numeric clock for interpolation: seconds shown on the game clock, and whether it is running now */
  clock_s?: number;
  clock_running?: boolean;
  clock_dir?: "down" | "up";
  intermission: boolean;
  home: Team;
  away: Team;
  linescores: { home: number[]; away: number[] };
  stats: { home: Record<string, string>; away: Record<string, string> };
  goals: ScoringPlay[];
  /** canonical per-sport comparison rows (from the boxscore); replaces the raw `stats` map for display */
  stat_rows?: StatRow[];
  insight?: Insight;
  /** season leaders from the scoreboard; input for "players to watch" (not shown directly) */
  leaders?: { home?: LeaderRef; away?: LeaderRef };
  /** soccer bookings seen so far */
  incidents?: Incident[];
  /** hockey: current skater situation (NHL feed only) */
  situation?: Situation;
  odds?: { details?: string; over_under?: number };
  /** which provider currently owns score/period/clock for this game */
  authority?: "espn" | "nhl";
  nhl_id?: number;
}

export type EventType = "goal" | "game_start" | "game_end" | "period_start" | "period_end";
/** UI/REST-only informational events that the HA integration has no handler for */
export type UiEventType = EventType | "goal_overturned" | "card" | "powerplay";

export interface EventPayload {
  event_id: string;
  type: UiEventType;
  emitted_at: number; // epoch seconds at detection
  delay_s: number;
  league: string;
  sport: string;
  game: Game;
  team?: Team;
  scoring?: {
    label: string;
    scorer?: string;
    assists: string[];
    strength?: string;
    delta: number;
    home_score: number;
    away_score: number;
  };
  natural_text: string;
  goal_horn?: string;
  test?: boolean;
  /** fired by a person (button / hook / test), not by a game feed: bypasses the automation gates */
  manual?: boolean;
  /** the trigger id a person pressed (manual events only), so e.g. "win" fires without a favourite team */
  trigger?: string;
  /** card events: who was booked */
  card?: { kind: "yellow" | "red"; player?: string; clock: string };
  /** game_end only: abbreviation of the winning team, or "tie" */
  winner?: string;
}

export interface Settings {
  delay_global_s: number;
  delay_by_game: Record<string, number>;
  poll_idle_s: number;
  poll_live_s: number;
  nhl_fast_poll_ms: number;
  enabled_leagues: string[];
  grid_leagues: string[];
  public_base_url: string;
  /** whose goals play a horn: favourites (when one is in the game), every team, or only the home team */
  horn_scope: "favorites" | "all" | "home";
  /** longest horn that plays, seconds (2..120); null = no limit. Longer clips are trimmed (and faded when ffmpeg exists). */
  horn_max_s: number | null;
  /** fade-out at the trim point, ms (0..5000); needs ffmpeg */
  horn_fade_ms: number;
  /** even out loudness between horns (EBU R128 single pass); needs ffmpeg */
  horn_normalize: boolean;
  tts_enabled: boolean;
  /** automation outputs (HA / lights / horn / TTS) only for favourite-team goals; the TV overlay is unaffected */
  my_team_only: boolean;
  /** false = only manual triggers drive automations */
  automations_enabled: boolean;
  /** games containing a favourite team count as synced */
  auto_sync_favorites: boolean;
  sync_excluded: string[];
  /** default delay per league id; resolves as by_game ?? by_league ?? global */
  delay_by_league: Record<string, number>;
  ha: { url: string; token: string; fire_rest_events: boolean };
  /** goal-horn volume (0..1) set via HA's REST API just before a horn plays, then restored; null = off (never touch volume) */
  horn_volume: number | null;
  /** media_player.* entities whose volume is set for the horn (needs ha.url + token) */
  horn_players: string[];
}

export interface LightAction {
  id: string;
  enabled: boolean;
  /** legacy: event types. Superseded by `triggers`; migrated on read. */
  on?: readonly string[];
  /** trigger ids from engine/triggers.ts (goal, touchdown, basket3, win, period_end, ...) */
  triggers?: string[];
  team_scope: "any" | "favorites" | "scoring_team";
  entities: string[];
  effect: "flash" | "alternate" | "set_color" | "light_effect";
  /** for effect "light_effect": the entity's own effect name (from capabilities.effect_list), e.g. a Hue "candle" */
  light_effect?: string;
  duration: number;
  speed: number;
  colors: "team" | Rgb[];
  restore: boolean;
}
