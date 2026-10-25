import type { FastifyInstance } from "fastify";
import { type Config, loadConfig } from "./config.js";
import { Engine } from "./engine/engine.js";
import { Poller } from "./engine/poller.js";
import type { HornService } from "./audio/horns.js";
import { buildHttp } from "./http.js";
import { Dispatcher } from "./outputs/dispatch.js";
import { HaOutputs } from "./outputs/ha.js";
import { LightRules } from "./outputs/lights.js";
import { PusherHub } from "./outputs/pusher.js";
import { UiHub } from "./outputs/ui.js";
import { isCrossSite } from "./security.js";
import { Store } from "./store.js";

interface AppOptions {
  store?: Store | undefined;
  appKey: string;
  appSecret: string;
  webDir: string;
  /** listen on this port (0 = ephemeral); omit to build without listening */
  port?: number | undefined;
  startPoller?: boolean | undefined;
  /** defaults to `loadConfig()` (the process environment) */
  config?: Config | undefined;
  engineDeps?: ConstructorParameters<typeof Engine>[2] | undefined;
  /** tests inject a HornService with a fake ffmpeg runner and a temp cache */
  horns?: HornService | undefined;
}

export interface App {
  http: FastifyInstance;
  store: Store;
  engine: Engine;
  poller: Poller;
  hub: PusherHub;
  ui: UiHub;
  lights: LightRules;
  ha: HaOutputs;
  dispatcher: Dispatcher;
  port: number;
  close(): Promise<void>;
}

/** Wires every component together. index.ts runs it for real; tests build it with an in-memory store. */
export async function createApp(o: AppOptions): Promise<App> {
  const config = o.config ?? loadConfig();
  const store = o.store ?? new Store();
  const engine = new Engine(store, undefined, { restoreGraceMs: config.restoreGraceMs, ...o.engineDeps });
  const poller = new Poller(engine);
  const hub = new PusherHub(store, o.appKey, o.appSecret);
  const lights = new LightRules(engine, hub);
  const ha = new HaOutputs(engine, hub);
  const ui = new UiHub(engine);
  const dispatcher = new Dispatcher(engine, ui, ha, lights);

  // Everything below runs *after* the stream-sync delay.
  engine.on("game", (g) => ui.game(g));
  engine.on("event", (e) => dispatcher.handle(e));
  engine.on("refresh", () => ui.snapshot());
  // events that were still inside the delay window when the process last stopped
  const restored = engine.restore();
  if (restored.requeued || restored.dropped) console.log(`[engine] restored ${restored.requeued} pending event(s), dropped ${restored.dropped} stale`);

  const http = await buildHttp({ engine, poller, hub, lights, ha, dispatcher, webDir: o.webDir, horns: o.horns, config, startedAt: Date.now() });
  http.server.on("upgrade", (req, socket, head) => {
    // a web page on another site must not be able to open these sockets from a browser on this network
    if (isCrossSite(req.headers, config.allowedOrigins)) {
      socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
      socket.destroy();
      return;
    }
    if (!hub.handleUpgrade(req, socket, head) && !ui.handleUpgrade(req, socket, head)) socket.destroy();
  });

  let port = 0;
  if (o.port !== undefined) {
    await http.listen({ port: o.port, host: o.port === 0 ? "127.0.0.1" : "0.0.0.0" });
    const addr = http.server.address();
    port = typeof addr === "object" && addr ? addr.port : o.port;
  }
  if (o.startPoller) poller.start();

  return {
    http, store, engine, poller, hub, ui, lights, ha, dispatcher, port,
    async close() {
      poller.stop();
      hub.close();
      ui.close();
      await http.close();
    },
  };
}
