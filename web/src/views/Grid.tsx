import { useCallback, useEffect, useState } from "react";
import type { EventPayload, Game } from "../types";
import { useEvents, useLive } from "../lib/live";
import { useKiosk, useNow, useOrientation, useQueryParam } from "../lib/hooks";
import { useOnlyMine } from "../lib/mine";
import { countdown, diagonal, statusText, sortGames, startMs, timeLabel } from "../lib/format";
import { ConnDot, TeamBadge } from "../components/Kiosk";
import { GoalOverlay, useGoalQueue } from "../kiosk/GoalOverlay";

const columnsFor = (n: number, o: "portrait" | "landscape") => {
  if (o === "portrait") return n <= 1 ? 1 : 2;
  if (n <= 4) return Math.max(1, n);
  if (n <= 6) return 3;
  return n <= 12 ? 4 : 5;
};

function Row({ team, game, scoring, showRecord }: { team: Game["home"]; game: Game; scoring: boolean; showRecord: boolean }) {
  const isPp = game.status === "in" && game.situation?.advantage === (team.id === game.home.id ? "home" : "away");
  return (
    <div className="flex items-center" style={{ gap: "6cqh" }}>
      <TeamBadge team={team} size="22cqh" />
      <span className="flex min-w-0 flex-col">
        <span className="flex items-center gap-[1.5cqw]">
          <span className="font-black tracking-wide" style={{ fontSize: "17cqh", lineHeight: 1 }}>{team.abbr}</span>
          {isPp && (
            <span className="rounded bg-amber-400 px-[1.5cqw] py-[0.1cqh] font-black uppercase tracking-wider text-black shadow-[0_0_0.8cqh_rgba(251,191,36,0.9)]" style={{ fontSize: "9cqh" }}>
              PP
            </span>
          )}
        </span>
        {showRecord && team.record && <span className="num font-semibold opacity-75" style={{ fontSize: "8cqh", lineHeight: 1.1 }}>{team.record}</span>}
      </span>
      <span className="flex-1" />
      <span key={`${team.score}`} className={`num font-black ${scoring ? "score-pop" : ""}`} style={{ fontSize: "26cqh", lineHeight: 1, opacity: game.status === "pre" ? 0.0 : 1 }}>
        {team.score ?? 0}
      </span>
    </div>
  );
}

function Card({ game, now, pulse, ratio, cols }: { game: Game; now: number; pulse: boolean; ratio: number; cols: number }) {
  // only when the card is big enough for a third text line (few columns) and both teams have a record
  const showRecord = cols <= 3 && !!game.away.record && !!game.home.record;
  const live = game.status === "in";
  const sog = game.sog;
  const hasSog = live && sog && typeof sog.away === "number" && typeof sog.home === "number";
  const status = game.status === "post" ? statusText(game)
    : game.status === "pre" ? (startMs(game) - now > 24 * 3600_000 ? `${new Date(startMs(game)).toLocaleDateString([], { weekday: "short" })} ${timeLabel(startMs(game))}` : countdown(startMs(game) - now))
    : statusText(game);
  return (
    <article
      className={`relative min-h-0 min-w-0 overflow-hidden rounded-[4cqh] text-white ${pulse ? "card-pulse" : ""} ${game.status === "post" ? "opacity-75 saturate-50" : ""}`}
      style={{ containerType: "size", aspectRatio: ratio, background: diagonal(game.away, game.home, 118), boxShadow: "0 .4vmin 1.2vmin rgba(0,0,0,.5), inset 0 0 0 1px rgba(255,255,255,.12)" }}
      aria-label={`${game.away.display_name} ${game.away.score ?? 0}, ${game.home.display_name} ${game.home.score ?? 0}, ${status}`}
    >
      <div className="absolute inset-0 bg-gradient-to-b from-black/10 to-black/35" />
      <div className="relative flex h-full flex-col justify-center" style={{ padding: "8cqh 9cqw", gap: "9cqh" }}>
        <Row team={game.away} game={game} scoring={pulse} showRecord={showRecord} />
        <Row team={game.home} game={game} scoring={pulse} showRecord={showRecord} />
        <div className="flex items-center justify-end" style={{ gap: "3cqh" }}>
          <span className="font-black uppercase tracking-widest opacity-70" style={{ fontSize: "8cqh" }}>{game.league.toUpperCase()}</span>
          {hasSog && (
            <span className="font-bold opacity-80 flex items-center gap-[0.8cqw]" style={{ fontSize: "8.5cqh" }}>
              <span className="opacity-60 text-[7cqh]">SOG</span> {sog.away}–{sog.home}
            </span>
          )}
          <span className="flex-1" />
          {live && <span className="live-dot inline-block rounded-full bg-red-500" style={{ width: "8cqh", height: "8cqh", boxShadow: "0 0 1.2cqh #ef4444" }} />}
          <span className="num font-bold" style={{ fontSize: "11cqh" }}>{status}</span>
        </div>
      </div>
    </article>
  );
}

