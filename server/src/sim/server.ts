/**
 * Replay server: ESPN-shaped and NHL-shaped endpoints backed by recorded games and a virtual clock.
 * Dev tool, never imported by production code. Point Homeroom at it with
 *   ESPN_BASE=http://127.0.0.1:<port>/espn  ESPN_WEB_BASE=http://127.0.0.1:<port>/espnweb  NHL_BASE=http://127.0.0.1:<port>/nhl
 *
 * Control API:  GET /sim/state   POST /sim/speed {speed}   POST /sim/seek {...}   POST /sim/pause   POST /sim/resume
 *   seek body: {"v_s": 3600}                virtual seconds since sim origin
 *              {"to": "start"|"kickoff"|"final"|"goal:N"|"intermission:N"|"resume:N"|"card:N", "before_s": 15}
 */
import http from "node:http";
import { URL } from "node:url";
import { VirtualClock } from "./clock.js";
import { LEAD_MS, ReplayGame, type Marker } from "./replay.js";

export interface SimServerOptions {
  games: ReplayGame[];
  speed?: number;
  port?: number;
  host?: string;
  /** real-time source, injectable for tests */
  now?: () => number;
  quiet?: boolean;
}

export interface SimServer {
  port: number;
  clock: VirtualClock;
  games: ReplayGame[];
  /** the scheduled start the sim reports for every game (real wall time) */
  startAtMs: number;
  state(): Record<string, unknown>;
  seekTo(spec: string, beforeS?: number): number;
  close(): Promise<void>;
  baseUrls(): { ESPN_BASE: string; ESPN_WEB_BASE: string; NHL_BASE: string };
}

/** today in US Eastern, same as the poller's notion (copied so the sim does not import the poller) */
const easternToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

