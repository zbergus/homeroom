import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp, type App } from "../src/app.js";
import { ProviderHealth } from "../src/engine/health.js";
import { Store } from "../src/store.js";
import type { Game, Team } from "../src/types.js";

interface StatusBody {
  providers: { id: string }[];
  warnings: string[];
  server_time: number;
}

const rgb = { r: 1, g: 2, b: 3 };
const team = (abbr: string): Team => ({ id: abbr, abbr, name: abbr, display_name: abbr, logo: "", score: 0, options: { primary_color_rgb: rgb, secondary_color_rgb: rgb, alternate_color_rgb: rgb } });
const live = (id = "nhl:1"): Game => ({
  id, league: "nhl", sport: "hockey", status: "in", start_time: new Date().toISOString(), period: 1, period_label: "1st", clock: "10:00", intermission: false,
  home: team("MIN"), away: team("CBJ"), linescores: { home: [], away: [] }, stats: { home: {}, away: {} }, goals: [],
});

describe("ProviderHealth", () => {
  it("tracks success, failure streaks and the last error", () => {
    let t = 1_000_000;
    const h = new ProviderHealth(() => t);
    h.success("nhl");
    t += 10_000;
    h.failure("nhl", new Error("HTTP 503"));
    t += 10_000;
    h.failure("nhl", new Error("HTTP 503"));
    const [row] = h.snapshot();
    expect(row).toMatchObject({ id: "nhl", consecutive_failures: 2, last_error: "HTTP 503", last_success_at: 1_000_000, failing_since: 1_010_000 });
    h.success("nhl");
    expect(h.snapshot()[0]).toMatchObject({ consecutive_failures: 0, failing_since: null, state: "ok" });
  });

  it("warns only for live-relevant providers: failing > 60 s, or no data > 5 min", () => {
    let t = 0;
    const h = new ProviderHealth(() => t);
    const liveIds = new Set(["espn:nhl", "nhl"]);
    h.success("espn:nhl");
    h.success("nhl");
    h.failure("espn:nhl", new Error("HTTP 500"));
    t = 30_000;
    h.failure("espn:nhl", new Error("HTTP 500"));
    expect(h.warnings(liveIds)).toEqual([]); // 30 s of failures: not yet
    t = 90_000;
    h.failure("espn:nhl", new Error("HTTP 500"));
    h.success("nhl");
    const w = h.warnings(liveIds);
    expect(w).toHaveLength(1);
    expect(w[0]).toMatch(/espn:nhl has been failing for 90 s.*HTTP 500/);
    expect(h.warnings(new Set())).toEqual([]); // nothing live: a dead feed is not news
    // silent staleness: nobody is failing, but nothing has succeeded for 6 minutes
    t = 90_000 + 6 * 60_000;
    expect(h.warnings(new Set(["nhl"])).join()).toMatch(/nhl has returned no data for 6 min/);
  });

  it("track() records failures but can skip counting a secondary call's success", async () => {
    const h = new ProviderHealth();
    await expect(h.track("nhl", async () => Promise.reject(new Error("boom")))).rejects.toThrow("boom");
    await h.track("nhl", async () => 1, false);
    expect(h.snapshot()[0].consecutive_failures).toBe(1);
    await h.track("nhl", async () => 1);
    expect(h.snapshot()[0].consecutive_failures).toBe(0);
  });
});

describe("GET /api/status providers", () => {
  let app: App;
  afterEach(async () => {
    vi.useRealTimers();
    await app.close();
  });

  it("lists providers and warns when a live league's feed keeps failing", async () => {
    app = await createApp({ store: new Store(":memory:"), appKey: "k", appSecret: "s", webDir: "/nonexistent", port: 0 });
    const base = `http://127.0.0.1:${app.port}`;
    app.engine.settings.grid_leagues.push("nhl");
    app.engine.ingestEspn(live());
    const run = (fn: () => Promise<unknown>) => fn().catch(() => {});
    await run(() => app.poller.health.track("espn:nhl", async () => 1));
    let st = (await (await fetch(`${base}/api/status`)).json()) as StatusBody;
    expect(st.providers.find((p) => p.id === "espn:nhl")).toMatchObject({ state: "ok", live_relevant: true, consecutive_failures: 0 });
    expect(st.warnings.join()).not.toMatch(/failing/);

    vi.useFakeTimers({ toFake: ["Date"] });
    const h = app.poller.health as ProviderHealth;
    h.failure("espn:nhl", new Error("HTTP 502"));
    vi.setSystemTime(Date.now() + 75_000);
    h.failure("espn:nhl", new Error("HTTP 502"));
    st = (await (await fetch(`${base}/api/status`)).json()) as StatusBody;
    expect(st.providers.find((p) => p.id === "espn:nhl")).toMatchObject({ state: "failing", consecutive_failures: 2, last_error: "HTTP 502" });
    expect(st.warnings.join()).toMatch(/ESPN NHL feed has been failing for 75 s/);
    expect(typeof st.server_time).toBe("number");
  });
});
