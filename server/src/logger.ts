export type LogLevel = "fatal" | "error" | "warn" | "info" | "debug" | "trace" | "silent";

const LEVEL_WEIGHTS: Record<LogLevel, number> = {
  silent: 100,
  fatal: 50,
  error: 40,
  warn: 30,
  info: 20,
  debug: 10,
  trace: 0,
};

let currentLevel: LogLevel = "info";

export function setLogLevel(level: LogLevel): void {
  currentLevel = level;
}

export function getLogLevel(): LogLevel {
  return currentLevel;
}

export function isLevelEnabled(level: LogLevel): boolean {
  if (currentLevel === "silent") return false;
  const currentWeight = LEVEL_WEIGHTS[currentLevel] ?? 20;
  const targetWeight = LEVEL_WEIGHTS[level] ?? 20;
  return targetWeight >= currentWeight;
}

const REDACT_KEYS = new Set(["token", "appsecret", "secret", "password", "authorization", "key"]);

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v) && !(v instanceof Error);
}

function sanitizeValue(val: unknown, depth = 0): unknown {
  if (depth > 3) return "[depth-limit]";
  if (typeof val === "string") {
    return val.replace(/(bearer\s+)[a-zA-Z0-9_\-.~+/]+=*/gi, "$1[REDACTED]");
  }
  if (Array.isArray(val)) {
    return val.map((item) => sanitizeValue(item, depth + 1));
  }
  if (isPlainObject(val)) {
    const res: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(val)) {
      if (REDACT_KEYS.has(k.toLowerCase())) {
        res[k] = "[REDACTED]";
      } else {
        res[k] = sanitizeValue(v, depth + 1);
      }
    }
    return res;
  }
  return val;
}

export function sanitizeUrl(rawUrl: string): string {
  try {
    const u = new URL(rawUrl, "http://127.0.0.1");
    if (u.searchParams.has("token")) u.searchParams.set("token", "[REDACTED]");
    return u.pathname + (u.search ? u.search : "");
  } catch {
    return rawUrl.replace(/([?&]token=)[^&]+/gi, "$1[REDACTED]");
  }
}

export interface Logger {
  debug(...args: unknown[]): void;
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
}

export function createLogger(tag: string): Logger {
  const prefix = `[${tag}]`;
  return {
    debug: (...args: unknown[]) => {
      if (isLevelEnabled("debug")) {
        console.debug(prefix, ...args.map((a) => sanitizeValue(a)));
      }
    },
    info: (...args: unknown[]) => {
      if (isLevelEnabled("info")) {
        console.log(prefix, ...args.map((a) => sanitizeValue(a)));
      }
    },
    warn: (...args: unknown[]) => {
      if (isLevelEnabled("warn")) {
        console.warn(prefix, ...args.map((a) => sanitizeValue(a)));
      }
    },
    error: (...args: unknown[]) => {
      if (isLevelEnabled("error")) {
        console.error(prefix, ...args.map((a) => sanitizeValue(a)));
      }
    },
  };
}
