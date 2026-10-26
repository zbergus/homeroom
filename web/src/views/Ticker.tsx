import { useCallback, useEffect, useRef, useState } from "react";
import type { EventPayload, Game } from "../types";
import { useEvents, useLive } from "../lib/live";
import { useKiosk, useNow, useQueryParam } from "../lib/hooks";
import { useOnlyMine } from "../lib/mine";
import { sortGames, statusText, startMs, timeLabel, countdown } from "../lib/format";
import { ConnDot } from "../components/Kiosk";
import { GoalOverlay, useGoalQueue } from "../kiosk/GoalOverlay";
import { HockeyTickerBanner, findShots, getTickerAlert } from "../components/HockeyTickerBanner";

const CARD_WIDTH_U = 48;
const CARD_GAP_U = 2.5;
const SPEED_PX_PER_SEC = 120; // smooth broadcast ticker speed

function srText(g: Game, now: number): string {
  const a = g.away, h = g.home;
  if (g.status === "pre") {
    const left = startMs(g) - now;
    return `${a.display_name} at ${h.display_name}, ${
      left > 0 && left < 3600_000 ? `starts in ${countdown(left).slice(3)}` : timeLabel(startMs(g))
    }`;
  }
  const sog = findShots(g);
  const sogStr = sog ? `, shots on goal ${a.abbr} ${sog.away} to ${h.abbr} ${sog.home}` : "";
  const alert = getTickerAlert(g);
  const alertStr = alert ? `, ${alert.text}` : "";
  return `${a.display_name} ${a.score ?? 0}, ${h.display_name} ${h.score ?? 0}, ${
    g.status === "post" ? "final" : statusText(g)
  }${sogStr}${alertStr}`;
}

