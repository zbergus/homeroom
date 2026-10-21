import { useCallback, useEffect, useRef, useState } from "react";
import type { CelebrationVideo, EventPayload, Team } from "../types";
import { api } from "../lib/api";
import { celebrationCandidates } from "../lib/celebrations";
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

function VideoClip({ src, onActive, onFailure, onEnd }: {
  src: string;
  onActive: (active: boolean) => void;
  onFailure: () => void;
  onEnd: () => void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const [buffering, setBuffering] = useState(true);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = video.current;
    let dead = false;
    if (el) void el.play().catch(() => { if (!dead) onFailure(); });
    return () => { dead = true; el?.pause(); };
  }, [src, onFailure]);
  useEffect(() => {
    if (!buffering) return;
    const timer = setTimeout(onFailure, 1500);
    return () => clearTimeout(timer);
  }, [buffering, onFailure]);
  return (
    <video ref={video} src={src} muted playsInline preload="auto" aria-hidden="true"
      className={`pointer-events-none absolute inset-0 z-[1] h-full w-full object-contain ${visible ? "" : "invisible"}`}
      onPlaying={() => { setBuffering(false); setVisible(true); onActive(true); }}
      onWaiting={() => { setBuffering(true); setVisible(false); onActive(false); }}
      onError={onFailure} onEnded={onEnd}>
      <track kind="captions" />
    </video>
  );
}

function CelebrationVideoLayer({ event, videos, onActive }: {
  event: EventPayload;
  videos: CelebrationVideo[];
  onActive: (active: boolean) => void;
}) {
  const [failed, setFailed] = useState<string[]>([]);
  const [finished, setFinished] = useState(false);
  const [reduced, setReduced] = useState(() => window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => { setReduced(mq.matches); if (mq.matches) onActive(false); };
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, [onActive]);
  const source = celebrationCandidates(event, videos).find((url) => !failed.includes(url));
  useEffect(() => { onActive(false); }, [source, onActive]);
  const fail = useCallback(() => {
    onActive(false);
    if (source) setFailed((prev) => prev.includes(source) ? prev : [...prev, source]);
  }, [source, onActive]);
  const end = useCallback(() => { onActive(false); setFinished(true); }, [onActive]);
  if (!source || reduced || finished) return null;
  return <VideoClip key={source} src={source} onActive={onActive} onFailure={fail} onEnd={end} />;
}

/** Companion-wall fallback: tiled label in team colours with a centred badge (ConnectedRoom-style). */
function GoalWall({ label, team, colors }: { label: string; team?: Team | undefined; colors: { primary: string; secondary: string } }) {
  const word = label.replace(/[!?]+$/, "") || "GOAL";
  const line = Array.from({ length: 10 }, () => word).join(" ");
  return (
    <div
      className="pointer-events-none absolute inset-0 overflow-hidden"
      aria-hidden
      style={{ background: `linear-gradient(145deg, ${colors.primary} 0%, ${colors.secondary} 55%, #05070c 130%)` }}
    >
      <div
        className="goal-wall absolute inset-[-18%] flex rotate-[-10deg] flex-col justify-center font-display font-black uppercase leading-[0.92] tracking-tight"
        style={{ color: "rgba(255,255,255,.16)", fontSize: "calc(var(--u) * 7.2)", gap: "calc(var(--u) * 0.35)" }}
      >
        {Array.from({ length: 14 }, (_, i) => (
          <div key={i} className="whitespace-nowrap" style={{ marginLeft: i % 2 ? "calc(var(--u) * -4)" : 0 }}>{line}</div>
        ))}
      </div>
      <div className="absolute inset-0 bg-gradient-to-b from-black/10 via-transparent to-black/45" />
      {team && (
        <div className="absolute inset-0 flex items-center justify-center">
          <TeamBadge team={team} size="calc(var(--u) * 22)" plain className="opacity-95" />
        </div>
      )}
    </div>
  );
}

