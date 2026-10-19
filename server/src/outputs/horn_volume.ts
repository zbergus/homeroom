import type { Settings } from "../types.js";

/** Entity ids Homeroom is willing to touch: media players only. */
export const MEDIA_PLAYER_RE = /^media_player\.[a-z0-9_]+$/;

export interface HornVolumeOpts {
  fetchImpl?: typeof fetch;
  /** per-request timeout */
  timeoutMs?: number;
  /** how long `prepare` may delay the horn at most (the integration speaks TTS if the horn is >~3 s after the goal) */
  prepareBudgetMs?: number;
  /** restore: first check after this long, then every pollMs, give up after maxPlayMs */
  firstCheckMs?: number;
  pollMs?: number;
  maxPlayMs?: number;
}

interface Entry {
  prev: number;
  /** bumped by every new horn so an older restore loop stands down */
  gen: number;
}

type Cfg = Pick<Settings, "horn_volume" | "horn_players" | "ha">;

/**
 * Optional horn volume control through Home Assistant's REST API (the HA integration plays the horn at whatever
 * volume the player currently has). Only runs when `horn_volume` AND `horn_players` AND the HA url+token are set.
 * Reads the current volume first, sets the horn volume, and puts the old one back once the player stops playing.
 * Strictly best effort: every failure is swallowed (logged without credentials) and never blocks the horn or lights.
 */
export class HornVolume {
  private entries = new Map<string, Entry>();
  private chain = new Map<string, Promise<void>>();
  private lastPrepare?: { eventId: string; p: Promise<void> };
  private f: typeof fetch;
  private o: Required<Omit<HornVolumeOpts, "fetchImpl">>;

  constructor(
    private cfg: () => Cfg,
    opts: HornVolumeOpts = {},
  ) {
    this.f = opts.fetchImpl ?? fetch;
    this.o = { timeoutMs: 1200, prepareBudgetMs: 2000, firstCheckMs: 3000, pollMs: 1000, maxPlayMs: 30_000, ...opts };
  }

  enabled(): boolean {
    const c = this.cfg();
    return c.horn_volume != null && c.horn_players.length > 0 && !!c.ha.url && !!c.ha.token;
  }

  /**
   * Resolves when the players are at the horn volume, or after the budget, whichever is first; never rejects.
   * Idempotent per event id (the Pusher and REST paths both call it for the same goal).
   */
  prepare(eventId: string): Promise<void> {
    if (!this.enabled()) return Promise.resolve();
    if (this.lastPrepare?.eventId === eventId) return this.lastPrepare.p;
    const c = this.cfg();
    const work = Promise.all(c.horn_players.map((e) => this.serial(e, () => this.duck(e, c.horn_volume as number)).catch((err) => this.warn(e, err)))).then(() => {});
    let timer: ReturnType<typeof setTimeout>;
    const budget = new Promise<void>((r) => (timer = setTimeout(r, this.o.prepareBudgetMs)));
    const p = Promise.race([work, budget]).finally(() => clearTimeout(timer));
    this.lastPrepare = { eventId, p };
    return p;
  }

  /** one volume change at a time per player, so two quick goals cannot both read the already-lowered/raised volume as "previous" */
  private serial(entity: string, fn: () => Promise<void>): Promise<void> {
    const run = (this.chain.get(entity) ?? Promise.resolve()).catch(() => {}).then(fn);
    this.chain.set(entity, run);
    return run;
  }

  private warn(entity: string, err: unknown): void {
    console.warn(`[horn-volume] ${entity}: ${(err as Error).message}`);
  }

  private async call<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
    const { ha } = this.cfg();
    const res = await this.f(`${ha.url.replace(/\/$/, "")}${path}`, {
      method,
      headers: { authorization: `Bearer ${ha.token}`, "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(this.o.timeoutMs),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${method} ${path}`);
    return (await res.json().catch(() => undefined)) as T;
  }

  private getState(entity: string) {
    return this.call<{ state?: string; attributes?: { volume_level?: unknown } }>("GET", `/api/states/${encodeURIComponent(entity)}`);
  }
  private setVolume(entity: string, level: number) {
    return this.call("POST", "/api/services/media_player/volume_set", { entity_id: entity, volume_level: level });
  }

  private async duck(entity: string, level: number): Promise<void> {
    let e = this.entries.get(entity);
    if (e) {
      // a previous horn's restore is still pending: its saved volume is the real one, the player is currently at horn volume
      e.gen++;
    } else {
      const st = await this.getState(entity);
      const prev = st?.attributes?.volume_level;
      if (typeof prev !== "number") return; // off/unavailable/no volume support: nothing we could restore, so do not touch it
      e = { prev, gen: 0 };
      this.entries.set(entity, e);
    }
    const gen = e.gen;
    try {
      await this.setVolume(entity, level);
    } catch (err) {
      // never leave a half-applied change behind: if we cannot confirm the set, do not keep a stale entry
      if (gen === 0) this.entries.delete(entity);
      throw err;
    }
    void this.restoreLater(entity, e, gen);
  }

  /** Wait for the horn to finish (player leaves "playing"), then put the old volume back. */
  private async restoreLater(entity: string, e: Entry, gen: number): Promise<void> {
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    try {
      const start = Date.now();
      await sleep(this.o.firstCheckMs);
      let idle = 0;
      while (e.gen === gen && Date.now() - start < this.o.maxPlayMs && idle < 2) {
        const st = await this.getState(entity).catch(() => undefined);
        idle = st && st.state !== "playing" ? idle + 1 : 0;
        if (idle < 2) await sleep(this.o.pollMs);
      }
      if (e.gen !== gen) return; // a newer horn owns the restore now
      await this.setVolume(entity, e.prev);
    } catch (err) {
      this.warn(entity, err);
    } finally {
      if (e.gen === gen && this.entries.get(entity) === e) this.entries.delete(entity);
    }
  }
}
