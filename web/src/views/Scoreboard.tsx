import { useRef } from "react";
import type { Game, GameLite, Team } from "../types";
import { useLive } from "../lib/live";
import { isMine, useNextMine, useSync } from "../lib/mine";
import { useKiosk, useNow, useOrientation, useQueryParam, useTicker } from "../lib/hooks";
import { countdown, shortPeriod, startMs, statusText, whenLabel } from "../lib/format";
import { resolveMatchup, type SideColors } from "../lib/colors";
import { useGameClock } from "../lib/clock";
import { ConnDot, SimBadge, TeamBadge } from "../components/Kiosk";
import { GameBars } from "../components/GameBars";
import { SidePanel } from "../components/SidePanel";
import { rowsFor } from "../components/StatBars";
import { GoalOverlay, useGoalQueue } from "../kiosk/GoalOverlay";
import { OverturnedToast, useOverturned } from "../kiosk/Toast";
import { FormScreen, PlayersScreen, StatsScreen, SummaryScreen, hasForm, hasPlayers } from "../kiosk/Breaks";
import { FINAL_MS, IdleScreen, PRE_WINDOW_MS, pick, trackFinalSeen } from "../kiosk/kioskState";
import { powerPlayFor } from "../lib/hockey";
import PlateView from "./Plate";

export { FINAL_MS, IdleScreen, PRE_WINDOW_MS, pick, trackFinalSeen };

const BREAK_ROTATE_MS = 15_000;
const U = (n: number) => `calc(var(--u) * ${n})`;

type Step = "live" | "countdown" | "players" | "form" | "stats" | "summary";
const STEPS: Step[] = ["live", "countdown", "players", "form", "stats", "summary"];

/** Which screens rotate for this game (screens with missing data are skipped). */
function stepsFor(g: Game, noRotate = false): Step[] {
  if (noRotate) return ["live"];
  if (g.status === "pre") return ["countdown", ...(hasPlayers(g) ? ["players" as const] : []), ...(hasForm(g) ? ["form" as const] : [])];
  if (g.status === "post") return ["summary"];
  if (g.intermission) return rowsFor(g, 1).length ? ["stats", "summary"] : ["summary"];
  return ["live"];
}

