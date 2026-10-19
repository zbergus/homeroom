import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocket, WebSocketServer } from "ws";
import type { Engine } from "../engine/engine.js";
import type { EventPayload, Game } from "../types.js";

/** Pushes already-delayed state/events to the browser views (control, scoreboard, grid, ticker). */
export class UiHub {
  private wss = new WebSocketServer({ noServer: true });
  private views = new Map<WebSocket, string>();
  private heartbeat: ReturnType<typeof setInterval>;

  constructor(private engine: Engine) {
    this.wss.on("connection", (ws) => {
      this.views.set(ws, "unknown");
      ws.on("close", () => this.views.delete(ws));
      ws.on("error", () => this.views.delete(ws));
      ws.on("message", (raw) => {
        try {
          const m = JSON.parse(raw.toString());
          if (m?.t === "hello") this.views.set(ws, String(m.view ?? "unknown"));
        } catch {
          /* ignore */
        }
      });
      ws.send(JSON.stringify({ t: "snapshot", games: [...engine.shown.values()], settings: this.publicSettings() }));
    });
    this.heartbeat = setInterval(() => {
      for (const ws of this.views.keys()) if (ws.readyState === WebSocket.OPEN) ws.ping();
    }, 20_000);
    this.heartbeat.unref();
  }

  private publicSettings() {
    const s = this.engine.settings;
    return { delay_global_s: s.delay_global_s, tts_enabled: s.tts_enabled };
  }

  handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): boolean {
    if (!/^\/ws(\?|$)/.test(req.url ?? "")) return false;
    this.wss.handleUpgrade(req, socket, head, (ws) => this.wss.emit("connection", ws, req));
    return true;
  }

  game(g: Game): void {
    this.broadcast({ t: "game", game: g });
  }
  event(e: EventPayload): void {
    this.broadcast({ t: "event", event: e });
  }

  private broadcast(msg: unknown): void {
    const s = JSON.stringify(msg);
    for (const ws of this.views.keys()) if (ws.readyState === WebSocket.OPEN) ws.send(s);
  }

  close(): void {
    clearInterval(this.heartbeat);
    for (const ws of this.views.keys()) ws.close();
    this.wss.close();
  }
}
