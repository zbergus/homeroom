import path from "node:path";
import { z } from "zod";
import { setLogLevel } from "./logger.js";

/** docker-compose passes unset variables through as "", which must behave like "not set" */
const blankToUndefined = (v: unknown) => (v === "" ? undefined : v);
const blank = <T extends z.ZodType>(s: T) => z.preprocess(blankToUndefined, s);

/**
 * Provider URLs / paths. Read once at module load, before any provider or store import, so a
 * process (or the simulator) can point every feed at a local replay server consistently.
 */
const RuntimeEnvSchema = z.object({
  DATA_DIR: blank(z.string().optional()),
  MEDIA_DIR: blank(z.string().optional()),
  WEB_DIR: blank(z.string().optional()),
  PUBLIC_BASE_URL: blank(z.string().url().optional()),
  NHL_BASE: blank(z.string().url().optional()),
  ESPN_BASE: blank(z.string().url().optional()),
  ESPN_WEB_BASE: blank(z.string().url().optional()),
  ESPN_SITE_BASE: blank(z.string().url().optional()),
  AHL_KEY: blank(z.string().default("ccb91f29d6744675")), // public HockeyTech feed key, not a user secret
  AHL_CLIENT: blank(z.string().default("ahl")),
  AHL_BASE: blank(z.string().url().default("https://lscluster.hockeytech.com/feed/index.php")),
});

/** Single parsed snapshot for module-level provider/store settings (no logging side effects). */
export const RUNTIME_ENV = RuntimeEnvSchema.parse(process.env);

const EnvSchema = z.object({
  PORT: blank(z.coerce.number().int().min(0).max(65535).default(8080)),
  LOG_LEVEL: blank(z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("warn")),
  WEB_DIR: blank(z.string().optional()),
  ADMIN_TOKEN: blank(z.string().min(1).optional()),
  HOMEROOM_RESTORE_GRACE_S: blank(z.coerce.number().positive().default(10)),
  /** extra browser origins (host[:port], comma separated) allowed to call the API, e.g. a dev server on another port */
  HOMEROOM_ALLOWED_ORIGINS: blank(z.string().default("")),
});

export interface Config {
  port: number;
  logLevel: z.infer<typeof EnvSchema>["LOG_LEVEL"];
  webDir: string;
  adminToken: string | undefined;
  restoreGraceMs: number;
  allowedOrigins: string[];
}

/** Parse and validate the environment once. Throws a readable error instead of running with a half-valid config. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const detail = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`invalid environment: ${detail}`);
  }
  const e = parsed.data;
  setLogLevel(e.LOG_LEVEL);
  return {
    port: e.PORT,
    logLevel: e.LOG_LEVEL,
    webDir: path.resolve(e.WEB_DIR ?? "../web/dist"), // @fastify/static refuses a relative root
    adminToken: e.ADMIN_TOKEN,
    restoreGraceMs: e.HOMEROOM_RESTORE_GRACE_S * 1000,
    allowedOrigins: e.HOMEROOM_ALLOWED_ORIGINS.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean),
  };
}

/** Things that are fine on a trusted LAN but worth saying out loud. Shown in the log and on the dashboard. */
export function securityNotes(c: Pick<Config, "adminToken">): string[] {
  const notes: string[] = [];
  if (!c.adminToken) notes.push("ADMIN_TOKEN is not set: anyone who can reach this server can change settings and fire triggers. Fine on a trusted LAN; set it otherwise.");
  return notes;
}
