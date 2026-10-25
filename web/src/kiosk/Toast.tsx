import { useCallback, useEffect, useRef, useState } from "react";
import type { EventPayload } from "../types";
import { useEvents } from "../lib/live";
import { resolveTeam } from "../lib/colors";
import { TeamBadge } from "../components/Kiosk";

const TOAST_MS = 5000;

/** Latest goal_overturned event matching `match`, held for ~5 s. */
export function useOverturned(match: (e: EventPayload) => boolean, ms = TOAST_MS) {
  const [ev, setEv] = useState<EventPayload>();
  const m = useRef(match); m.current = match;
  useEvents(useCallback((e: EventPayload) => { if (e.type === "goal_overturned" && m.current(e)) setEv(e); }, []));
  useEffect(() => {
    if (!ev) return;
    const t = setTimeout(() => setEv(undefined), ms);
    return () => clearTimeout(t);
  }, [ev, ms]);
  return ev;
}

/** Small non-blocking banner at the top of the screen. */
export function OverturnedToast({ event }: { event?: EventPayload | undefined }) {
  if (!event) return null;
  const team = event.team ?? event.game.home;
  const c = resolveTeam(team);
  const s = event.scoring;
  return (
    <div
      key={event.event_id}
      role="status"
      className="toast-banner pointer-events-none fixed left-1/2 top-[calc(var(--u0)*2)] z-30 flex items-center font-display text-white"
      style={{ gap: "calc(var(--u0) * 1.6)", padding: "calc(var(--u0) * 1) calc(var(--u0) * 2.6)", borderRadius: "calc(var(--u0) * 1.2)", background: `linear-gradient(90deg, ${c.fill}, ${c.deep})`, boxShadow: "0 0 0 .25vmin rgba(255,255,255,.8), 0 1vmin 3vmin rgba(0,0,0,.6)" }}
    >
      <TeamBadge team={team} size="calc(var(--u0) * 4.4)" />
      <div>
        <div className="font-black uppercase leading-none tracking-wide" style={{ fontSize: "calc(var(--u0) * 3.2)" }}>Goal disallowed</div>
        <div className="num font-semibold uppercase opacity-90" style={{ fontSize: "calc(var(--u0) * 1.6)", marginTop: "calc(var(--u0) * .3)" }}>
          {team.display_name}{s ? ` · ${event.game.away.abbr} ${s.away_score}-${s.home_score} ${event.game.home.abbr}` : ""}
        </div>
      </div>
    </div>
  );
}
