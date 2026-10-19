import { useEffect, useSyncExternalStore } from "react";
import type { EventPayload, Game, ServerMsg, Settings, ViewName } from "../types";

export type ConnState = "connecting" | "open" | "closed" | "mock";

interface Snap {
  games: Map<string, Game>;
  conn: ConnState;
  settings?: Settings;
  lastEvent?: EventPayload;
}

export const isMockUrl = () => new URLSearchParams(location.search).get("mock") === "1";
const envMock = () => import.meta.env.VITE_MOCK === "1";

let snap: Snap = { games: new Map(), conn: "connecting" };
const subs = new Set<() => void>();
const evSubs = new Set<(e: EventPayload) => void>();
const set = (p: Partial<Snap>) => { snap = { ...snap, ...p }; subs.forEach((f) => f()); };

const sink = {
  snapshot: (gs: Game[]) => set({ games: new Map(gs.map((g) => [g.id, g])) }),
  game: (g: Game) => { const m = new Map(snap.games); m.set(g.id, g); set({ games: m }); },
  event: (e: EventPayload) => { set({ lastEvent: e }); evSubs.forEach((f) => f(e)); },
};

let refs = 0;
let view: ViewName = "control";
let gameId: string | undefined;
let ws: WebSocket | null = null;
let retry = 0;
let timer: ReturnType<typeof setTimeout> | undefined;
let stopMock: (() => void) | undefined;
let wsEver = false;

let mockLoading = false;
function beginMock() {
  if (stopMock || mockLoading) return;
  mockLoading = true;
  set({ conn: "mock" });
  // the mock feed is only for ?mock=1 and VITE_MOCK builds: its own chunk, never downloaded in normal use
  void import("./mock").then(
    ({ startMock }) => {
      mockLoading = false;
      if (refs > 0 && !stopMock) stopMock = startMock(sink);
    },
    () => { mockLoading = false; },
  );
}

function connect() {
  if (isMockUrl()) return beginMock();
  set({ conn: "connecting" });
  const proto = location.protocol === "https:" ? "wss" : "ws";
  const sock = new WebSocket(`${proto}://${location.host}/ws`);
  ws = sock;
  sock.onopen = () => {
    retry = 0; wsEver = true;
    set({ conn: "open" });
    sock.send(JSON.stringify({ t: "hello", view, ...(gameId && gameId !== "auto" ? { game_id: gameId } : {}) }));
  };
  sock.onmessage = (ev) => {
    let m: ServerMsg;
    try { m = JSON.parse(ev.data as string); } catch { return; }
    if (m.t === "snapshot") { sink.snapshot(m.games ?? []); if (m.settings) set({ settings: m.settings }); }
    else if (m.t === "game") sink.game(m.game);
    else if (m.t === "event") sink.event(m.event);
  };
  sock.onclose = () => {
    if (ws !== sock) return;
    ws = null;
    set({ conn: "closed" });
    if (!refs) return;
    if (!wsEver && envMock()) { beginMock(); return; }
    const delay = Math.min(15000, 500 * 2 ** retry++) * (0.75 + Math.random() * 0.5);
    timer = setTimeout(connect, delay);
  };
  sock.onerror = () => sock.close();
}

function acquire(v: ViewName, g?: string) {
  view = v; gameId = g;
  if (refs++ === 0) connect();
  else if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ t: "hello", view: v, ...(g && g !== "auto" ? { game_id: g } : {}) }));
}
function release() {
  if (--refs > 0) return;
  clearTimeout(timer);
  const s = ws; ws = null; s?.close();
  stopMock?.(); stopMock = undefined;
  snap = { games: new Map(), conn: "connecting" };
}

const subscribe = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };
const getSnap = () => snap;

/** Shared WebSocket client hook. Renders exactly what the server sends (delay is server-side). */
export function useLive(v: ViewName, game?: string): Snap {
  useEffect(() => { acquire(v, game); return release; }, [v, game]);
  return useSyncExternalStore(subscribe, getSnap);
}

/** Subscribe to the raw event stream (goal, period_*, game_*). */
export function useEvents(cb: (e: EventPayload) => void) {
  useEffect(() => {
    evSubs.add(cb);
    return () => { evSubs.delete(cb); };
  }, [cb]);
}