function findShots(g: Game): { away: string; home: string } | null {
  if (typeof g.sog?.away === "number" && typeof g.sog?.home === "number") {
    return { away: String(g.sog.away), home: String(g.sog.home) };
  }
  const row = g.stat_rows?.find((r) => r.key === "shots" || r.key === "SOG" || r.key === "S" || r.key === "sh");
  if (row) return { away: row.away, home: row.home };
  const as = g.stats?.away?.["SOG"] ?? g.stats?.away?.["S"] ?? g.stats?.away?.["shots"];
  const hs = g.stats?.home?.["SOG"] ?? g.stats?.home?.["S"] ?? g.stats?.home?.["shots"];
  if (as != null && hs != null) return { away: String(as), home: String(hs) };
  return null;
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

function TeamBlock({ team, c, pre, side, pp }: { team: Team; c: SideColors; pre: boolean; side: "l" | "r"; pp?: string | null | undefined }) {
  const left = side === "l";
  return (
    <div className={`flex min-w-0 items-center ${left ? "flex-row" : "flex-row-reverse"}`} style={{ gap: U(1.2), justifyContent: pre ? "center" : "space-between", padding: `0 ${U(2)}` }}>
      {!pre && <Score value={team.score ?? 0} c={c} />}
      <div className="flex flex-col items-center shrink-0" style={{ gap: U(.8), width: U(pre ? 22 : 19), maxWidth: "100%" }}>
        <div className="relative inline-flex items-center justify-center">
          <TeamBadge team={team} size={U(pre ? 14 : 11.5)} plain />
          {pp && (
            <span
              className="absolute -top-[0.8vmin] -right-[1.2vmin] rounded-full bg-amber-400 px-[1.2vmin] py-[0.3vmin] font-display font-black uppercase tracking-wider text-black shadow-[0_0_1.2vmin_rgba(251,191,36,0.9)] animate-pulse"
              style={{ fontSize: U(1.6) }}
            >
              {pp}
            </span>
          )}
        </div>
        <div
          className="w-full truncate text-center font-display font-black uppercase tracking-wide leading-tight"
          style={{
            fontSize: team.name.length > 10 ? U(1.9) : U(2.4),
            color: c.text,
            textShadow: c.textIsDark ? "none" : "0 .05em .2em rgba(0,0,0,.4)",
          }}
        >
          {team.name}
        </div>
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
  const shots = live ? findShots(game) : null;

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
            <span className="opacity-80 font-black">{game.league.toUpperCase()}</span>
            <span>
              {pre
                ? "Starting soon"
                : game.status === "post"
                ? statusText(game).toUpperCase()
                : game.intermission
                ? `End ${label}`
                : label}
            </span>
          </div>
        </div>
        <div className="grid grid-cols-2 items-center" style={{ padding: `0 ${U(1)}` }}>
          <TeamBlock team={game.away} c={away} pre={pre} side="l" pp={powerPlayFor(game, "l")} />
          <TeamBlock team={game.home} c={home} pre={pre} side="r" pp={powerPlayFor(game, "r")} />
        </div>
        <div className="flex flex-col items-center" style={{ gap: U(.4) }}>
          <div className="flex flex-col items-center rounded-[1.6vmin] bg-black/60 backdrop-blur-sm" style={{ padding: `${U(.6)} ${U(3)}` }}>
            {pre ? (
              <>
                <div className="num font-display font-black leading-none" style={{ fontSize: U(left > 0 ? 9 : 6.5) }}>{left > 0 ? countdown(left) : "ANY MOMENT"}</div>
                <div className="font-display font-semibold uppercase tracking-[.2em] opacity-75" style={{ fontSize: U(1.6) }}>{w.date} · {w.time}</div>
              </>
            ) : game.status === "post" ? (
              <div className="flex flex-col items-center">
                <div className="font-display font-black leading-none tracking-tight" style={{ fontSize: U(9) }}>FINAL</div>
                <div className="font-display font-semibold uppercase tracking-[.2em] text-amber-400 opacity-90" style={{ fontSize: U(1.8), marginTop: U(0.4) }}>
                  {game.period > 3 || (game.period_label ?? "").toLowerCase().includes("ot") || (game.period_label ?? "").toLowerCase().includes("overtime")
                    ? "OVERTIME"
                    : (game.period_label ?? "").toLowerCase().includes("so") || (game.period_label ?? "").toLowerCase().includes("shootout") || game.period === 5
                    ? "SHOOTOUT"
                    : "REGULATION"}
                </div>
              </div>
            ) : (
              <div className="num font-display font-black leading-none" style={{ fontSize: U(clockText.length > 5 ? 6 : 9) }}>{clockText}</div>
            )}
          </div>
          <div className="flex w-full items-end justify-between" style={{ minHeight: U(4.6) }}>
            {live && shots ? (
              <>
                <Plate label="SOG" value={shots.away} c={away} side="l" />
                <Plate label="SOG" value={shots.home} c={home} side="r" />
              </>
            ) : (
              <>
                {record && game.away.record ? <Plate label="Record" value={game.away.record} c={away} side="l" /> : <span />}
                {record && game.home.record ? <Plate label="Record" value={game.home.record} c={home} side="r" /> : <span />}
              </>
            )}
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

function GameScreen({ game, all, now, heroOnly }: { game: Game; all: Game[]; now: number; heroOnly: boolean }) {
  const o = useOrientation();
  const portrait = o === "portrait";
  const upcoming = all.filter((g) => g.status === "pre" && g.id !== game.id && startMs(g) > now - 5 * 60_000).sort((a, b) => startMs(a) - startMs(b)).slice(0, portrait ? 3 : 4);
  const hasHeroPanel = !heroOnly && (rowsFor(game, 1).length > 0 || !!game.insight?.form);
  return (
    <div className="fade-in absolute inset-0 flex flex-col">
      <div className={`grid min-h-0 flex-1 ${hasHeroPanel ? "landscape:grid-cols-[62fr_38fr] portrait:grid-rows-[minmax(0,10fr)_minmax(0,14fr)]" : ""}`} style={{ gap: U(.3) }}>
        <Hero game={game} now={now} scale={portrait || heroOnly ? 1.4 : 1} />
        {hasHeroPanel && (
          <div className="flex min-h-0 min-w-0 flex-col" style={{ ["--u" as string]: `calc(var(--u0) * ${portrait ? 1.85 : 1})` }}>
            <SidePanelFill game={game} maxRows={portrait ? (game.insight?.form ? 6 : 8) : game.insight?.form ? 6 : 8} size={portrait ? 1 : game.insight?.form ? .85 : 1} />
          </div>
        )}
      </div>
      {!heroOnly && <Upcoming games={upcoming} now={now} scale={portrait ? 1.25 : 1} />}
    </div>
  );
}

function SidePanelFill({ game, maxRows, size }: { game: Game; maxRows: number; size: number }) {
  return <div className="flex min-h-0 flex-1 flex-col [&>aside]:flex-1"><SidePanel game={game} maxRows={maxRows} size={size} /></div>;
}

export default function Scoreboard() {
  const plate = useQueryParam("plate") === "1" || useQueryParam("view") === "plate";
  if (plate) return <PlateView />;

  useKiosk();
  const want = useQueryParam("game") ?? "auto";
  const forced = useQueryParam("screen") as Step | null; // debug: live|countdown|players|form|stats|summary
  const heroOnly = useQueryParam("hero_only") === "1" || useQueryParam("nopside") === "1";
  const noRotate = useQueryParam("break_rotate") === "0" || useQueryParam("rotate") === "0";
  const leagueFilter = useQueryParam("league");

  const { games, conn } = useLive("scoreboard", want);
  const now = useNow(1000);
  const finalSeen = useRef(new Map<string, number>());
  const tick = useTicker(BREAK_ROTATE_MS);

  const sync = useSync(60_000);
  const nextMine = useNextMine(sync, want === "auto");

  let all = [...games.values()];
  if (leagueFilter) {
    all = all.filter((g) => g.league.toLowerCase() === leagueFilter.toLowerCase());
  }
  trackFinalSeen(all, finalSeen.current, now);
  const game = pick(all, want, sync, finalSeen.current, now);
  const finalExpired = !!game && game.status === "post" && now - (finalSeen.current.get(game.id) ?? now) >= FINAL_MS;

  const match = (id: string) => (want === "auto" ? !sync || (sync.effective ?? sync.games).includes(id) : id === want);
  const goal = useGoalQueue((e) => match(e.game.id));
  const overturned = useOverturned((e) => match(e.game.id));

  let body: React.ReactNode;
  if (!game || finalExpired || (game.status === "pre" && want === "auto" && startMs(game) - now > PRE_WINDOW_MS)) {
    // auto: soonest of my games (live feed first, else the week's schedule); a named game keeps the old "soonest anywhere"
    const livePre = (want === "auto" ? all.filter((g) => g.status === "pre" && sync && isMine(g, sync)) : all.filter((g) => g.status === "pre")).sort((a, b) => startMs(a) - startMs(b))[0];
    const next = want === "auto" ? [livePre, nextMine].filter((g): g is GameLite => !!g).sort((a, b) => startMs(a) - startMs(b))[0] : livePre;
    body = <IdleScreen next={next} now={now} loading={want === "auto" && !sync} />;
  } else {
    const steps = stepsFor(game, noRotate);
    const step: Step = forced && STEPS.includes(forced) ? forced : (steps[tick % steps.length] ?? "live");
    switch (step) {
      case "players": body = <PlayersScreen key="p" game={game} />; break;
      case "form": body = <FormScreen key="f" game={game} />; break;
      case "stats": body = <StatsScreen key="s" game={game} />; break;
      case "summary": body = <SummaryScreen key="m" game={game} final={game.status === "post"} />; break;
      default: body = <GameScreen key="g" game={game} all={all} now={now} heroOnly={heroOnly} />;
    }
  }

  return (
    <div className="kiosk fixed inset-0 bg-ink-950">
      {body}
      <OverturnedToast event={overturned} />
      <GoalOverlay event={goal.current} pending={goal.pending} />
      <SimBadge active={all.some((g) => g.id === "nhl:sim")} />
      <ConnDot conn={conn} />
    </div>
  );
}
