import { z } from "zod";
import { validDelay } from "./engine/delay.js";
import { isTriggerId } from "./engine/triggers.js";
import { LEAGUES } from "./leagues.js";
import { MEDIA_PLAYER_RE } from "./outputs/horn_volume.js";

/** Runtime schemas for everything that crosses the HTTP boundary or is persisted from it. */

export const ABBR_RE = /^[A-Za-z0-9]{1,8}$/;
/** Home Assistant entity id: `domain.object_id` */
const ENTITY_RE = /^[a-z0-9_]+\.[A-Za-z0-9_]+$/;

const leagueId = z.string().refine((id) => LEAGUES.some((l) => l.id === id), "unknown league id");
const abbr = z.string().regex(ABBR_RE, "must be 1-8 letters or digits");
const delay = z.number().refine(validDelay, "must be 0..120 in 0.5 steps");
const channel = z.number().int().min(0).max(255);

const isHttpUrl = (s: string): boolean => {
  try {
    const p = new URL(s).protocol;
    return p === "http:" || p === "https:";
  } catch {
    return false;
  }
};
const httpUrl = z.string().max(2048).refine(isHttpUrl, "must be an http:// or https:// URL");
const optionalUrl = z.union([z.literal(""), httpUrl]);

const RgbSchema = z.object({ r: channel, g: channel, b: channel });

const HaSettingsPatch = z.object({
  url: optionalUrl.optional(),
  token: z.string().max(4096).optional(),
  fire_rest_events: z.boolean().optional(),
});

const HORN_MAX = "must be between 2 and 120, or null for no limit";
const HORN_VOL = "must be between 0 and 1, or null to leave the volume alone";

/** PUT /api/settings. Unknown keys are dropped, so nothing the UI never asked for ends up persisted. */
export const SettingsPatchSchema = z.object({
  delay_global_s: delay.optional(),
  delay_by_game: z.record(z.string().max(100), delay).optional(),
  delay_by_league: z
    .record(z.string().max(20), delay)
    .superRefine((rec, ctx) => {
      for (const k of Object.keys(rec)) if (!LEAGUES.some((l) => l.id === k)) ctx.addIssue({ code: "custom", message: `unknown league ${k}` });
    })
    .optional(),
  poll_idle_s: z.number().positive().finite().optional(),
  poll_live_s: z.number().min(1, "must be >= 1").finite().optional(),
  nhl_fast_poll_ms: z.number().min(250, "must be >= 250").finite().optional(),
  enabled_leagues: z.array(leagueId).optional(),
  grid_leagues: z.array(leagueId).optional(),
  public_base_url: optionalUrl.optional(),
  horn_scope: z.enum(["favorites", "all", "home"]).optional(),
  horn_max_s: z.number().finite().min(2, HORN_MAX).max(120, HORN_MAX).nullable().optional(),
  horn_fade_ms: z.number().finite().min(0, "must be between 0 and 5000").max(5000, "must be between 0 and 5000").optional(),
  horn_normalize: z.boolean().optional(),
  tts_enabled: z.boolean().optional(),
  my_team_only: z.boolean().optional(),
  automations_enabled: z.boolean().optional(),
  auto_sync_favorites: z.boolean().optional(),
  sync_excluded: z.array(z.string().max(100)).max(2000).optional(),
  ha: HaSettingsPatch.optional(),
  horn_volume: z.number().min(0, HORN_VOL).max(1, HORN_VOL).nullable().optional(),
  horn_players: z.array(z.string().regex(MEDIA_PLAYER_RE)).max(20, "up to 20 media_player.* entity ids").optional(),
});

export const SyncBodySchema = z.object({
  games: z.array(z.string().max(100)).max(5000).optional(),
  favorites: z.array(z.object({ league: leagueId, abbr })).max(500).optional(),
});

export const TeamOverrideSchema = z.object({
  primary_color_rgb: RgbSchema.optional(),
  secondary_color_rgb: RgbSchema.optional(),
  alternate_color_rgb: RgbSchema.optional(),
});

const ActionSchema = z.object({
  id: z.string().min(1).max(100),
  enabled: z.boolean().default(true),
  /** legacy: event types, migrated to `triggers` on read */
  on: z.array(z.string().max(50)).max(50).optional(),
  triggers: z.array(z.string().refine(isTriggerId, "unknown trigger")).max(100).optional(),
  team_scope: z.enum(["any", "favorites", "scoring_team"]),
  entities: z.array(z.string().regex(ENTITY_RE, "must look like light.living_room")).max(200),
  effect: z.enum(["flash", "alternate", "set_color", "light_effect"]),
  light_effect: z.string().max(100).optional(),
  duration: z.number().finite().default(3),
  speed: z.number().finite().default(5),
  colors: z.union([z.literal("team"), z.array(RgbSchema).min(1).max(10)]).default("team"),
  restore: z.boolean().default(false),
});
export const ActionListSchema = z.array(ActionSchema).max(200);

export const TriggerBodySchema = z.object({
  trigger: z.string().max(50).optional(),
  league: z.string().max(20).optional(),
  team_abbr: z.string().max(20).optional(),
  game_id: z.string().max(100).optional(),
  apply_delay: z.boolean().optional(),
  /** only POST /api/test/goal */
  bypass_delay: z.boolean().optional(),
});

export const HookQuerySchema = z.object({
  league: z.string().max(20).optional(),
  team: z.string().max(20).optional(),
  game: z.string().max(100).optional(),
  delay: z.string().max(5).optional(),
  token: z.string().max(4096).optional(),
});

export const CalibrateBodySchema = z.object({
  game_id: z.string().max(100).optional(),
  tv_period: z.number().optional(),
  tv_clock: z.string().max(20).optional(),
});

export const DevicesSyncSchema = z.object({
  devices: z.array(z.record(z.string(), z.unknown())).max(2000).default([]),
});

export const ExecuteBodySchema = z.object({
  request_id: z.string().max(100).optional(),
  payload: z.union([z.string().max(100_000), z.record(z.string(), z.unknown())]).optional(),
});

export const WsAuthBodySchema = z.object({
  socket_id: z.string().max(100).optional(),
  channel_name: z.string().max(200).optional(),
});

/** "path: message" for the first issue, for the `{ error }` bodies the UI shows verbatim */
export function firstIssue(e: z.ZodError): string {
  const i = e.issues[0];
  if (!i) return "invalid request";
  const where = i.path.map(String).join(".");
  return where ? `${where}: ${i.message}` : i.message;
}
