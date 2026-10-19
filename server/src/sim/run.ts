/**
 * `npm run sim -- --game nhl:401892525 [--game epl:401879263] [--speed 60] [--delay 10] [--start goal:2 --before 20]`
 *
 * Starts the replay server AND an in-process Homeroom instance pointed at it (throw-away DATA_DIR/MEDIA_DIR, the games
 * synced). DEV ONLY: nothing here runs in production, and provider base URLs only change when this script sets them.
 *
 *   --game <league>:<espnId>   recorded game (server/test/fixtures/replay/<league>-<id>); repeatable or comma separated
 *   --speed <x>                virtual speed (default 10)
 *   --delay <s>                global delay buffer in seconds (default 5)
 *   --start <target>           seek before the first poll: kickoff | goal:N | intermission:N | card:N | final | v:<seconds>
 *   --before <s>               seconds before the target (default 10)
 *   --port <p>                 replay server port (default 18101); Homeroom listens on p+1
 *   --phantom <s>:<home|away>:<hold_s>  inject an overturned goal into the first game at virtual second <s> (default hold 45 s)
 *   --server-only              only the replay server (point your own instance at it)
 *   --data-dir <dir>           default /tmp/hr-sim/data-<port>
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

function parseArgs(argv: string[]) {
  const o: Record<string, string[]> = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith("--")) continue;
    const k = argv[i].slice(2);
    const next = argv[i + 1];
    const v = next === undefined || next.startsWith("--") ? "true" : argv[++i];
    (o[k] ??= []).push(v);
  }
  return o;
}

const a = parseArgs(process.argv.slice(2));
const here = path.dirname(fileURLToPath(import.meta.url));
const replayRoot = a["replay-dir"]?.at(-1) ?? path.resolve(here, "../../test/fixtures/replay");
const gameSpecs = (a.game ?? []).flatMap((s) => s.split(",")).filter(Boolean);
if (!gameSpecs.length) {
  const have = fs.existsSync(replayRoot) ? fs.readdirSync(replayRoot).map((d) => d.replace("-", ":")) : [];
  console.error(`usage: npm run sim -- --game <league>:<espnId> [--speed 60]\nrecorded games: ${have.join(", ") || "(none; run scripts/record-game.mjs)"}`);
  process.exit(2);
}
const speed = Number(a.speed?.at(-1) ?? 10);
const delayS = Number(a.delay?.at(-1) ?? 5);
const simPort = Number(a.port?.at(-1) ?? 18101);
const dataDir = a["data-dir"]?.at(-1) ?? `/tmp/hr-sim/data-${simPort}`;

// The base URLs and data dirs are read when the provider/store modules load, so set them before importing anything else.
const simBase = `http://127.0.0.1:${simPort}`;
process.env.ESPN_BASE = `${simBase}/espn`;
process.env.ESPN_WEB_BASE = `${simBase}/espnweb`;
process.env.NHL_BASE = `${simBase}/nhl`;
process.env.DATA_DIR = dataDir;
process.env.MEDIA_DIR = path.join(dataDir, "media");
if (!a["server-only"]) {
  fs.mkdirSync(path.join(dataDir, "media"), { recursive: true });
  for (const f of ["homeroom.db", "homeroom.db-wal", "homeroom.db-shm"]) fs.rmSync(path.join(dataDir, f), { force: true }); // always a clean slate
}

const banner = "=".repeat(78);
console.log(`${banner}\n  SIM MODE: replaying recorded games. Nothing below is live. Do not point production at this.\n${banner}`);

const { ReplayGame } = await import("./replay.js");
const { startSimServer } = await import("./server.js");
const games = gameSpecs.map((s) => {
  const [league, id] = s.split(":");
  const dir = path.join(replayRoot, `${league}-${id}`);
  if (!fs.existsSync(dir)) throw new Error(`no recording at ${dir}`);
  return new ReplayGame(dir);
});

if (a.phantom?.at(-1)) {
  const [at, side, hold] = a.phantom.at(-1)!.split(":");
  if (side !== "home" && side !== "away") throw new Error("--phantom <seconds>:<home|away>[:<hold seconds>]");
  games[0].setPhantom(Number(at), side, Number(hold ?? 45));
  console.log(`[sim] phantom (to-be-overturned) goal for ${side} at virtual ${at}s, held ${hold ?? 45}s`);
}

const sim = await startSimServer({ games, speed, port: simPort });
if (a.start?.at(-1)) {
  const t = a.start.at(-1)!;
  const before = Number(a.before?.at(-1) ?? 10);
  if (t.startsWith("v:")) sim.clock.seek(Number(t.slice(2)) * 1000);
  else sim.seekTo(t, before);
  console.log(`[sim] seeked to ${t} (virtual ${Math.round(sim.clock.v() / 1000)} s)`);
}

let closeApp: () => Promise<void> = async () => {};
if (!a["server-only"]) {
  const { createApp } = await import("../app.js");
  const { Store } = await import("../store.js");
  const store = new Store(path.join(dataDir, "homeroom.db"));
  const leagues = [...new Set(games.map((g) => g.league.id))];
  const err = store.patchSettings({
    delay_global_s: delayS,
    enabled_leagues: leagues,
    grid_leagues: leagues,
    poll_live_s: speed >= 5 ? 1 : 2.5,
    nhl_fast_poll_ms: speed >= 5 ? 500 : 1000,
    auto_sync_favorites: false,
  });
  if (err) throw new Error(err);
  store.setSyncedGames(games.map((g) => g.id));
  const webDir = process.env.WEB_DIR ?? path.resolve(here, "../../../web/dist");
  const appPort = simPort + 1;
  const app = await createApp({ store, appKey: "sim-key", appSecret: "sim-secret", webDir, port: appPort, startPoller: true });
  closeApp = () => app.close();
  console.log(`[sim] Homeroom (SIM) on http://127.0.0.1:${app.port}  data ${dataDir}  delay ${delayS}s`);
  for (const g of games) {
    console.log(`[sim]   scoreboard: http://127.0.0.1:${app.port}/scoreboard?game=${encodeURIComponent(g.id)}`);
  }
  console.log(`[sim]   grid:       http://127.0.0.1:${app.port}/grid`);
  console.log(`[sim]   ticker:     http://127.0.0.1:${app.port}/ticker`);
  console.log(`[sim]   dashboard:  http://127.0.0.1:${app.port}/`);
}
console.log(`[sim] control: curl ${simBase}/sim/state | curl -XPOST ${simBase}/sim/speed -d '{"speed":60}' | curl -XPOST ${simBase}/sim/seek -d '{"to":"goal:2","before_s":15}'`);
console.log(`[sim] speed ${speed}x; recording is ~${Math.round(Math.max(...games.map((g) => g.endV)) / 60000)} virtual min, ~${Math.round(Math.max(...games.map((g) => g.endV)) / 60000 / speed)} real min`);

const shutdown = async () => {
  await closeApp();
  await sim.close();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
