import type { Game, Team } from "../types";
import { resolveMatchup, type SideColors } from "../lib/colors";
import { useGameClock } from "../lib/clock";
import { countdown, shortPeriod, startMs, timeLabel } from "../lib/format";
import { TeamBadge } from "./Kiosk";
import {
  findShots,
  getTickerAlert,
  type AlertKind,
  type TickerAlert,
} from "../lib/hockey";

export { findShots, getTickerAlert, type AlertKind, type TickerAlert };

const U = (n: number) => `calc(var(--u) * ${n})`;

/** High-contrast team crest with sharp dark framing and drop-shadow. */
function HighContrastCrest({ team }: { team: Team }) {
  return (
    <div
      className="relative flex shrink-0 items-center justify-center rounded-full bg-black/45 border border-white/25 p-[calc(var(--u)*0.25)] shadow-[0_0.2vmin_0.8vmin_rgba(0,0,0,0.85)]"
      style={{ width: U(4.5), height: U(4.5) }}
    >
      <TeamBadge
        team={team}
        size={U(3.9)}
        plain
        className="filter drop-shadow-[0_0.1em_0.15em_rgba(0,0,0,0.9)]"
      />
    </div>
  );
}

function TeamTopRibbon({
  team,
  colors,
  score,
  flash,
  isAway,
}: {
  team: Team;
  colors: SideColors;
  score: number | undefined;
  flash: boolean;
  isAway: boolean;
}) {
  return (
    <div
      className={`relative flex flex-1 items-center overflow-hidden transition-all duration-300 ${
        flash ? "goal-siren-strobe bar-flash" : ""
      }`}
      style={{
        padding: `${U(0.5)} ${U(1.2)}`,
        gap: U(0.8),
        color: colors.text,
        background: isAway
          ? `linear-gradient(135deg, ${colors.fill} 0%, ${colors.deep} 100%)`
          : `linear-gradient(225deg, ${colors.fill} 0%, ${colors.deep} 100%)`,
        flexDirection: isAway ? "row" : "row-reverse",
      }}
    >
      <HighContrastCrest team={team} />
      <div
        className="flex min-w-0 flex-1 flex-col justify-center overflow-hidden"
        style={{
          alignItems: isAway ? "flex-start" : "flex-end",
          textAlign: isAway ? "left" : "right",
        }}
      >
        <span
          className="block w-full truncate font-display font-black uppercase tracking-wide leading-none"
          style={{
            fontSize: U(1.8),
            textShadow: colors.textIsDark ? "none" : "0 0.05em 0.25em rgba(0,0,0,0.6)",
          }}
        >
          {team.name}
        </span>
        <span
          className="block w-full truncate font-display font-bold uppercase tracking-wider opacity-80 leading-none"
          style={{ fontSize: U(1.1), marginTop: U(0.3) }}
        >
          {team.abbr}
        </span>
      </div>
      {score !== undefined && (
        <span
          className="num shrink-0 font-display font-black leading-none"
          style={{
            fontSize: U(3.4),
            color: colors.text,
            textShadow: colors.textIsDark ? "none" : "0 0.05em 0.25em rgba(0,0,0,0.6)",
            marginLeft: isAway ? U(0.4) : 0,
            marginRight: isAway ? 0 : U(0.4),
          }}
        >
          {score}
        </span>
      )}
    </div>
  );
}

