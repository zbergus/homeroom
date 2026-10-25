import { createHash, timingSafeEqual } from "node:crypto";
import type { IncomingHttpHeaders } from "node:http";

const digest = (s: string) => createHash("sha256").update(s).digest();

/** Constant-time string comparison (digests first, so length differences do not leak either). */
export function safeEq(a: string | undefined, b: string | undefined): boolean {
  if (a === undefined || b === undefined) return false;
  return timingSafeEqual(digest(a), digest(b));
}

/**
 * Is this request coming from a page on another site? Browsers attach `Sec-Fetch-Site` and `Origin` to
 * cross-origin requests and scripts cannot forge them; Stream Deck, Home Assistant, curl and pysher send neither.
 * `allowed` are extra `host[:port]` values (a dev server on another port).
 */
export function isCrossSite(h: IncomingHttpHeaders, allowed: readonly string[] = []): boolean {
  if (h["sec-fetch-site"] === "cross-site") return true;
  const origin = h.origin;
  if (!origin) return false;
  try {
    const host = new URL(origin).host.toLowerCase();
    return host !== (h.host ?? "").toLowerCase() && !allowed.includes(host);
  } catch {
    return true; // "null" and other unparseable origins (sandboxed iframes, file://)
  }
}

/** Fixed-window counter per key. In-memory is enough for one process on a home server. */
export class RateLimiter {
  private hits = new Map<string, { n: number; resetAt: number }>();

  constructor(
    private limit: number,
    private windowMs: number,
    private now: () => number = Date.now,
  ) {}

  /** Count one hit; false once the key is over its limit for the current window. */
  allow(key: string): boolean {
    const t = this.now();
    if (this.hits.size > 1000) for (const [k, v] of this.hits) if (v.resetAt <= t) this.hits.delete(k);
    const cur = this.hits.get(key);
    if (!cur || cur.resetAt <= t) {
      this.hits.set(key, { n: 1, resetAt: t + this.windowMs });
      return true;
    }
    cur.n++;
    return cur.n <= this.limit;
  }

  /** Would the next hit be refused (without counting one)? */
  blocked(key: string): boolean {
    const cur = this.hits.get(key);
    return !!cur && cur.resetAt > this.now() && cur.n >= this.limit;
  }
}

/** Message of anything that was thrown. Never assumes an Error. */
export function errMsg(e: unknown): string {
  if (e instanceof Error) return e.message;
  return typeof e === "string" ? e : (JSON.stringify(e) ?? String(e));
}