function Strip({
  games,
  now,
  flash,
}: {
  games: Game[];
  now: number;
  flash: Record<string, string>;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [reps, setReps] = useState(1);
  const [dur, setDur] = useState(60);

  // Recalculate track replication only when games count or window size changes,
  // NOT on every tick of `now`. This guarantees continuous, jitter-free marquee motion.
  useEffect(() => {
    const updateMetrics = () => {
      const container = containerRef.current;
      const winW = window.innerWidth;
      const u =
        parseFloat(
          getComputedStyle(container ?? document.documentElement).getPropertyValue("--u"),
        ) || 16;
      const cardFullW = (CARD_WIDTH_U + CARD_GAP_U) * u;
      const slateWidth = games.length * cardFullW;
      if (slateWidth <= 0) return;

      const neededReps = Math.max(1, Math.ceil((winW * 1.25) / slateWidth));
      const totalWidth = neededReps * slateWidth;
      const duration = Math.max(12, totalWidth / SPEED_PX_PER_SEC);

      setReps(neededReps);
      setDur(duration);
    };

    updateMetrics();
    window.addEventListener("resize", updateMetrics);
    return () => window.removeEventListener("resize", updateMetrics);
  }, [games.length]);

  const renderTrack = (prefix: string) =>
    Array.from({ length: reps }, (_, r) => (
      <div key={`${prefix}-${r}`} className="inline-flex items-center shrink-0">
        {games.map((g) => (
          <span
            key={g.id}
            className="inline-block shrink-0"
            style={{ marginRight: `calc(var(--u) * ${CARD_GAP_U})` }}
          >
            <HockeyTickerBanner game={g} now={now} flashAbbr={flash[g.id]} />
          </span>
        ))}
      </div>
    ));

  return (
    <div
      ref={containerRef}
      className="overflow-hidden whitespace-nowrap w-full"
      aria-hidden
    >
      <div
        className="marquee-track inline-flex items-center"
        style={{ ["--dur" as string]: `${dur}s` }}
      >
        <div className="inline-flex shrink-0">{renderTrack("track-a")}</div>
        <div className="inline-flex shrink-0">{renderTrack("track-b")}</div>
      </div>
    </div>
  );
}

export default function Ticker() {
  useKiosk();
  const { games, conn } = useLive("ticker");
  const now = useNow(1000);
  const [flash, setFlash] = useState<Record<string, string>>({});

  useEvents(
    useCallback((e: EventPayload) => {
      if (e.type !== "goal" || !e.team) return;
      const id = e.game.id;
      setFlash((f) => ({ ...f, [id]: e.team!.abbr }));
      setTimeout(
        () =>
          setFlash((f) => {
            const n = { ...f };
            delete n[id];
            return n;
          }),
        8000,
      );
    }, []),
  );

  const mine = useOnlyMine(useQueryParam("only"));
  const goal = useGoalQueue((e) => {
    if (mine === undefined) return true;
    if (mine === null) return false;
    const g = games.get(e.game.id);
    return !!g && mine(g);
  });

  const leagueParam = useQueryParam("league");
  const list = (sortGames([...games.values()]) as Game[])
    .filter((g) => !leagueParam || g.league.toLowerCase() === leagueParam.toLowerCase())
    .filter((g) => mine === undefined || (mine !== null && mine(g)));

  const hasFlash = Object.keys(flash).length > 0;
  const isGoalActive = !!goal.current || hasFlash;

  return (
    <div className="kiosk fixed inset-0 flex flex-col items-center justify-center bg-[#03060a] overflow-hidden select-none">
      <div className="sr-only" role="marquee" aria-live="off">
        {list.map((g) => srText(g, now)).join(". ")}
      </div>

      {/* Authentic ice rink background */}
      <div
        className="pointer-events-none absolute inset-0 opacity-80"
        style={{
          background:
            "radial-gradient(ellipse 90% 75% at 50% 50%, #0d1b2e 0%, #060b14 60%, #020408 100%)",
        }}
      />

      {/* Subtle ice rink arena boundary lines (center red line & zone blue lines) */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden opacity-20">
        <div className="absolute left-1/2 top-0 bottom-0 w-[calc(var(--u)*0.2)] -translate-x-1/2 bg-red-600/40" />
        <div className="absolute left-1/4 top-0 bottom-0 w-[calc(var(--u)*0.15)] bg-blue-600/30" />
        <div className="absolute right-1/4 top-0 bottom-0 w-[calc(var(--u)*0.15)] bg-blue-600/30" />
      </div>

      {/* Arena goal siren pulse on screen edges during goal celebrations */}
      <div
        className={`pointer-events-none absolute inset-x-0 top-0 h-[calc(var(--u)*2)] bg-gradient-to-b from-red-600/60 to-transparent transition-opacity duration-300 z-10 ${
          isGoalActive ? "opacity-100 animate-pulse" : "opacity-0"
        }`}
      />
      <div
        className={`pointer-events-none absolute inset-x-0 bottom-0 h-[calc(var(--u)*2)] bg-gradient-to-t from-red-600/60 to-transparent transition-opacity duration-300 z-10 ${
          isGoalActive ? "opacity-100 animate-pulse" : "opacity-0"
        }`}
      />

      {/* Arena ribbon board: top and bottom metallic rails with LED glow */}
      <div className="relative w-full flex flex-col items-center z-20">
        {/* Top rail */}
        <div
          className={`h-[calc(var(--u)*0.35)] w-full transition-all duration-300 ${
            isGoalActive
              ? "bg-gradient-to-r from-red-600 via-amber-400 to-red-600 shadow-[0_0_2.5vmin_rgba(239,68,68,0.9)]"
              : "bg-gradient-to-r from-cyan-500/20 via-cyan-400/60 to-cyan-500/20 shadow-[0_0_1.5vmin_rgba(6,182,212,0.4)]"
          }`}
        />

        {/* Dual-banner ribbon display track */}
        <div
          className={`relative w-full py-[calc(var(--u)*1.5)] transition-all duration-500 ease-out ${
            goal.current ? "opacity-35 scale-[0.98] blur-[0.5px]" : "opacity-100 scale-100"
          }`}
        >
          {/* Authentic ice sheen reflection sweep */}
          <div className="ice-sheen-sweep pointer-events-none absolute inset-0 z-10 w-1/3 bg-gradient-to-r from-transparent via-white/5 to-transparent skew-x-[-20deg]" />

          {list.length ? (
            <Strip games={list} now={now} flash={flash} />
          ) : (
            <div
              className="flex items-center justify-center py-[calc(var(--u)*4)] font-display font-black uppercase tracking-widest text-slate-400"
              style={{ fontSize: "calc(var(--u) * 2.4)" }}
            >
              Waiting for hockey slate
            </div>
          )}
        </div>

        {/* Bottom rail */}
        <div
          className={`h-[calc(var(--u)*0.35)] w-full transition-all duration-300 ${
            isGoalActive
              ? "bg-gradient-to-r from-red-600 via-amber-400 to-red-600 shadow-[0_0_2.5vmin_rgba(239,68,68,0.9)]"
              : "bg-gradient-to-r from-cyan-500/20 via-cyan-400/60 to-cyan-500/20 shadow-[0_0_1.5vmin_rgba(6,182,212,0.4)]"
          }`}
        />
      </div>

      {/* Goal celebration overlay takeover */}
      <GoalOverlay event={goal.current} pending={goal.pending} />

      {/* Tiny unobtrusive connection indicator */}
      <ConnDot conn={conn} />
    </div>
  );
}
