/**
 * Per-provider health, fed by the poller (and the engine's enrichment calls). The feeds are unofficial and
 * can change shape or start failing without any user-visible symptom except "nothing happens", so this is what
 * /api/status and the dashboard use to say so.
 */
export interface ProviderRow {
  id: string;
  last_success_at: number | null;
  last_attempt_at: number | null;
  last_error: string | null;
  last_error_at: number | null;
  consecutive_failures: number;
  /** when the current failure streak began (null while healthy) */
  failing_since: number | null;
  /** a game that depends on this provider is in progress right now */
  live_relevant: boolean;
  state: "ok" | "failing" | "stale" | "idle";
}

export const FAILING_WARN_MS = 60_000;
export const STALE_WARN_MS = 5 * 60_000;

interface Rec {
  lastSuccess: number | null;
  lastAttempt: number | null;
  lastError: string | null;
  lastErrorAt: number | null;
  failures: number;
  failingSince: number | null;
}

export class ProviderHealth {
  private recs = new Map<string, Rec>();
  private since: number;
  constructor(private now: () => number = () => Date.now()) {
    this.since = now();
  }

  private rec(id: string): Rec {
    let r = this.recs.get(id);
    if (!r) this.recs.set(id, (r = { lastSuccess: null, lastAttempt: null, lastError: null, lastErrorAt: null, failures: 0, failingSince: null }));
    return r;
  }

  success(id: string): void {
    const r = this.rec(id);
    r.lastAttempt = r.lastSuccess = this.now();
    r.failures = 0;
    r.failingSince = null;
  }

  failure(id: string, err: unknown): void {
    const r = this.rec(id);
    const t = this.now();
    r.lastAttempt = r.lastErrorAt = t;
    // never keep more than a short message (it is shown in the UI; it must not carry URLs with secrets)
    r.lastError = (err instanceof Error ? err.message : String(err)).slice(0, 200);
    r.failures++;
    r.failingSince ??= t;
  }

  /** Runs `fn` and records the outcome. `countSuccess:false` records failures only (for secondary calls). */
  async track<T>(id: string, fn: () => Promise<T>, countSuccess = true): Promise<T> {
    try {
      const v = await fn();
      if (countSuccess) this.success(id);
      return v;
    } catch (err) {
      this.failure(id, err);
      throw err;
    }
  }

  /** `liveIds` = provider ids that currently matter for a live game. */
  snapshot(liveIds: ReadonlySet<string> = new Set()): ProviderRow[] {
    const t = this.now();
    const ids = new Set([...this.recs.keys(), ...liveIds]);
    return [...ids].sort().map((id) => {
      const r = this.rec(id);
      const live = liveIds.has(id);
      const failing = r.failingSince !== null && t - r.failingSince > FAILING_WARN_MS;
      const stale = live && t - (r.lastSuccess ?? this.since) > STALE_WARN_MS;
      return {
        id,
        last_success_at: r.lastSuccess,
        last_attempt_at: r.lastAttempt,
        last_error: r.lastError,
        last_error_at: r.lastErrorAt,
        consecutive_failures: r.failures,
        failing_since: r.failingSince,
        live_relevant: live,
        state: failing && live ? "failing" : stale ? "stale" : r.failures ? "failing" : r.lastSuccess === null ? "idle" : "ok",
      };
    });
  }

  /** Human warnings, only for providers that matter right now (a dead feed for a league with no live game is not news). */
  warnings(liveIds: ReadonlySet<string>, label: (id: string) => string = (id) => id): string[] {
    const t = this.now();
    const out: string[] = [];
    for (const row of this.snapshot(liveIds)) {
      if (!row.live_relevant) continue;
      const failFor = row.failing_since === null ? 0 : t - row.failing_since;
      if (failFor > FAILING_WARN_MS) {
        out.push(`${label(row.id)} has been failing for ${fmt(failFor)} while games are live (${row.last_error ?? "unknown error"}). Alerts for these games may be late or missing.`);
      } else if (t - (row.last_success_at ?? this.since) > STALE_WARN_MS) {
        out.push(`${label(row.id)} has returned no data for ${fmt(t - (row.last_success_at ?? this.since))} while games are live. Alerts for these games may be late or missing.`);
      }
    }
    return out;
  }
}

const fmt = (ms: number) => (ms >= 120_000 ? `${Math.floor(ms / 60_000)} min` : `${Math.round(ms / 1000)} s`);
