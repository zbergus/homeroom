import { useEffect, useRef, useState } from "react";
import type { Game, SyncState, Team } from "../types";
import { useLive } from "../lib/live";
import { api } from "../lib/api";
import { useKiosk, useNow, useOrientation, useQueryParam, useTicker } from "../lib/hooks";
import { countdown, shortPeriod, startMs, timeLabel, whenLabel } from "../lib/format";
import { resolveMatchup, type SideColors } from "../lib/colors";
import { useGameClock } from "../lib/clock";
import { ConnDot, TeamBadge } from "../components/Kiosk";
import { GameBars } from "../components/GameBars";
import { SidePanel } from "../components/SidePanel";
import { rowsFor } from "../components/StatBars";
import { GoalOverlay, useGoalQueue } from "../kiosk/GoalOverlay";
import { OverturnedToast, useOverturned } from "../kiosk/Toast";
import { FormScreen, PlayersScreen, StatsScreen, SummaryScreen, hasForm, hasPlayers } from "../kiosk/Breaks";

const FINAL_MS = 10 * 60_000;
const BREAK_ROTATE_MS = 15_000;
const PRE_WINDOW_MS = 60 * 60_000;
const U = (n: number) => `calc(var(--u) * ${n})`;

type Step = "live" | "countdown" | "players" | "form" | "stats" | "summary";
const STEPS: Step[] = ["live", "countdown", "players", "form", "stats", "summary"];

function pick(games: Game[], want: string, sync: SyncState | null | undefined, finalSeen: Map<string, number>, now: number): Game | undefined {
  if (want !== "auto") return games.find((g) => g.id === want);
  const pool = sync ? games.filter((g) => (sync.effective ?? sync.games).includes(g.id)) : games;
  const rank = (g: Game) =>
    g.status === "in" ? (g.intermission ? 1 : 0)
    : g.status === "pre" ? 2
    : now - (finalSeen.get(g.id) ?? now) < FINAL_MS ? 3 : 9;
  return [...pool]
    .filter((g) => rank(g) < 9)
    .sort((a, b) => rank(a) - rank(b) || startMs(a) - startMs(b))[0];
}

/** Which screens rotate for this game (screens with missing data are skipped). */
function stepsFor(g: Game): Step[] {
  if (g.status === "pre") return ["countdown", ...(hasPlayers(g) ? ["players" as const] : []), ...(hasForm(g) ? ["form" as const] : [])];
  if (g.status === "post") return ["summary"];
  if (g.intermission) return rowsFor(g, 1).length ? ["stats", "summary"] : ["summary"];
  return ["live"];
}

/* ------------------------------------------------------------------ hero */

function Score({ value, c }: { value: number; c: SideColors }) {
  const size = value < 10 ? 15 : value < 100 ? 12.5 : 9.5;
  return (
    <span key={value} className="score-pop num inline-block font-display font-black leading-none" style={{ fontSize: U(size), color: c.text, textShadow: c.textIsDark ? "none" : "0 .04em .2em rgba(0,0,0,.35)" }}>{value}</span>
  );
}

function Plate({ label, value, c, side }: { label: string; value: string; c: SideColors; side: "l" | "r" }) {
  const left = side === "l";
  return (
    <div
      className="font-display flex items-baseline"
      style={{
        gap: U(1), padding: `${U(.7)} ${U(left ? 4 : 2.2)} ${U(.7)} ${U(left ? 2.2 : 4)}`, background: "rgba(0,0,0,.6)", color: "#fff",
        clipPath: left ? "polygon(0 0, 100% 0, calc(100% - 1.4vmin) 100%, 0 100%)" : "polygon(1.4vmin 0, 100% 0, 100% 100%, 0 100%)",
        borderBottom: `${U(.35)} solid ${c.fill}`, flexDirection: left ? "row" : "row-reverse",
      }}
    >
      <span className="font-semibold uppercase tracking-[.14em] opacity-80" style={{ fontSize: U(1.6) }}>{label}</span>
      <span className="num font-black" style={{ fontSize: U(3) }}>{value}</span>
    </div>
  );
}

