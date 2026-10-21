import { useCallback, useLayoutEffect, useRef, useState } from "react";
import type { EventPayload, Game } from "../types";
import { useEvents, useLive } from "../lib/live";
import { useKiosk, useNow, useQueryParam } from "../lib/hooks";
import { useOnlyMine } from "../lib/mine";
import { sortGames, statusText, startMs, timeLabel, countdown } from "../lib/format";
import { ConnDot } from "../components/Kiosk";
import { GameBars } from "../components/GameBars";
import { GoalOverlay, useGoalQueue } from "../kiosk/GoalOverlay";

const SPEED = 170; // px per second

function srText(g: Game, now: number): string {
  const a = g.away, h = g.home;
  if (g.status === "pre") {
    const left = startMs(g) - now;
    return `${a.display_name} at ${h.display_name}, ${left > 0 && left < 3600_000 ? `starts in ${countdown(left).slice(3)}` : timeLabel(startMs(g))}`;
  }
  return `${a.display_name} ${a.score ?? 0}, ${h.display_name} ${h.score ?? 0}, ${g.status === "post" ? "final" : statusText(g)}`;
}

function Strip({ games, now, flash }: { games: Game[]; now: number; flash: Record<string, string> }) {
  const unit = useRef<HTMLDivElement>(null);
  const [m, setM] = useState({ reps: 1, dur: 60 });
  const last = useRef(0);
  useLayoutEffect(() => {
    const w = unit.current?.offsetWidth ?? 0;
    if (!w || Math.abs(w - last.current) < 40) return;
    last.current = w;
    const reps = Math.max(1, Math.ceil((window.innerWidth * 1.1) / w));
    setM({ reps, dur: Math.max(10, (reps * w) / SPEED) });
  });
  const half = (k: string) => Array.from({ length: m.reps }, (_, r) => (
    <div key={`${k}${r}`} ref={k === "a" && r === 0 ? unit : undefined} className="inline-flex items-center">
      {games.map((g) => (
        <span key={g.id} className="inline-block" style={{ paddingRight: "1.8em" }}>
          <GameBars game={g} now={now} flashAbbr={flash[g.id]} />
        </span>
      ))}
    </div>
  ));
  return (
    <div className="overflow-hidden whitespace-nowrap" aria-hidden>
      <div className="marquee-track inline-flex" style={{ ["--dur" as string]: `${m.dur}s` }}>
        <div className="inline-flex">{half("a")}</div>
        <div className="inline-flex">{half("b")}</div>
      </div>
    </div>
  );
}

export default function Ticker() {
  useKiosk();
  const { games, conn } = useLive("ticker");
  const now = useNow(1000);
  const [flash, setFlash] = useState<Record<string, string>>({});
  useEvents(useCallback((e: EventPayload) => {
    if (e.type !== "goal" || !e.team) return;
    const id = e.game.id;
    setFlash((f) => ({ ...f, [id]: e.team!.abbr }));
    setTimeout(() => setFlash((f) => { const n = { ...f }; delete n[id]; return n; }), 8000);
  }, []));

  const mine = useOnlyMine(useQueryParam("only"));
  const goal = useGoalQueue((e) => {
    if (mine === undefined) return true;
    if (mine === null) return false;
    const g = games.get(e.game.id);
    return !!g && mine(g);
  });
  const list = (sortGames([...games.values()]) as Game[]).filter((g) => mine === undefined || (mine !== null && mine(g)));
  return (
    <div className="kiosk fixed inset-0 flex items-center bg-black">
      <div className="sr-only" role="marquee" aria-live="off">{list.map((g) => srText(g, now)).join(". ")}</div>
      <div className="led-panel relative w-full" style={{ fontSize: "min(9.5vh, 5.2vw)", ["--dot" as string]: "min(.85vh, .48vw)" }}>
        {list.length ? (
          <Strip games={list} now={now} flash={flash} />
        ) : (
          <div className="px-[2vw] font-display font-black uppercase tracking-widest text-white">Waiting for games</div>
        )}
        <div className="led-dots pointer-events-none absolute inset-0" />
      </div>
      <GoalOverlay event={goal.current} pending={goal.pending} />
      <ConnDot conn={conn} />
    </div>
  );
}
