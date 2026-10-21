import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocket, WebSocketServer } from "ws";
import type { Engine } from "../engine/engine.js";
import type { EventPayload, Game } from "../types.js";

const MAX_FRAME_BYTES = 4 * 1024;
const MAX_VIEWS = 200;

/** Pushes already-delayed state/events to the browser views (control, scoreboard, grid, ticker). */
export class UiHub {
  private wss = new WebSocketServer({ noServer: true, maxPayload: MAX_FRAME_BYTES });
  private views = new Map<WebSocket, string>();
  private heartbeat: ReturnType<typeof setInterval>;

  constructor(private engine: Engine) {
    this.wss.on("connection", (ws) => {
      if (this.views.size >= MAX_VIEWS) {
        ws.close(1013, "too many connections");
        return;
      }
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
      ws.send(JSON.stringify({ t: "snapshot", games: [...engine.shown.values()], settings: this.publicSettings(), server_now_ms: Date.now() }));
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
    this.broadcast({ t: "game", game: g, server_now_ms: Date.now() });
  }
  event(e: EventPayload): void {
    this.broadcast({ t: "event", event: e });
  }
  /** Replace every viewer's game map (e.g. after simulation stop removes nhl:sim). */
  snapshot(): void {
    this.broadcast({ t: "snapshot", games: [...this.engine.shown.values()], settings: this.publicSettings(), server_now_ms: Date.now() });
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