const json = (res: http.ServerResponse, code: number, body: unknown) => {
  res.writeHead(code, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
};

async function readBody(req: http.IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const s = Buffer.concat(chunks).toString("utf8");
  if (!s) return {};
  try {
    return JSON.parse(s);
  } catch {
    return Object.fromEntries(new URLSearchParams(s));
  }
}

export async function startSimServer(o: SimServerOptions): Promise<SimServer> {
  const now = o.now ?? (() => Date.now());
  const clock = new VirtualClock(o.speed ?? 1, now);
  const games = o.games;
  // Report a scheduled start shortly in the (real) future so the poller's warm/live windows behave naturally.
  const startAtMs = now() + Math.max(5_000, LEAD_MS / (o.speed ?? 1));
  const espnSlug = (g: ReplayGame) => g.league.espn;

  const markersOf = (g: ReplayGame): Marker[] => g.markers();
  const resolveSeek = (spec: string, beforeS = 0): number => {
    const m = /^(\w+)(?::(\d+))?$/.exec(spec);
    if (!m) throw new Error(`bad seek target ${spec}`);
    const [, kind, n] = m;
    const mk = games.flatMap((g) => markersOf(g));
    let v: number | undefined;
    if (kind === "start") v = 0;
    else if (kind === "kickoff") v = Math.min(...games.map((g) => markersOf(g).find((x) => x.label === "game start")!.v));
    else if (kind === "final") v = Math.max(...games.map((g) => g.endV));
    else {
      const list = mk.filter((x) => x.kind === kind).sort((a, b) => a.v - b.v);
      v = list[Number(n ?? 1) - 1]?.v;
    }
    if (v === undefined) throw new Error(`no marker ${spec}`);
    return Math.max(0, v - beforeS * 1000);
  };
  const seekTo = (spec: string, beforeS = 0): number => {
    const v = resolveSeek(spec, beforeS);
    clock.seek(v);
    return v;
  };

  const state = () => {
    const v = clock.v();
    return {
      SIM: true,
      note: "SIMULATION: recorded games replayed through a virtual clock; nothing here is live",
      speed: clock.speed,
      paused: clock.paused,
      virtual_s: Math.round(v / 100) / 10,
      reported_start: new Date(startAtMs).toISOString(),
      games: games.map((g) => ({
        id: g.id,
        title: g.meta.title,
        recorded_date: g.meta.date,
        nhl_id: g.nhlId,
        snapshot: g.snapshot(v),
        end_virtual_s: Math.round(g.endV / 1000),
        markers: markersOf(g).map((x) => ({ kind: x.kind, label: x.label, v_s: Math.round(x.v / 1000) })),
      })),
    };
  };

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://sim");
      const p = url.pathname.replace(/\/+$/, "") || "/";
      const q = url.searchParams;
      const v = clock.v();
      let m: RegExpExecArray | null;

      // ---- control ----------------------------------------------------------------------------------------------
      if (p === "/sim/state" && req.method === "GET") return json(res, 200, state());
      if (p === "/sim/speed" && req.method === "POST") {
        const b = await readBody(req);
        clock.setSpeed(Number(b.speed));
        return json(res, 200, state());
      }
      if (p === "/sim/pause" && req.method === "POST") (clock.pause(), json(res, 200, state()));
      else if (p === "/sim/resume" && req.method === "POST") (clock.resume(), json(res, 200, state()));
      else if (p === "/sim/seek" && req.method === "POST") {
        const b = await readBody(req);
        if (b.to) seekTo(String(b.to), Number(b.before_s ?? 0));
        else if (b.v_s !== undefined) clock.seek(Number(b.v_s) * 1000);
        else return json(res, 400, { error: "need v_s or to" });
        return json(res, 200, state());
      } else if (p === "/" || p === "/sim") {
        res.writeHead(200, { "content-type": "text/plain" });
        return void res.end("Homeroom replay simulator (SIM). GET /sim/state\n");
      }
      if (res.writableEnded || res.headersSent) return;

      // ---- ESPN ------------------------------------------------------------------------------------------------
      if ((m = /^\/espn\/([^/]+\/[^/]+)\/scoreboard$/.exec(p))) {
        const slug = m[1];
        const dates = q.get("dates");
        const today = easternToday().replace(/-/g, "");
        const list = games.filter((g) => espnSlug(g) === slug && (!dates || g.hasDate(dates, today)));
        const day = dates ? `${dates.slice(0, 4)}-${dates.slice(4, 6)}-${dates.slice(6, 8)}` : easternToday();
        return json(res, 200, { leagues: [], day: { date: day }, events: list.map((g) => g.espnEvent(v, startAtMs)) });
      }
      if ((m = /^\/espn\/([^/]+\/[^/]+)\/summary$/.exec(p))) {
        const g = games.find((x) => espnSlug(x) === m![1] && x.meta.espn_id === q.get("event"));
        return g ? json(res, 200, g.espnSummary(v)) : json(res, 404, { error: "unknown event (not recorded)" });
      }
      if ((m = /^\/espn\/([^/]+\/[^/]+)\/teams\/(\d+)\/(schedule|statistics)$/.exec(p))) {
        const kind = m[3] === "schedule" ? "team-schedule" : "team-stats";
        for (const g of games) {
          const f = espnSlug(g) === m[1] ? g.file(`${kind}-${m[2]}.json`) : undefined;
          if (f) return json(res, 200, f);
        }
        return json(res, 404, { error: "not recorded" });
      }
      if ((m = /^\/espnweb\/([^/]+\/[^/]+)\/athletes\/(\d+)\/gamelog$/.exec(p))) {
        for (const g of games) {
          const f = g.file(`gamelog-${m[2]}.json`);
          if (f) return json(res, 200, f);
        }
        return json(res, 404, { error: "not recorded" });
      }

      // ---- NHL api-web -----------------------------------------------------------------------------------------
      if ((m = /^\/nhl\/score\/(now|\d{4}-\d{2}-\d{2})$/.exec(p))) {
        const list = games.map((g) => g.nhlScoreGame(v, startAtMs)).filter(Boolean);
        return json(res, 200, { currentDate: easternToday(), games: list });
      }
      if ((m = /^\/nhl\/gamecenter\/(\d+)\/play-by-play$/.exec(p))) {
        const g = games.find((x) => String(x.nhlId) === m![1]);
        const d = g?.nhlPbpAt(v, startAtMs);
        return d ? json(res, 200, d) : json(res, 404, { error: "unknown game (not recorded)" });
      }
      json(res, 404, { error: `no route ${p}` });
    } catch (err) {
      if (!res.headersSent) json(res, 500, { error: (err as Error).message });
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(o.port ?? 0, o.host ?? "127.0.0.1", resolve);
  });
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : o.port ?? 0;
  if (!o.quiet) console.log(`[sim] SIMULATION replay server on :${port} (${games.length} game(s), speed ${clock.speed}x). Nothing served here is live.`);

  return {
    port,
    clock,
    games,
    startAtMs,
    state,
    seekTo,
    baseUrls: () => ({ ESPN_BASE: `http://127.0.0.1:${port}/espn`, ESPN_WEB_BASE: `http://127.0.0.1:${port}/espnweb`, NHL_BASE: `http://127.0.0.1:${port}/nhl` }),
    close: () => new Promise<void>((resolve) => (server.closeAllConnections?.(), server.close(() => resolve()))),
  };
}
