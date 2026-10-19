import { useCallback, useEffect, useRef, useState } from "react";
import type { EventPayload } from "../types";
import { useEvents } from "../lib/live";
import { teamColors } from "../lib/format";
import { TeamBadge } from "../components/Kiosk";

const OVERLAY_MS = 6000;

/** Queue of goal events matching `match`; yields the one currently on screen. */
export function useGoalQueue(match: (e: EventPayload) => boolean, ms = OVERLAY_MS) {
  const [queue, setQueue] = useState<EventPayload[]>([]);
  const m = useRef(match); m.current = match;
  const seen = useRef(new Set<string>());
  useEvents(useCallback((e: EventPayload) => {
    if (e.type !== "goal" || !m.current(e) || seen.current.has(e.event_id)) return;
    seen.current.add(e.event_id);
    setQueue((q) => [...q, e]);
  }, []));
  const head = queue[0];
  useEffect(() => {
    if (!head) return;
    const t = setTimeout(() => setQueue((q) => q.slice(1)), ms);
    return () => clearTimeout(t);
  }, [head, ms]);
  return { current: head, pending: Math.max(0, queue.length - 1) };
}

export function GoalOverlay({ event, pending }: { event?: EventPayload; pending: number }) {
  if (!event) return null;
  const { game, team, scoring } = event;
  const label = (scoring?.label ?? "GOAL").toUpperCase();
  const text = /[!?]$/.test(label) ? label : `${label}!`;
  const colors = team ? teamColors(team) : { primary: "#1f7bff", secondary: "#0b3a8a" };
  const home = game.home, away = game.away;
  const scorerLine = scoring?.scorer ?? team?.display_name;
  return (
    <div
      key={event.event_id}
      role="alert"
      aria-live="assertive"
      className="fixed inset-0 z-40 flex flex-col items-center justify-center overflow-hidden text-white"
      style={{ background: `radial-gradient(120% 90% at 50% 40%, ${colors.primary} 0%, ${colors.secondary} 70%, #000 140%)` }}
    >
      <div className="goal-sweep pointer-events-none absolute inset-y-0 left-0 w-1/4 bg-white/25 blur-xl" />
      <div className="goal-enter flex flex-col items-center text-center" style={{ gap: "calc(var(--u) * 2)" }}>
        {team && <TeamBadge team={team} size="calc(var(--u) * 8)" />}
        <div
          className="goal-text font-black uppercase leading-none"
          style={{ fontSize: "calc(var(--u) * 13)", textShadow: "0 .04em .25em rgba(0,0,0,.45)" }}
        >
          {text}
        </div>
        {team && (
          <div className="font-extrabold uppercase tracking-wide opacity-95" style={{ fontSize: "calc(var(--u) * 3.4)" }}>
            {team.display_name}
          </div>
        )}
        {scorerLine && scoring?.scorer && (
          <div className="font-semibold" style={{ fontSize: "calc(var(--u) * 3)" }}>{scorerLine}</div>
        )}
        {scoring?.assists && scoring.assists.length > 0 && (
          <div className="opacity-80" style={{ fontSize: "calc(var(--u) * 1.9)" }}>
            Assists: {scoring.assists.join(", ")}
          </div>
        )}
        {scoring && (
          <div
            className="num mt-[calc(var(--u)*1.5)] flex items-center rounded-full bg-black/40 font-black backdrop-blur"
            style={{ gap: "calc(var(--u) * 3)", padding: "calc(var(--u) * 1) calc(var(--u) * 4)", fontSize: "calc(var(--u) * 5)" }}
          >
            <span className="flex items-center" style={{ gap: "calc(var(--u) * 1.5)" }}>
              <span style={{ fontSize: "calc(var(--u) * 2.4)" }} className="opacity-80">{away.abbr}</span>
              {scoring.away_score}
            </span>
            <span className="opacity-50">–</span>
            <span className="flex items-center" style={{ gap: "calc(var(--u) * 1.5)" }}>
              {scoring.home_score}
              <span style={{ fontSize: "calc(var(--u) * 2.4)" }} className="opacity-80">{home.abbr}</span>
            </span>
          </div>
        )}
      </div>
      {pending > 0 && (
        <div className="absolute bottom-[3vmin] right-[3vmin] rounded-full bg-black/50 px-[1.6vmin] py-[.6vmin] font-bold" style={{ fontSize: "calc(var(--u) * 1.6)" }}>
          +{pending} more
        </div>
      )}
    </div>
  );
}
