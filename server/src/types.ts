export type Rgb = { r: number; g: number; b: number };

interface TeamColors {
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
  record?: string | undefined;
  options: TeamColors;
}

export interface ScoringPlay {
  key: string;
  period: number;
  period_label: string;
  clock: string;
  team_abbr: string;
  scorer?: string | undefined;
  scorer_id?: string | undefined;
  scorer_number?: string | undefined;
  assists: string[];
  strength?: string | undefined;
  text?: string | undefined;
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
  lower_is_better?: boolean | undefined;
}

/** One finished game from a team's recent schedule. */
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
  jersey?: string | undefined;
  position?: string | undefined;
  headshot?: string | undefined;
}

/** Context data for break screens and the scoreboard side panel. Every part is optional. */
export interface Insight {
  form?: { home: TeamForm; away: TeamForm; rows: StatRow[] };
  players?: { home?: PlayerWatch | undefined; away?: PlayerWatch | undefined };
  updated_at: number;
}

/** A booking in a football (soccer) match, from the scoreboard's `details[]`. */
export interface Incident {
  key: string;
  kind: "yellow" | "red";
  team_abbr: string;
  clock: string;
  player?: string | undefined;
}

/** Skater situation from the NHL feed. `advantage` is the side on the power play (null = even or an empty net). */
interface Situation {
  advantage: "home" | "away" | null;
  home_skaters: number;
  away_skaters: number;
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
  clock_s?: number | undefined;
  clock_running?: boolean | undefined;
  clock_dir?: "down" | "up" | undefined;
  /** Wall-clock anchor (epoch ms); shifted to the replay timeline on delayed snapshots. */
  clock_at_ms?: number | undefined;
  intermission: boolean;
  home: Team;
  away: Team;
  linescores: { home: number[]; away: number[] };
  stats: { home: Record<string, string>; away: Record<string, string> };
  goals: ScoringPlay[];
  /** canonical per-sport comparison rows (from the boxscore); replaces the raw `stats` map for display */
  stat_rows?: StatRow[] | undefined;
  insight?: Insight | undefined;
  /** season leaders from the scoreboard; input for "players to watch" (not shown directly) */
  leaders?: { home?: LeaderRef | undefined; away?: LeaderRef | undefined };
  /** soccer bookings seen so far */
  incidents?: Incident[] | undefined;
  /** hockey: current skater situation (NHL feed only) */
  situation?: Situation | undefined;
  /** football: current down, distance, line of scrimmage and possession (ESPN scoreboard) */
  football_situation?: FootballSituation | undefined;
  /** baseball: current inning, count, outs, base runners and batter/pitcher (MLB Stats API) */
  baseball_situation?: BaseballSituation | undefined;
  odds?: { details?: string | undefined; over_under?: number | undefined } | undefined;
  /** which provider currently owns score/period/clock for this game */
  authority?: "espn" | "nhl" | "mlb" | undefined;
  nhl_id?: number | undefined;
  mlb_id?: number | undefined;
}

export type EventType = "goal" | "game_start" | "game_end" | "period_start" | "period_end";
/** UI/REST-only informational events that the HA integration has no handler for */
export type UiEventType = EventType | "goal_overturned" | "card" | "powerplay" | "first_down" | "third_down";

export interface EventPayload {
  event_id: string;
  type: UiEventType;
  emitted_at: number; // epoch seconds at detection
  delay_s: number;
  league: string;
  sport: string;
  game: Game;
  team?: Team | undefined;
  scoring?: {
    label: string;
    scorer?: string | undefined;
    scorer_id?: string | undefined;
    scorer_number?: string | undefined;
    assists: string[];
    strength?: string | undefined;
    delta: number;
    home_score: number;
    away_score: number;
  };
  natural_text: string;
  goal_horn?: string | undefined;
  test?: boolean | undefined;
  /** fired by a person (button / hook / test), not by a game feed: bypasses the automation gates */
  manual?: boolean | undefined;
  /** the trigger id a person pressed (manual events only), so e.g. "win" fires without a favourite team */
  trigger?: string | undefined;
  /** card events: who was booked */
  card?: { kind: "yellow" | "red"; player?: string | undefined; clock: string };
  /** football situation details for first_down / third_down events */
  football?: FootballSituation | undefined;
  /** baseball situation details for scoring plays (MLB Stats API) */
  baseball?: BaseballSituation | undefined;
  /** game_end only: abbreviation of the winning team, or "tie" */
  winner?: string | undefined;
}

export interface Settings {
  delay_global_s: number;
  delay_by_game: Record<string, number>;
  poll_idle_s: number;
  poll_live_s: number;
  nhl_fast_poll_ms: number;
  mlb_fast_poll_ms: number;
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
  on?: readonly string[] | undefined;
  /** trigger ids from engine/triggers.ts (goal, touchdown, basket3, win, period_end, ...) */
  triggers?: string[] | undefined;
  team_scope: "any" | "favorites" | "scoring_team";
  entities: string[];
  effect: "flash" | "alternate" | "set_color" | "light_effect";
  /** for effect "light_effect": the entity's own effect name (from capabilities.effect_list), e.g. a Hue "candle" */
  light_effect?: string | undefined;
  duration: number;
  speed: number;
  colors: "team" | Rgb[];
  restore: boolean;
}