function StatusPod({ game, now }: { game: Game; now: number }) {
  const live = game.status === "in";
  const pre = game.status === "pre";
  const post = game.status === "post";
  const clock = useGameClock(live && !game.intermission ? game : undefined, 250);
  const left = startMs(game) - now;
  const label = shortPeriod(game.period_label).toUpperCase() || "LIVE";

  let mainText = "";
  let subText: string | null = null;

  if (post) {
    const pLabel = (game.period_label ?? "").toLowerCase();
    if (pLabel.includes("so") || pLabel.includes("shootout") || game.period === 5) {
      mainText = "FINAL/SO";
    } else if (game.period > 3 || pLabel.includes("ot") || pLabel.includes("overtime")) {
      mainText = "FINAL/OT";
    } else {
      mainText = "FINAL";
    }
  } else if (pre) {
    if (left > 0 && left < 3600_000) {
      mainText = countdown(left).slice(3);
      subText = "STARTS IN";
    } else {
      mainText = timeLabel(startMs(game));
      subText = "UPCOMING";
    }
  } else if (game.intermission) {
    mainText = `END ${label}`;
    subText = "INTERMISSION";
  } else {
    mainText = clock.text || game.clock || (game.period_label === "shootout" ? "SO" : label);
    subText = label;
  }

  return (
    <div
      className="relative flex shrink-0 flex-col items-center justify-center bg-black/85 border-x border-white/10 px-[calc(var(--u)*1)]"
      style={{
        width: U(11),
        height: "100%",
        gap: U(0.2),
      }}
    >
      <div className="flex items-center" style={{ gap: U(0.5) }}>
        {live && !game.intermission && (
          <span
            className="live-dot inline-block rounded-full bg-red-500 shadow-[0_0_0.8vmin_rgba(239,68,68,0.9)]"
            style={{ width: U(0.8), height: U(0.8) }}
          />
        )}
        <span
          className="font-display font-black uppercase tracking-widest text-slate-400"
          style={{ fontSize: U(1.1) }}
        >
          {game.league.toUpperCase()}
        </span>
      </div>

      <span
        className="num font-display font-black uppercase tracking-tight text-white leading-none text-center"
        style={{ fontSize: U(mainText.length > 7 ? 2.1 : 2.5) }}
      >
        {mainText}
      </span>

      {subText && (
        <span
          className="font-display font-bold uppercase tracking-wider text-amber-400 opacity-90 leading-none"
          style={{ fontSize: U(1.1) }}
        >
          {subText}
        </span>
      )}
    </div>
  );
}