export function GoalOverlay({ event, pending }: { event?: EventPayload | undefined; pending: number }) {
  const [videos, setVideos] = useState<CelebrationVideo[]>([]);
  useEffect(() => {
    let dead = false;
    const load = () => { void api.celebrations().then((v) => { if (!dead) setVideos(v); }).catch(() => undefined); };
    load();
    const timer = setInterval(load, 30_000);
    return () => { dead = true; clearInterval(timer); };
  }, [event?.event_id]);
  return event ? <GoalCelebration key={event.event_id} event={event} pending={pending} videos={videos} /> : null;
}

function GoalCelebration({ event, pending, videos }: { event: EventPayload; pending: number; videos: CelebrationVideo[] }) {
  const [videoActive, setVideoActive] = useState(false);
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
      style={videoActive ? { background: "#05070c" } : undefined}
    >
      {!videoActive && <GoalWall label={text} team={team} colors={colors} />}
      <CelebrationVideoLayer event={event} videos={videos} onActive={setVideoActive} />
      <div
        className={videoActive
          ? "absolute bottom-[3%] z-[2] flex max-w-[94%] flex-col items-center rounded-xl bg-black/75 p-[calc(var(--u)*1.5)] text-center"
          : "goal-enter relative z-[2] flex flex-col items-center text-center"}
        style={{ gap: `calc(var(--u) * ${videoActive ? 0.6 : 1.6})` }}
      >
        {team && !videoActive && <TeamBadge team={team} size="calc(var(--u) * 8)" />}
        <div
          className="goal-text font-black uppercase leading-none"
          style={{ fontSize: `calc(var(--u) * ${videoActive ? 4 : 11})`, textShadow: "0 .04em .25em rgba(0,0,0,.55)" }}
        >
          {text}
        </div>
        {team && (
          <div className="font-extrabold uppercase tracking-wide opacity-95" style={{ fontSize: `calc(var(--u) * ${videoActive ? 1.8 : 3})` }}>
            {team.display_name}
          </div>
        )}
        {scorerLine && scoring?.scorer && (
          <div className="font-semibold" style={{ fontSize: "calc(var(--u) * 2.8)" }}>
            {scoring.scorer_number && <span className="num">#{scoring.scorer_number} </span>}
            {scorerLine}
          </div>
        )}
        {scoring?.assists && scoring.assists.length > 0 && (
          <div className="opacity-80" style={{ fontSize: "calc(var(--u) * 1.8)" }}>
            Assists: {scoring.assists.join(", ")}
          </div>
        )}
        {scoring && (
          <div
            className="num mt-[calc(var(--u)*1)] flex items-center rounded-full bg-black/45 font-black backdrop-blur"
            style={{ gap: "calc(var(--u) * 3)", padding: "calc(var(--u) * 1) calc(var(--u) * 4)", fontSize: `calc(var(--u) * ${videoActive ? 3 : 4.6})` }}
          >
            <span className="flex items-center" style={{ gap: "calc(var(--u) * 1.5)" }}>
              <span style={{ fontSize: "calc(var(--u) * 2.2)" }} className="opacity-80">{away.abbr}</span>
              {scoring.away_score}
            </span>
            <span className="opacity-50">–</span>
            <span className="flex items-center" style={{ gap: "calc(var(--u) * 1.5)" }}>
              {scoring.home_score}
              <span style={{ fontSize: "calc(var(--u) * 2.2)" }} className="opacity-80">{home.abbr}</span>
            </span>
          </div>
        )}
      </div>
      {pending > 0 && (
        <div className="absolute bottom-[3vmin] right-[3vmin] z-[2] rounded-full bg-black/50 px-[1.6vmin] py-[.6vmin] font-bold" style={{ fontSize: "calc(var(--u) * 1.6)" }}>
          +{pending} more
        </div>
      )}
    </div>
  );
}
