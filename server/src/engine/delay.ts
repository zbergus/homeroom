/**
 * Releases items after a per-item delay, in order per key.
 *
 * Ordering guarantee: for items sharing a key (we use the game id), release times never go
 * backwards. If the delay is lowered while items are queued, later items wait for earlier ones
 * instead of overtaking them, so a TV never shows state "from the future" relative to an event.
 */
export class DelayBuffer<T> {
  private queue: { at: number; seq: number; item: T }[] = [];
  private lastAt = new Map<string, number>();
  private seq = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private deliver: (item: T) => void,
    private now: () => number = () => Date.now(),
  ) {}

  get size(): number {
    return this.queue.length;
  }

  /** Queues (or immediately delivers) an item; returns its scheduled release time (epoch ms). */
  push(item: T, delayMs: number, key = ""): number {
    const t = this.now();
    const at = Math.max(t + Math.max(0, delayMs), this.lastAt.get(key) ?? 0);
    this.lastAt.set(key, at);
    if (at <= t && this.queue.length === 0) {
      this.deliver(item);
      return at;
    }
    // insert keeping (at, seq) order
    const entry = { at, seq: this.seq++, item };
    let i = this.queue.length;
    while (i > 0 && this.queue[i - 1].at > at) i--;
    this.queue.splice(i, 0, entry);
    this.arm();
    return at;
  }

  clear(): void {
    this.queue = [];
    this.lastAt.clear();
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private arm(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const head = this.queue[0];
    if (!head) return;
    this.timer = setTimeout(() => this.flush(), Math.max(0, head.at - this.now()));
  }

  private flush(): void {
    this.timer = null;
    const t = this.now();
    while (this.queue.length && this.queue[0].at <= t) {
      const { item } = this.queue.shift()!;
      try {
        this.deliver(item);
      } catch (err) {
        console.error("[delay] deliver failed", err);
      }
    }
    if (this.queue.length === 0) {
      // drop stale per-key watermarks
      for (const [k, v] of this.lastAt) if (v <= t) this.lastAt.delete(k);
    }
    this.arm();
  }
}

/** Valid delay: 0..120 s in 0.5 s steps. */
export function validDelay(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 120 && Math.abs(v * 2 - Math.round(v * 2)) < 1e-9;
}