function BottomBanner({
  game,
  awayColor,
  homeColor,
  shots,
  alert,
}: {
  game: Game;
  awayColor: string;
  homeColor: string;
  shots: { away: string | number; home: string | number } | null;
  alert: TickerAlert | null;
}) {
  return (
    <div
      className="flex w-full items-center justify-between border-t border-white/10"
      style={{
        height: U(3.8),
        padding: `0 ${U(1.6)}`,
        background: "linear-gradient(180deg, rgba(8,12,20,0.95) 0%, rgba(3,6,12,0.98) 100%)",
      }}
    >
      {/* Away SOG / Record */}
      <div className="flex items-center" style={{ gap: U(0.6), minWidth: U(8) }}>
        <span
          className="rounded-full shrink-0"
          style={{ width: U(0.8), height: U(0.8), background: awayColor }}
        />
        <span
          className="font-display font-bold uppercase tracking-wider text-slate-400"
          style={{ fontSize: U(1.3) }}
        >
          {shots ? "SOG" : "REC"}
        </span>
        <span
          className="num font-display font-black text-white"
          style={{ fontSize: U(1.8) }}
        >
          {shots ? shots.away : (game.away.record ?? "—")}
        </span>
      </div>

      {/* Center Alert Badge */}
      <div className="flex flex-1 items-center justify-center overflow-hidden px-[calc(var(--u)*0.5)]">
        {alert ? (
          alert.kind === "pp" ? (
            <span
              className="inline-flex items-center rounded-md bg-amber-400 px-[calc(var(--u)*1)] py-[calc(var(--u)*0.25)] font-display font-black uppercase tracking-wider text-black shadow-[0_0_1.2vmin_rgba(251,191,36,0.9)] animate-pulse"
              style={{ fontSize: U(1.4), gap: U(0.5) }}
            >
              <span>⚡</span>
              <span>{alert.teamAbbr ? `${alert.teamAbbr} ${alert.text}` : alert.text}</span>
            </span>
          ) : alert.kind === "empty_net" ? (
            <span
              className="inline-flex items-center rounded-md bg-red-600 px-[calc(var(--u)*1)] py-[calc(var(--u)*0.25)] font-display font-black uppercase tracking-wider text-white shadow-[0_0_1.5vmin_rgba(239,68,68,0.9)] animate-pulse"
              style={{ fontSize: U(1.4), gap: U(0.5) }}
            >
              <span>🚨</span>
              <span>{alert.teamAbbr ? `${alert.teamAbbr} ${alert.text}` : alert.text}</span>
            </span>
          ) : alert.kind === "strength" ? (
            <span
              className="inline-flex items-center rounded-md bg-cyan-950/90 border border-cyan-400/60 px-[calc(var(--u)*1)] py-[calc(var(--u)*0.25)] font-display font-black uppercase tracking-wider text-cyan-200"
              style={{ fontSize: U(1.4) }}
            >
              {alert.text}
            </span>
          ) : (
            <span
              className="inline-flex items-center rounded-md bg-indigo-950/90 border border-indigo-400/50 px-[calc(var(--u)*1)] py-[calc(var(--u)*0.25)] font-display font-bold uppercase tracking-wider text-indigo-200"
              style={{ fontSize: U(1.3), gap: U(0.4) }}
            >
              <span>❄️</span>
              <span>{alert.text}</span>
            </span>
          )
        ) : game.status === "in" ? (
          <span
            className="inline-flex items-center rounded-full bg-white/10 px-[calc(var(--u)*1)] py-[calc(var(--u)*0.2)] font-display font-semibold uppercase tracking-wider text-slate-300"
            style={{ fontSize: U(1.2) }}
          >
            5v5 FULL STRENGTH
          </span>
        ) : game.status === "pre" ? (
          <span
            className="truncate font-display font-semibold uppercase tracking-wider text-slate-400"
            style={{ fontSize: U(1.2) }}
          >
            {game.away.record && game.home.record
              ? `${game.away.record} VS ${game.home.record}`
              : "MATCHUP"}
          </span>
        ) : (
          <span
            className="font-display font-semibold uppercase tracking-wider text-slate-400"
            style={{ fontSize: U(1.2) }}
          >
            FINAL STATISTICS
          </span>
        )}
      </div>

      {/* Home SOG / Record */}
      <div className="flex items-center justify-end" style={{ gap: U(0.6), minWidth: U(8) }}>
        <span
          className="num font-display font-black text-white"
          style={{ fontSize: U(1.8) }}
        >
          {shots ? shots.home : (game.home.record ?? "—")}
        </span>
        <span
          className="font-display font-bold uppercase tracking-wider text-slate-400"
          style={{ fontSize: U(1.3) }}
        >
          {shots ? "SOG" : "REC"}
        </span>
        <span
          className="rounded-full shrink-0"
          style={{ width: U(0.8), height: U(0.8), background: homeColor }}
        />
      </div>
    </div>
  );
}

export function HockeyTickerBanner({
  game,
  now,
  flashAbbr,
}: {
  game: Game;
  now: number;
  flashAbbr?: string | undefined;
}) {
  const { away, home } = resolveMatchup(game.away, game.home);
  const shots = findShots(game);
  const alert = getTickerAlert(game);
  const showScore = game.status !== "pre";

  return (
    <div
      className="inline-flex flex-col shrink-0 overflow-hidden rounded-[calc(var(--u)*1.2)] border border-white/15 shadow-[0_0.8vmin_2.5vmin_rgba(0,0,0,0.6)]"
      style={{
        width: U(48),
        height: U(11),
      }}
    >
      {/* Top Ribbon: Primary Game & Score */}
      <div className="flex w-full overflow-hidden" style={{ height: U(7.2) }}>
        <TeamTopRibbon
          team={game.away}
          colors={away}
          score={showScore ? (game.away.score ?? 0) : undefined}
          flash={!!flashAbbr && flashAbbr === game.away.abbr}
          isAway={true}
        />
        <StatusPod game={game} now={now} />
        <TeamTopRibbon
          team={game.home}
          colors={home}
          score={showScore ? (game.home.score ?? 0) : undefined}
          flash={!!flashAbbr && flashAbbr === game.home.abbr}
          isAway={false}
        />
      </div>

      {/* Bottom Banner: Live SOG, Alert Badges, Intermission */}
      <BottomBanner
        game={game}
        awayColor={away.fill}
        homeColor={home.fill}
        shots={shots}
        alert={alert}
      />
    </div>
  );
}
