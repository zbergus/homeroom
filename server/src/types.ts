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
  /** overall record as printed, e.g. "4-3-1" */
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
  /** hockey strength: "ev" | "pp" | "sh" | "en" */
  strength?: string | undefined;
  text?: string | undefined;
  home_score: number;
  away_score: number;
}

/** One mirrored comparison row on a break screen (shots, hits, faceoff %, powerplay, ...). */
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

export interface StartingGoalie {
  id?: string | undefined;
  name: string;
  first?: string | undefined;
  last?: string | undefined;
  jersey?: string | undefined;
  headshot?: string | undefined;
  /** true = confirmed starter, false/undefined = probable/expected */
  confirmed?: boolean | undefined;
  status?: string | undefined; // e.g. "Confirmed", "Expected", "Probable"
  record?: string | undefined; // e.g. "18-6-2"
  gaa?: string | number | undefined; // e.g. "2.34"
  save_pct?: string | number | undefined; // e.g. ".918"
}

export interface GoalieMatchup {
  away?: StartingGoalie | undefined;
  home?: StartingGoalie | undefined;
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

/** Context data for break screens and the scoreboard side panel. */
export interface Insight {
  form?: { home: TeamForm; away: TeamForm; rows: StatRow[] } | undefined;
  players?: { home?: PlayerWatch | undefined; away?: PlayerWatch | undefined } | undefined;
  updated_at: number;
}

/** Skater situation from the hockey feed. `advantage` is the side on the power play. */
export interface Situation {
  advantage: "home" | "away" | null;
  home_skaters: number;
  away_skaters: number;
  empty_net?: "home" | "away" | boolean | undefined;
}

export interface SkaterStats {
  id: string;
  name: string;
  jersey?: string | undefined;
  position?: string | undefined;
  headshot?: string | undefined;
  toi: string;
  sog: number;
  plus_minus: number;
  goals: number;
  assists: number;
  points: number;
  hits?: number | undefined;
  blocked_shots?: number | undefined;
  penalty_minutes?: number | undefined;
}

export interface GoalieStats {
  id: string;
  name: string;
  jersey?: string | undefined;
  position?: string | undefined;
  headshot?: string | undefined;
  toi: string;
  saves: number;
  shots_against: number;
  save_pct: string;
  goals_against: number;
  starter?: boolean | undefined;
  decision?: string | undefined;
}

export interface TeamBoxscore {
  team: Team;
  skaters: SkaterStats[];
  goalies: GoalieStats[];
}

export interface HockeyBoxscore {
  game_id: string;
  game?: Game | undefined;
  home: TeamBoxscore;
  away: TeamBoxscore;
  updated_at: number;
}

export type GameStatus = "pre" | "in" | "post";

export interface Game {
  id: string; // "<league>:<eventId>"
  league: string;
  sport: "hockey";
  status: GameStatus;
  start_time: string; // ISO
  period: number;
  period_label: string;
  clock: string;
  /** numeric clock for interpolation: seconds shown on the game clock, and whether it is running now */
  clock_s?: number | undefined;
  clock_running?: boolean | undefined;
  clock_dir?: "down" | undefined;
  /** Wall-clock anchor (epoch ms); shifted to the replay timeline on delayed snapshots. */
  clock_at_ms?: number | undefined;
  intermission: boolean;
  home: Team;
  away: Team;
  linescores: { home: number[]; away: number[] };
  stats: { home: Record<string, string>; away: Record<string, string> };
  goals: ScoringPlay[];
  /** canonical comparison rows (from the boxscore); replaces the raw `stats` map for display */
  stat_rows?: StatRow[] | undefined;
  insight?: Insight | undefined;
  /** season leaders from the scoreboard; input for "players to watch" */
  leaders?: { home?: LeaderRef | undefined; away?: LeaderRef | undefined } | undefined;
  /** hockey: starting goalie duel (probables / confirmed starters) */
  goalies?: GoalieMatchup | undefined;
  /** hockey: current skater situation (e.g. 5v4, 5v3, 4v3, empty net) */
  situation?: Situation | undefined;
  /** live shots on goal */
  sog?: { home: number; away: number } | undefined;
  odds?: { details?: string | undefined; over_under?: number | undefined } | undefined;
  /** which provider currently owns score/period/clock for this game */
  authority?: "espn" | "nhl" | undefined;
  nhl_id?: number | undefined;
}

export type EventType = "goal" | "game_start" | "game_end" | "period_start" | "period_end";
/** UI/REST-only informational events that the HA integration has no handler for */
export type UiEventType = EventType | "goal_overturned" | "powerplay" | "penalty" | "sog";

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
  } | undefined;
  natural_text: string;
  goal_horn?: string | undefined;
  test?: boolean | undefined;
  /** fired by a person (button / hook / test), not by a game feed: bypasses the automation gates */
  manual?: boolean | undefined;
  /** the trigger id a person pressed (manual events only), so e.g. "win" fires without a favourite team */
  trigger?: string | undefined;
  /** hockey situation context */
  situation?: Situation | undefined;
  /** penalty context */
  penalty?: { team: string; player?: string | undefined; minutes?: number | undefined; infraction?: string | undefined } | undefined;
  /** shots on goal context */
  sog?: { home: number; away: number; team?: "home" | "away" | undefined } | undefined;
  /** game_end only: abbreviation of the winning team, or "tie" */
  winner?: string | undefined;
}

export interface RosterPlayer {
  id: string;
  name: string;
  number?: string | undefined;
  position?: string | undefined;
}

export interface CelebrationVideo {
  league: string;
  abbr: string;
  player_id: string;
  url: string;
  player_name?: string | undefined;
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
  /** Language for TTS announcements per team (e.g. MTL: "fr", or "nhl:MTL": "fr"). Defaults to MTL: fr. */
  team_languages: Record<string, "en" | "fr">;
}

export interface LightAction {
  id: string;
  enabled: boolean;
  /** legacy: event types. Superseded by `triggers`; migrated on read. */
  on?: readonly string[] | undefined;
  /** trigger ids from engine/triggers.ts (goal, ppg, shg, eng, powerplay, penalty, win, period_end, ...) */
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