export default function Grid() {
  useKiosk();
  const { games, conn } = useLive("grid");
  const now = useNow(1000);
  const o = useOrientation();
  const [pulse, setPulse] = useState<Record<string, number>>({});
  useEvents(useCallback((e: EventPayload) => {
    if (e.type !== "goal") return;
    setPulse((p) => ({ ...p, [e.game.id]: Date.now() }));
    setTimeout(() => setPulse((p) => { const n = { ...p }; if (Date.now() - (n[e.game.id] ?? 0) >= 5900) delete n[e.game.id]; return n; }), 6000);
  }, []));

  const params = new URLSearchParams(window.location.search);
  const perPage = Math.min(12, Math.max(1, Number(params.get("max")) || 8));
  const rotateMs = Math.max(4, Number(params.get("rotate")) || 12) * 1000;
  const mine = useOnlyMine(useQueryParam("only")); // undefined: no filter; null: filter wanted but favourites not loaded yet
  const goal = useGoalQueue((e) => {
    if (mine === undefined) return true;
    if (mine === null) return false;
    const g = games.get(e.game.id);
    return !!g && mine(g);
  });
  const leagueParam = useQueryParam("league");
  const sorted = (sortGames([...games.values()]) as Game[])
    .filter((g) => !leagueParam || g.league.toLowerCase() === leagueParam.toLowerCase())
    .filter((g) => mine === undefined || (mine !== null && mine(g)));
  const liveCount = sorted.filter((g) => g.status === "in").length;
  // Few live games: show them plus the next-up games on one page, no paging.
  // More live games than fit, or nothing live: page through the slate.
  const paged = liveCount === 0 || liveCount > perPage;
  const candidates = liveCount > perPage ? sorted.filter((g) => g.status === "in") : sorted;
  const pages = paged ? Math.max(1, Math.ceil(candidates.length / perPage)) : 1;
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (pages <= 1) return;
    const t = setInterval(() => setTick((n) => n + 1), rotateMs);
    return () => clearInterval(t);
  }, [pages, rotateMs]);
  const page = pages > 1 ? tick % pages : 0;
  const list = candidates.slice(page * perPage, (page + 1) * perPage);
  const cols = columnsFor(list.length, o);
  return (
    <div className="kiosk fixed inset-0 bg-ink-950" style={{ padding: "2vmin" }}>
      {list.length === 0 ? (
        <div className="flex h-full items-center justify-center font-bold opacity-50" style={{ fontSize: "3vmin" }}>{mine === undefined ? "Waiting for games…" : mine === null ? "" : "No games for your teams right now"}</div>
      ) : (
        <div className="grid h-full" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0,1fr))`, alignContent: "center", gap: "1.6vmin" }}>
          {list.map((g) => <Card key={g.id} game={g} now={now} pulse={!!pulse[g.id]} ratio={o === "portrait" ? 1.6 : 1.9} cols={cols} />)}
        </div>
      )}
      {pages > 1 && (
        <div className="fixed bottom-[1.2vmin] left-1/2 flex -translate-x-1/2 gap-[.8vmin]" aria-hidden>
          {Array.from({ length: pages }, (_, i) => (
            <span key={i} className="rounded-full bg-white" style={{ width: "1vmin", height: "1vmin", opacity: i === page ? 0.9 : 0.25 }} />
          ))}
        </div>
      )}
      <GoalOverlay event={goal.current} pending={goal.pending} />
      <ConnDot conn={conn} />
    </div>
  );
}
