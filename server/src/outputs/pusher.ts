import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocket, WebSocketServer } from "ws";
import type { Store } from "../store.js";

interface Client {
  ws: WebSocket;
  id: string;
  channels: Set<string>;
  alive: boolean;
}

const MAX_FRAME_BYTES = 16 * 1024;
const MAX_CLIENTS = 100;

/**
 * Minimal Pusher-protocol (v7) server: just what pysher / the ConnectedRoom HA integration needs.
 * Public + private channels, pusher:ping/pong, signed subscription auth. No presence, no client events.
 */
export class PusherHub {
  // Pusher frames are tiny; the library default of 100 MiB would let any client on the network make us buffer and parse that much
  private wss = new WebSocketServer({ noServer: true, maxPayload: MAX_FRAME_BYTES });
  private clients = new Set<Client>();
  private heartbeat: ReturnType<typeof setInterval>;

  constructor(
    private store: Store,
    readonly appKey: string,
    private appSecret: string,
  ) {
    this.heartbeat = setInterval(() => {
      for (const c of this.clients) {
        if (!c.alive) {
          c.ws.terminate();
          continue;
        }
        c.alive = false;
        try {
          c.ws.ping();
        } catch {
          /* closing */
        }
      }
    }, 25_000);
    this.heartbeat.unref();
  }

  close(): void {
    clearInterval(this.heartbeat);
    for (const c of this.clients) c.ws.close();
    this.wss.close();
  }

  sign(socketId: string, channel: string): string {
    return `${this.appKey}:${createHmac("sha256", this.appSecret).update(`${socketId}:${channel}`).digest("hex")}`;
  }

  /** Is this private channel one we issued to some linked integration? */
  channelKnown(channel: string): boolean {
    for (const l of this.store.allLinks()) {
      if (channel === `private-${l.unique_id}` || channel === `private-home-assistant.${l.integration_key}`) return true;
    }
    return false;
  }

  handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): boolean {
    const m = /^\/app\/([^/?]+)/.exec(req.url ?? "");
    if (!m) return false;
    if (m[1] !== this.appKey) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return true;
    }
    this.wss.handleUpgrade(req, socket, head, (ws) => this.onConnection(ws));
    return true;
  }

  private onConnection(ws: WebSocket): void {
    if (this.clients.size >= MAX_CLIENTS) {
      ws.close(1013, "too many connections");
      return;
    }
    const client: Client = { ws, id: `${randomInt(1e6)}.${randomInt(1e6)}`, channels: new Set(), alive: true };
    this.clients.add(client);
    ws.on("pong", () => (client.alive = true));
    ws.on("close", () => this.clients.delete(client));
    ws.on("error", () => this.clients.delete(client));
    ws.on("message", (raw) => {
      client.alive = true;
      try {
        this.onMessage(client, JSON.parse(raw.toString()));
      } catch {
        this.send(client, "pusher:error", { code: 4001, message: "Invalid message" });
      }
    });
    this.send(client, "pusher:connection_established", { socket_id: client.id, activity_timeout: 30 });
  }

  private onMessage(c: Client, msg: { event?: string; data?: unknown }): void {
    const data = (typeof msg.data === "string" ? safeJson(msg.data) : msg.data) as Record<string, string> | undefined;
    switch (msg.event) {
      case "pusher:ping":
        this.send(c, "pusher:pong", {});
        return;
      case "pusher:subscribe": {
        const channel = data?.channel;
        if (!channel) return this.send(c, "pusher:error", { code: 4009, message: "Missing channel" });
        if (channel.startsWith("private-")) {
          const expected = Buffer.from(this.sign(c.id, channel));
          const given = Buffer.from(data?.auth ?? "");
          const ok = given.length === expected.length && timingSafeEqual(given, expected) && this.channelKnown(channel);
          if (!ok) return this.send(c, "pusher:error", { code: 4009, message: `Unauthorized subscription to ${channel}` });
        }
        c.channels.add(channel);
        this.send(c, "pusher_internal:subscription_succeeded", {}, channel);
        return;
      }
      case "pusher:unsubscribe":
        if (data?.channel) c.channels.delete(data.channel);
        return;
      default:
        // client events are not supported
        return;
    }
  }

  private send(c: Client, event: string, data: unknown, channel?: string): void {
    if (c.ws.readyState !== WebSocket.OPEN) return;
    c.ws.send(JSON.stringify({ event, ...(channel ? { channel } : {}), data: JSON.stringify(data) }));
  }

  subscribers(channel: string): number {
    let n = 0;
    for (const c of this.clients) if (c.channels.has(channel)) n++;
    return n;
  }

  /** Publish to a channel. `data` is JSON-encoded into a string, as Pusher does and pysher/HA expect. */
  broadcast(channel: string, event: string, data: unknown): number {
    let n = 0;
    for (const c of this.clients) {
      if (c.channels.has(channel)) {
        this.send(c, event, data, channel);
        n++;
      }
    }
    return n;
  }
}

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return undefined;
  }
}