function TeamBlock({ team, c, pre, side }: { team: Team; c: SideColors; pre: boolean; side: "l" | "r" }) {
  const left = side === "l";
  return (
    <div className={`flex min-w-0 items-center ${left ? "flex-row" : "flex-row-reverse"}`} style={{ gap: U(1.2), justifyContent: pre ? "center" : "space-between", padding: `0 ${U(2)}` }}>
      {!pre && <Score value={team.score ?? 0} c={c} />}
      <div className="flex min-w-0 flex-col items-center" style={{ gap: U(.8) }}>
        <TeamBadge team={team} size={U(pre ? 14 : 11.5)} plain />
        <div className="max-w-full truncate text-center font-display font-black uppercase tracking-wide" style={{ fontSize: U(2.6), color: c.text, textShadow: c.textIsDark ? "none" : "0 .05em .2em rgba(0,0,0,.4)" }}>{team.name}</div>
      </div>
    </div>
  );
}

function Hero({ game, now, scale }: { game: Game; now: number; scale: number }) {
  const { away, home } = resolveMatchup(game.away, game.home);
  const pre = game.status === "pre";
  const clock = useGameClock(game.status === "in" ? game : undefined);
  const left = startMs(game) - now;
  const label = shortPeriod(game.period_label ?? "");
  const w = whenLabel(startMs(game), now);
  const live = game.status === "in";
  const clockText = game.intermission ? "INT" : clock.text || game.clock || (game.status === "in" && game.period_label === "shootout" ? "SO" : "");
  const record = !!game.away.record || !!game.home.record;
  return (
    <div className="relative min-h-0 min-w-0 overflow-hidden text-white" style={{ ["--u" as string]: `calc(var(--u0) * ${scale})`, background: "#07090f" }}>
      <div className="absolute inset-0" style={{ background: `linear-gradient(120deg, ${away.fill}, ${away.deep})`, clipPath: "polygon(0 0, 50% 0, 31% 100%, 0 100%)" }} />
      <div className="absolute inset-0" style={{ background: `linear-gradient(240deg, ${home.fill}, ${home.deep})`, clipPath: "polygon(50% 0, 100% 0, 100% 100%, 69% 100%)" }} />
      <div className="absolute inset-0" style={{ background: `linear-gradient(90deg, ${away.fill} 0%, ${away.fill} 49.5%, ${home.fill} 50.5%, ${home.fill} 100%)`, clipPath: "polygon(50% 0, 69% 100%, 31% 100%)", filter: "brightness(1.35) saturate(.85)", opacity: .9 }} />
      <div className="absolute inset-0" style={{ background: "radial-gradient(70% 60% at 50% 55%, rgba(255,255,255,.12), transparent 70%), linear-gradient(180deg, rgba(0,0,0,.25), transparent 30%, rgba(0,0,0,.35))" }} />
      <div className="relative flex h-full flex-col justify-between" style={{ padding: `${U(1.4)} 0 0` }}>
        <div className="flex justify-center">
          <div className="flex items-center rounded-full bg-black/55 font-display font-bold uppercase tracking-[.2em]" style={{ gap: U(1.4), padding: `${U(.5)} ${U(2)}`, fontSize: U(1.8) }}>
            {live && <span className="live-dot inline-block rounded-full bg-red-500" style={{ width: U(1.1), height: U(1.1) }} />}
            <span className="opacity-80">{game.league}</span>
            <span>{pre ? "Starting soon" : game.intermission ? `End ${label}` : label}</span>
          </div>
        </div>
        <div className="grid grid-cols-2 items-center" style={{ padding: `0 ${U(1)}` }}>
          <TeamBlock team={game.away} c={away} pre={pre} side="l" />
          <TeamBlock team={game.home} c={home} pre={pre} side="r" />
        </div>
        <div className="flex flex-col items-center" style={{ gap: U(.4) }}>
          <div className="flex flex-col items-center rounded-[1.6vmin] bg-black/60 backdrop-blur-sm" style={{ padding: `${U(.6)} ${U(3)}` }}>
            {pre ? (
              <>
                <div className="num font-display font-black leading-none" style={{ fontSize: U(left > 0 ? 9 : 6.5) }}>{left > 0 ? countdown(left) : "ANY MOMENT"}</div>
                <div className="font-display font-semibold uppercase tracking-[.2em] opacity-75" style={{ fontSize: U(1.6) }}>{w.date} · {w.time}</div>
              </>
            ) : (
              <div className="num font-display font-black leading-none" style={{ fontSize: U(clockText.length > 5 ? 6 : 9) }}>{game.status === "post" ? "FINAL" : clockText}</div>
            )}
          </div>
          <div className="flex w-full items-end justify-between" style={{ minHeight: U(4.6) }}>
            {record && game.away.record ? <Plate label="Record" value={game.away.record} c={away} side="l" /> : <span />}
            {record && game.home.record ? <Plate label="Record" value={game.home.record} c={home} side="r" /> : <span />}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ upcoming */

function Upcoming({ games, now, scale }: { games: Game[]; now: number; scale: number }) {
  if (!games.length) return null;
  return (
    <div className="flex shrink-0 items-center overflow-hidden bg-black" style={{ ["--u" as string]: `calc(var(--u0) * ${scale})`, height: U(11), gap: U(2.4), paddingRight: U(2) }}>
      <div className="flex h-full items-center bg-white font-display font-black uppercase tracking-wide text-black" style={{ fontSize: U(3), padding: `0 ${U(3.4)} 0 ${U(2.4)}`, clipPath: "polygon(0 0, 100% 0, calc(100% - 1.6vmin) 100%, 0 100%)" }}>
        Upcoming
      </div>
      <div className="flex min-w-0 flex-1 items-center justify-around overflow-hidden" style={{ fontSize: U(1.9) }}>
        {games.map((g) => <GameBars key={g.id} game={g} now={now} compact />)}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ screens */

function GameScreen({ game, all, now }: { game: Game; all: Game[]; now: number }) {
  const o = useOrientation();
  const portrait = o === "portrait";
  const upcoming = all.filter((g) => g.status === "pre" && g.id !== game.id && startMs(g) > now - 5 * 60_000).sort((a, b) => startMs(a) - startMs(b)).slice(0, portrait ? 3 : 4);
  const hasHeroPanel = rowsFor(game, 1).length > 0 || !!game.insight?.form;
  return (
    <div className="fade-in absolute inset-0 flex flex-col">
      <div className={`grid min-h-0 flex-1 ${hasHeroPanel ? "landscape:grid-cols-[62fr_38fr] portrait:grid-rows-[minmax(0,10fr)_minmax(0,14fr)]" : ""}`} style={{ gap: U(.3) }}>
        <Hero game={game} now={now} scale={portrait ? 1.4 : 1} />
        {hasHeroPanel && (
          <div className="flex min-h-0 min-w-0 flex-col" style={{ ["--u" as string]: `calc(var(--u0) * ${portrait ? 1.85 : 1})` }}>
            <SidePanelFill game={game} maxRows={portrait ? (game.insight?.form ? 6 : 8) : game.insight?.form ? 6 : 8} size={portrait ? 1 : game.insight?.form ? .85 : 1} />
          </div>
        )}
      </div>
      <Upcoming games={upcoming} now={now} scale={portrait ? 1.25 : 1} />
    </div>
  );
}

function SidePanelFill({ game, maxRows, size }: { game: Game; maxRows: number; size: number }) {
  return <div className="flex min-h-0 flex-1 flex-col [&>aside]:flex-1"><SidePanel game={game} maxRows={maxRows} size={size} /></div>;
}

function IdleScreen({ games, now }: { games: Game[]; now: number }) {
  const next = games.filter((g) => g.status === "pre").sort((a, b) => startMs(a) - startMs(b))[0];
  return (
    <div className="fade-in absolute inset-0 flex flex-col items-center justify-center text-center text-white" style={{ background: "radial-gradient(80% 80% at 50% 40%, #16203a, #07090f)", gap: U(2.5) }}>
      <div className="font-black tracking-[.3em] opacity-50" style={{ fontSize: U(3) }}>HOMEROOM</div>
      {next ? (
        <>
          <div className="uppercase tracking-[.25em] opacity-70 font-bold" style={{ fontSize: U(2.2) }}>Next game</div>
          <div className="flex items-center" style={{ gap: U(3) }}>
            <TeamBadge team={next.away} size={U(11)} />
            <span className="font-black" style={{ fontSize: U(4.5) }}>{next.away.abbr} @ {next.home.abbr}</span>
            <TeamBadge team={next.home} size={U(11)} />
          </div>
          <div className="num font-black" style={{ fontSize: U(12) }}>{countdown(startMs(next) - now)}</div>
          <div className="opacity-70" style={{ fontSize: U(2.4) }}>{new Date(startMs(next)).toLocaleDateString([], { weekday: "long" })} {timeLabel(startMs(next))}</div>
        </>
      ) : (
        <div className="opacity-70" style={{ fontSize: U(4) }}>No upcoming games</div>
      )}
    </div>
  );
}

export default function Scoreboard() {
  useKiosk();
  const want = useQueryParam("game") ?? "auto";
  const forced = useQueryParam("screen") as Step | null; // debug: live|countdown|players|form|stats|summary
  const { games, conn } = useLive("scoreboard", want);
  const now = useNow(1000);
  const [sync, setSync] = useState<SyncState | null>(null);
  const finalSeen = useRef(new Map<string, number>());
  const tick = useTicker(BREAK_ROTATE_MS);

  useEffect(() => {
    if (want !== "auto") return;
    let dead = false;
    const load = () => api.sync().then((s) => !dead && setSync(s)).catch(() => !dead && setSync(null));
    load();
    const i = setInterval(load, 60_000);
    return () => { dead = true; clearInterval(i); };
  }, [want]);

  const all = [...games.values()];
  for (const g of all) if (g.status === "post" && !finalSeen.current.has(g.id)) finalSeen.current.set(g.id, Date.now());
  const game = pick(all, want, sync, finalSeen.current, now);
  const finalExpired = !!game && game.status === "post" && now - (finalSeen.current.get(game.id) ?? now) >= FINAL_MS;

  const match = (id: string) => (want === "auto" ? !sync || (sync.effective ?? sync.games).includes(id) : id === want);
  const goal = useGoalQueue((e) => match(e.game.id));
  const overturned = useOverturned((e) => match(e.game.id));

  let body: React.ReactNode;
  if (!game || finalExpired || (game.status === "pre" && want === "auto" && startMs(game) - now > PRE_WINDOW_MS)) {
    body = <IdleScreen games={all} now={now} />;
  } else {
    const steps = stepsFor(game);
    const step: Step = forced && STEPS.includes(forced) ? forced : steps[tick % steps.length];
    switch (step) {
      case "players": body = <PlayersScreen key="p" game={game} />; break;
      case "form": body = <FormScreen key="f" game={game} />; break;
      case "stats": body = <StatsScreen key="s" game={game} />; break;
      case "summary": body = <SummaryScreen key="m" game={game} final={game.status === "post"} />; break;
      default: body = <GameScreen key="g" game={game} all={all} now={now} />;
    }
  }

  return (
    <div className="kiosk fixed inset-0 bg-ink-950">
      {body}
      <OverturnedToast event={overturned} />
      <GoalOverlay event={goal.current} pending={goal.pending} />
      <ConnDot conn={conn} />
    </div>
  );
}
