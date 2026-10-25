import { useRef } from "react";
import type { Game, GameLite, Team } from "../types";
import { useLive } from "../lib/live";
import { isMine, useNextMine, useSync } from "../lib/mine";
import { useKiosk, useNow, useOrientation, useQueryParam } from "../lib/hooks";
import { countdown, shortPeriod, startMs, statusText, timeLabel, whenLabel } from "../lib/format";
import { resolveMatchup, type SideColors } from "../lib/colors";
import { useGameClock } from "../lib/clock";
import { ConnDot, SimBadge, TeamBadge } from "../components/Kiosk";
import { GoalOverlay, useGoalQueue } from "../kiosk/GoalOverlay";
import { OverturnedToast, useOverturned } from "../kiosk/Toast";
import { FINAL_MS, IdleScreen, PRE_WINDOW_MS, pick } from "../kiosk/kioskState";

const U = (n: number) => `calc(var(--u) * ${n})`;

/* ------------------------------------------------------------------ helpers */

function ScoreNum({ value }: { value: number }) {
  const size = value < 10 ? 15 : value < 100 ? 12 : 9.5;
  return (
    <span
      key={value}
      className="score-pop num inline-block font-display font-black leading-none text-white shrink-0"
      style={{
        fontSize: U(size),
        textShadow: "0 .04em .3em rgba(0,0,0,.6)",
      }}
    >
      {value}
    </span>
  );
}

import { powerPlayFor, singleTeamSituation } from "../lib/hockey";
export { singleTeamSituation };

function RecordPill({ record }: { record?: string | undefined }) {
  if (!record) return null;
  return (
    <span
      className="inline-flex items-center rounded-full bg-white/10 font-display font-semibold uppercase tracking-wider text-slate-300"
      style={{ padding: `${U(0.25)} ${U(1.1)}`, fontSize: U(1.5) }}
    >
      {record}
    </span>
  );
}

function TeamUnit({ team, pre, pp }: { team: Team; pre: boolean; pp?: string | null | undefined }) {
  return (
    <div className="flex flex-col items-center justify-center shrink-0" style={{ gap: U(0.7), minWidth: U(16) }}>
      <div className="relative inline-flex items-center justify-center">
        <TeamBadge team={team} size={U(pre ? 15 : 12.5)} plain />
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
        className="font-display font-black uppercase tracking-wide text-white text-center truncate max-w-[25vw]"
        style={{
          fontSize: U(2.4),
          textShadow: "0 .04em .2em rgba(0,0,0,.6)",
        }}
      >
        {team.name}
      </div>
      <div className="flex items-center" style={{ gap: U(0.8) }}>
        <span className="font-display font-bold uppercase tracking-wider text-slate-400 opacity-80" style={{ fontSize: U(1.5) }}>
          {team.abbr}
        </span>
        <RecordPill record={team.record} />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ landscape */

function ClockPodLandscape({
  game,
  now,
}: {
  game: Game;
  now: number;
}) {
  const pre = game.status === "pre";
  const post = game.status === "post";
  const live = game.status === "in";
  const clock = useGameClock(live ? game : undefined);
  const left = startMs(game) - now;
  const label = shortPeriod(game.period_label ?? "");
  const clockText = game.intermission
    ? "INT"
    : clock.text || game.clock || (game.period_label === "shootout" ? "SO" : "");
  const w = whenLabel(startMs(game), now);

  const sogRow = game.stat_rows?.find(
    (r) => r.key === "shots" || r.key === "SOG" || r.key === "S" || r.label?.toLowerCase() === "shots",
  );
  const sog = sogRow ? { away: sogRow.away, home: sogRow.home } : game.sog ? { away: String(game.sog.away), home: String(game.sog.home) } : undefined;

  return (
    <div
      className="flex flex-col items-center justify-center shrink-0 rounded-[2vmin] bg-black/60 border border-white/10 backdrop-blur-md"
      style={{
        gap: U(0.9),
        padding: `${U(1.2)} ${U(2.6)}`,
        minWidth: U(24),
      }}
    >
      <div
        className="flex items-center rounded-full bg-white/10 font-display font-bold uppercase tracking-[.22em] text-white"
        style={{ gap: U(1.2), padding: `${U(0.4)} ${U(2)}`, fontSize: U(1.7) }}
      >
        {live && (
          <span
            className="live-dot inline-block rounded-full bg-red-500"
            style={{ width: U(1.1), height: U(1.1) }}
          />
        )}
        <span className="opacity-75 font-black">{game.league.toUpperCase()}</span>
        <span>
          {pre
            ? "Upcoming"
            : post
            ? statusText(game)
            : game.intermission
            ? `End ${label}`
            : label}
        </span>
      </div>

      <div
        className="num font-display font-black leading-none text-white tracking-tight text-center"
        style={{
          fontSize: U(pre ? (left > 0 ? 8 : 6.5) : clockText.length > 5 ? 7 : 10.5),
          textShadow: "0 .04em .3em rgba(0,0,0,.6)",
        }}
      >
        {pre
          ? left > 0
            ? countdown(left)
            : "ANY MOMENT"
          : post
          ? statusText(game).toUpperCase()
          : clockText}
      </div>

      <div className="flex items-center justify-center" style={{ minHeight: U(2.6) }}>
        {pre ? (
          <div
            className="font-display font-semibold uppercase tracking-[.18em] opacity-80 text-slate-300"
            style={{ fontSize: U(1.6) }}
          >
            {w.date} · {w.time}
          </div>
        ) : sog ? (
          <div
            className="flex items-center font-display uppercase tracking-widest text-slate-300"
            style={{ gap: U(1.4), fontSize: U(1.7) }}
          >
            <span className="font-black text-white">{sog.away}</span>
            <span className="opacity-60 text-xs font-bold tracking-wider">SOG</span>
            <span className="font-black text-white">{sog.home}</span>
          </div>
        ) : post ? (
          <div
            className="font-display font-semibold uppercase tracking-[.18em] opacity-80 text-slate-400"
            style={{ fontSize: U(1.6) }}
          >
            {game.period > 3
              ? game.period_label === "shootout"
                ? "FINAL / SO"
                : "FINAL / OT"
              : "GAME COMPLETE"}
          </div>
        ) : game.intermission ? (
          <div
            className="font-display font-semibold uppercase tracking-[.18em] text-amber-400"
            style={{ fontSize: U(1.6) }}
          >
            INTERMISSION
          </div>
        ) : null}
      </div>
    </div>
  );
}

function PlateLandscape({ game, now, scale }: { game: Game; now: number; scale: number }) {
  const { away, home } = resolveMatchup(game.away, game.home);
  const pre = game.status === "pre";
  const ppAway = powerPlayFor(game, "away");
  const ppHome = powerPlayFor(game, "home");

  return (
    <div
      className="relative flex h-full w-full items-center justify-center p-[3vmin] overflow-hidden bg-[#04060a] text-white"
      style={{ ["--u" as string]: `calc(var(--u0) * ${scale})` }}
    >
      {/* Corner wedges for ambient team colors */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background: `linear-gradient(135deg, ${away.fill} 0%, ${away.deep} 45%, transparent 75%)`,
          clipPath: "polygon(0 0, 42vmin 0, 0 42vmin)",
          opacity: 0.85,
        }}
      />
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background: `linear-gradient(225deg, ${home.fill} 0%, ${home.deep} 45%, transparent 75%)`,
          clipPath: "polygon(calc(100% - 42vmin) 0, 100% 0, 100% 42vmin)",
          opacity: 0.85,
        }}
      />
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background: "radial-gradient(85% 75% at 50% 50%, rgba(18,22,34,.55) 0%, rgba(4,6,10,.98) 100%)",
        }}
      />

      {/* Main Plate Card */}
      <div
        className="relative flex flex-col justify-between w-full max-w-[94vw] h-[86vh] rounded-[2.8vmin] bg-black/85 border border-white/12 shadow-[0_0_8vmin_rgba(0,0,0,0.9)] backdrop-blur-xl p-[3.2vmin] overflow-hidden"
      >
        <div className="pointer-events-none absolute inset-x-0 top-0 h-[1px] bg-gradient-to-r from-transparent via-white/25 to-transparent" />

        {/* 3-column scoreboard body */}
        <div className="relative flex flex-1 items-center justify-between" style={{ gap: U(2) }}>
          {/* Away Side */}
          <div className="flex flex-1 items-center justify-between min-w-0" style={{ padding: `0 ${U(2.5)}` }}>
            <TeamUnit team={game.away} pre={pre} pp={ppAway} />
            {!pre && <ScoreNum value={game.away.score ?? 0} />}
          </div>

          {/* Center Clock Pod */}
          <ClockPodLandscape game={game} now={now} />

          {/* Home Side */}
          <div className="flex flex-1 items-center justify-between min-w-0" style={{ padding: `0 ${U(2.5)}` }}>
            {!pre && <ScoreNum value={game.home.score ?? 0} />}
            <TeamUnit team={game.home} pre={pre} pp={ppHome} />
          </div>
        </div>

        {/* Bottom split line in team colors */}
        <div
          className="absolute bottom-0 inset-x-0 h-[0.7vmin]"
          style={{
            background: `linear-gradient(90deg, ${away.fill} 0%, ${away.fill} 48%, transparent 48%, transparent 52%, ${home.fill} 52%, ${home.fill} 100%)`,
          }}
        />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ portrait */

function TeamRowPortrait({
  team,
  c,
  pre,
  pp,
}: {
  team: Team;
  c: SideColors;
  pre: boolean;
  pp?: string | null | undefined;
}) {
  return (
    <div
      className="flex items-center justify-between rounded-[2vmin] bg-black/60 border border-white/10 p-[2.4vmin]"
      style={{
        borderLeft: `${U(0.7)} solid ${c.fill}`,
      }}
    >
      <div className="flex items-center min-w-0" style={{ gap: U(2) }}>
        <div className="relative inline-flex items-center justify-center">
          <TeamBadge team={team} size={U(11.5)} plain />
          {pp && (
            <span
              className="absolute -top-[0.8vmin] -right-[1.2vmin] rounded-full bg-amber-400 px-[1.2vmin] py-[0.3vmin] font-display font-black uppercase tracking-wider text-black shadow-[0_0_1.2vmin_rgba(251,191,36,0.9)] animate-pulse"
              style={{ fontSize: U(1.5) }}
            >
              {pp}
            </span>
          )}
        </div>
        <div className="flex flex-col min-w-0">
          <span
            className="font-display font-black uppercase tracking-wide truncate text-white"
            style={{
              fontSize: U(3.2),
              textShadow: "0 .04em .2em rgba(0,0,0,.6)",
            }}
          >
            {team.name}
          </span>
          <div className="flex items-center" style={{ gap: U(1) }}>
            <span className="font-display font-bold uppercase tracking-wider text-slate-400 opacity-80" style={{ fontSize: U(1.6) }}>
              {team.abbr}
            </span>
            <RecordPill record={team.record} />
          </div>
        </div>
      </div>
      {!pre && (
        <div className="shrink-0 pl-3">
          <ScoreNum value={team.score ?? 0} />
        </div>
      )}
    </div>
  );
}

function PlatePortrait({ game, now, scale }: { game: Game; now: number; scale: number }) {
  const { away, home } = resolveMatchup(game.away, game.home);
  const pre = game.status === "pre";
  const post = game.status === "post";
  const live = game.status === "in";
  const clock = useGameClock(live ? game : undefined);
  const left = startMs(game) - now;
  const label = shortPeriod(game.period_label ?? "");
  const clockText = game.intermission
    ? "INT"
    : clock.text || game.clock || (game.period_label === "shootout" ? "SO" : "");
  const w = whenLabel(startMs(game), now);

  const sogRow = game.stat_rows?.find(
    (r) => r.key === "shots" || r.key === "SOG" || r.key === "S" || r.label?.toLowerCase() === "shots",
  );
  const sog = sogRow ? { away: sogRow.away, home: sogRow.home } : game.sog ? { away: String(game.sog.away), home: String(game.sog.home) } : undefined;
  const ppAway = powerPlayFor(game, "away");
  const ppHome = powerPlayFor(game, "home");

  return (
    <div
      className="relative flex h-full w-full flex-col justify-between p-[3vmin] overflow-hidden bg-[#04060a] text-white"
      style={{ ["--u" as string]: `calc(var(--u0) * ${scale})` }}
    >
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background: `linear-gradient(135deg, ${away.fill} 0%, transparent 50%)`,
          clipPath: "polygon(0 0, 50vmin 0, 0 50vmin)",
          opacity: 0.8,
        }}
      />
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background: `linear-gradient(315deg, ${home.fill} 0%, transparent 50%)`,
          clipPath: "polygon(100% calc(100% - 50vmin), 100% 100%, calc(100% - 50vmin) 100%)",
          opacity: 0.8,
        }}
      />

      <div className="relative flex flex-col justify-between h-full rounded-[2.8vmin] bg-black/85 border border-white/12 shadow-[0_0_8vmin_rgba(0,0,0,0.9)] backdrop-blur-xl p-[3vmin]">
        <TeamRowPortrait team={game.away} c={away} pre={pre} pp={ppAway} />

        {/* Center Clock Pod */}
        <div className="flex flex-col items-center justify-center my-auto rounded-[2vmin] bg-white/[0.04] border border-white/10 p-[3vmin]" style={{ gap: U(1.2) }}>
          <div
            className="flex items-center rounded-full bg-white/10 font-display font-bold uppercase tracking-[.22em] text-white"
            style={{ gap: U(1.2), padding: `${U(0.4)} ${U(2)}`, fontSize: U(1.8) }}
          >
            {live && (
              <span
                className="live-dot inline-block rounded-full bg-red-500"
                style={{ width: U(1.1), height: U(1.1) }}
              />
            )}
            <span className="opacity-75 font-black">{game.league.toUpperCase()}</span>
            <span>
              {pre
                ? "Upcoming"
                : post
                ? statusText(game)
                : game.intermission
                ? `End ${label}`
                : label}
            </span>
          </div>

          <div
            className="num font-display font-black leading-none text-white tracking-tight text-center"
            style={{
              fontSize: U(pre ? (left > 0 ? 9 : 7) : clockText.length > 5 ? 8 : 12),
              textShadow: "0 .04em .3em rgba(0,0,0,.6)",
            }}
          >
            {pre
              ? left > 0
                ? countdown(left)
                : "ANY MOMENT"
              : post
              ? statusText(game).toUpperCase()
              : clockText}
          </div>

          <div className="flex items-center justify-center" style={{ minHeight: U(2.6) }}>
            {pre ? (
              <div
                className="font-display font-semibold uppercase tracking-[.18em] opacity-80 text-slate-300"
                style={{ fontSize: U(1.8) }}
              >
                {w.date} · {w.time}
              </div>
            ) : sog ? (
              <div
                className="flex items-center font-display uppercase tracking-widest text-slate-300"
                style={{ gap: U(1.4), fontSize: U(1.8) }}
              >
                <span className="font-black text-white">{sog.away}</span>
                <span className="opacity-60 text-xs font-bold tracking-wider">SOG</span>
                <span className="font-black text-white">{sog.home}</span>
              </div>
            ) : post ? (
              <div
                className="font-display font-semibold uppercase tracking-[.18em] opacity-80 text-slate-400"
                style={{ fontSize: U(1.8) }}
              >
                {game.period > 3
                  ? game.period_label === "shootout"
                    ? "FINAL / SO"
                    : "FINAL / OT"
                  : "GAME COMPLETE"}
              </div>
            ) : game.intermission ? (
              <div
                className="font-display font-semibold uppercase tracking-[.18em] text-amber-400"
                style={{ fontSize: U(1.8) }}
              >
                INTERMISSION
              </div>
            ) : null}
          </div>
        </div>

        <TeamRowPortrait team={game.home} c={home} pre={pre} pp={ppHome} />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ single team */

function SingleTeamIdleScreen({
  teamAbbr,
  next,
  now,
  loading,
}: {
  teamAbbr: string;
  next?: GameLite | null | undefined;
  now: number;
  loading?: boolean | undefined;
}) {
  return (
    <div
      className="fade-in absolute inset-0 flex flex-col items-center justify-center text-center text-white"
      style={{
        background: "radial-gradient(80% 80% at 50% 40%, #16203a, #07090f)",
        gap: U(2.5),
      }}
    >
      <div className="font-display font-black tracking-[.3em] opacity-50" style={{ fontSize: U(2.6) }}>
        HOMEROOM · {teamAbbr} MANCAVE
      </div>
      {next ? (
        <>
          <div className="font-display uppercase tracking-[.25em] opacity-70 font-bold" style={{ fontSize: U(2) }}>
            Next Game
          </div>
          <div className="flex items-center" style={{ gap: U(3) }}>
            <TeamBadge team={next.away} size={U(11)} />
            <span className="font-display font-black" style={{ fontSize: U(4.5) }}>
              {next.away.abbr} @ {next.home.abbr}
            </span>
            <TeamBadge team={next.home} size={U(11)} />
          </div>
          <div className="num font-display font-black" style={{ fontSize: U(11) }}>
            {countdown(startMs(next) - now)}
          </div>
          <div className="font-display opacity-70" style={{ fontSize: U(2.2) }}>
            {new Date(startMs(next)).toLocaleDateString([], { weekday: "long" })} {timeLabel(startMs(next))}
          </div>
        </>
      ) : (
        !loading && (
          <div className="font-display opacity-70" style={{ fontSize: U(3.5) }}>
            No scheduled games for {teamAbbr} today
          </div>
        )
      )}
    </div>
  );
}

function SingleTeamPlateLandscape({
  game,
  isHome,
  now,
  scale,
}: {
  game: Game;
  isHome: boolean;
  now: number;
  scale: number;
}) {
  const { away, home } = resolveMatchup(game.away, game.home);
  const myColor = isHome ? home : away;
  const oppColor = isHome ? away : home;
  const myTeam = isHome ? game.home : game.away;
  const oppTeam = isHome ? game.away : game.home;
  const pre = game.status === "pre";
  const post = game.status === "post";
  const live = game.status === "in";
  const clock = useGameClock(live ? game : undefined);
  const left = startMs(game) - now;
  const label = shortPeriod(game.period_label ?? "");
  const clockText = game.intermission
    ? "INT"
    : clock.text || game.clock || (game.period_label === "shootout" ? "SO" : "");
  const w = whenLabel(startMs(game), now);

  const sit = singleTeamSituation(game, isHome);
  const sogRow = game.stat_rows?.find(
    (r) => r.key === "shots" || r.key === "SOG" || r.key === "S" || r.label?.toLowerCase() === "shots",
  );
  const sog = sogRow
    ? { my: isHome ? sogRow.home : sogRow.away, opp: isHome ? sogRow.away : sogRow.home }
    : game.sog
    ? { my: String(isHome ? game.sog.home : game.sog.away), opp: String(isHome ? game.sog.away : game.sog.home) }
    : undefined;

  const myScore = myTeam.score ?? 0;
  const oppScore = oppTeam.score ?? 0;
  const won = myScore > oppScore;
  const isOt = game.period > 3;
  const isSo = game.period_label === "shootout" || game.period === 5;
  const outcomeText = won ? "WIN" : isSo ? "SOL" : isOt ? "OTL" : "LOSS";

  return (
    <div
      className="relative flex h-full w-full items-center justify-center p-[3vmin] overflow-hidden bg-[#04060a] text-white"
      style={{ ["--u" as string]: `calc(var(--u0) * ${scale})` }}
    >
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background: `linear-gradient(135deg, ${myColor.fill} 0%, ${myColor.deep} 45%, transparent 75%)`,
          clipPath: "polygon(0 0, 50vmin 0, 0 50vmin)",
          opacity: 0.9,
        }}
      />
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background: "radial-gradient(85% 75% at 40% 50%, rgba(18,22,34,.6) 0%, rgba(4,6,10,.98) 100%)",
        }}
      />

      <div
        className="relative flex flex-col justify-between w-full max-w-[94vw] h-[86vh] rounded-[2.8vmin] bg-black/85 border border-white/12 shadow-[0_0_8vmin_rgba(0,0,0,0.95)] backdrop-blur-xl p-[3.2vmin] overflow-hidden"
        style={{ borderLeft: `${U(0.9)} solid ${myColor.fill}` }}
      >
        <div className="pointer-events-none absolute inset-x-0 top-0 h-[1px] bg-gradient-to-r from-transparent via-white/25 to-transparent" />

        <header className="relative flex items-center justify-between border-b border-white/10 pb-[1.4vmin]">
          <div className="flex items-center" style={{ gap: U(1.2) }}>
            <span
              className="inline-flex items-center rounded-full bg-white/10 font-display font-black uppercase tracking-[.22em] text-white"
              style={{ padding: `${U(0.35)} ${U(1.6)}`, fontSize: U(1.6) }}
            >
              {game.league.toUpperCase()}
            </span>
            <span className="font-display font-bold uppercase tracking-wider text-slate-400" style={{ fontSize: U(1.5) }}>
              {isHome ? `VS ${oppTeam.abbr}` : `@ ${oppTeam.abbr}`}
            </span>
          </div>

          <div className="flex items-center" style={{ gap: U(1.2) }}>
            {live && (
              <span
                className="live-dot inline-block rounded-full bg-red-500"
                style={{ width: U(1.1), height: U(1.1) }}
              />
            )}
            <span
              className="font-display font-bold uppercase tracking-[.2em] text-slate-300"
              style={{ fontSize: U(1.6) }}
            >
              {pre
                ? "UPCOMING"
                : post
                ? isOt
                  ? isSo
                    ? "FINAL / SO"
                    : "FINAL / OT"
                  : "FINAL"
                : game.intermission
                ? `INTERMISSION · END ${label}`
                : `${label} · ${clockText}`}
            </span>
            {post && (
              <span
                className={`inline-flex items-center rounded-full font-display font-black uppercase tracking-wider ${
                  won
                    ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40"
                    : "bg-slate-500/20 text-slate-300 border border-slate-500/30"
                }`}
                style={{ padding: `${U(0.25)} ${U(1.2)}`, fontSize: U(1.4) }}
              >
                {outcomeText}
              </span>
            )}
          </div>
        </header>

        <div className="relative flex flex-1 items-center justify-between" style={{ gap: U(3) }}>
          <div className="flex items-center" style={{ gap: U(3), minWidth: U(30) }}>
            <div className="relative inline-flex items-center justify-center shrink-0">
              <TeamBadge team={myTeam} size={U(17)} plain />
              {sit && (
                <span
                  className={`absolute -top-[1vmin] -right-[1.5vmin] rounded-full px-[1.4vmin] py-[0.35vmin] font-display font-black uppercase tracking-wider text-black shadow-lg animate-pulse ${
                    sit.type === "pp" ? "bg-amber-400 shadow-amber-400/50" : "bg-red-400 shadow-red-400/50 text-white"
                  }`}
                  style={{ fontSize: U(1.6) }}
                >
                  {sit.text}
                </span>
              )}
            </div>

            <div className="flex flex-col">
              <div
                className="font-display font-black uppercase tracking-wide text-white leading-[0.95] max-w-[28vw] truncate"
                style={{
                  fontSize: U(4.5),
                  textShadow: "0 .04em .3em rgba(0,0,0,.7)",
                }}
              >
                {myTeam.name}
              </div>
              <div className="flex items-center mt-[0.8vmin]" style={{ gap: U(1) }}>
                <span className="font-display font-bold uppercase tracking-wider text-slate-300" style={{ fontSize: U(1.8), color: myColor.fill }}>
                  {myTeam.abbr}
                </span>
                <RecordPill record={myTeam.record} />
                <span className="font-display font-semibold uppercase tracking-wider text-slate-400" style={{ fontSize: U(1.4) }}>
                  {isHome ? "HOME" : "AWAY"}
                </span>
              </div>
              {sog && (
                <div className="font-display font-semibold uppercase tracking-widest text-slate-400 mt-[1vmin]" style={{ fontSize: U(1.5) }}>
                  SOG: <span className="font-black text-white">{sog.my}</span>
                </div>
              )}
            </div>
          </div>

          <div className="flex flex-col items-center justify-center" style={{ gap: U(1) }}>
            {pre ? (
              <div className="flex flex-col items-center justify-center rounded-[2vmin] bg-white/[0.04] border border-white/10 p-[2.5vmin]" style={{ gap: U(0.8), minWidth: U(26) }}>
                <span className="font-display font-bold uppercase tracking-[.2em] text-amber-400" style={{ fontSize: U(1.5) }}>
                  PUCK DROP
                </span>
                <div
                  className="num font-display font-black leading-none text-white tracking-tight"
                  style={{
                    fontSize: U(left > 0 ? 8 : 6.5),
                    textShadow: "0 .04em .3em rgba(0,0,0,.7)",
                  }}
                >
                  {left > 0 ? countdown(left) : "ANY MOMENT"}
                </div>
                <span className="font-display font-semibold uppercase tracking-wider text-slate-400" style={{ fontSize: U(1.5) }}>
                  {w.date} · {w.time}
                </span>
              </div>
            ) : (
              <div className="flex items-center rounded-[2.5vmin] bg-black/60 border border-white/10 px-[3.5vmin] py-[1.8vmin] backdrop-blur-md" style={{ gap: U(2.5) }}>
                <div className="flex flex-col items-center">
                  <span className="font-display font-bold text-xs uppercase text-slate-400 mb-[0.2vmin]">{myTeam.abbr}</span>
                  <ScoreNum value={myScore} />
                </div>
                <span className="font-display font-thin text-white/30 text-center" style={{ fontSize: U(7) }}>
                  –
                </span>
                <div className="flex flex-col items-center">
                  <span className="font-display font-bold text-xs uppercase text-slate-400 mb-[0.2vmin]">{oppTeam.abbr}</span>
                  <span
                    className="score-pop num inline-block font-display font-black leading-none text-white/70 shrink-0"
                    style={{
                      fontSize: U(myScore < 10 && oppScore < 10 ? 13 : 10),
                      textShadow: "0 .04em .3em rgba(0,0,0,.6)",
                    }}
                  >
                    {oppScore}
                  </span>
                </div>
              </div>
            )}
          </div>

          <div className="flex items-center justify-end" style={{ gap: U(2.2), minWidth: U(24) }}>
            <div className="flex flex-col text-right items-end">
              <span className="font-display font-bold uppercase tracking-wider text-slate-400" style={{ fontSize: U(1.4) }}>
                OPPONENT
              </span>
              <div
                className="font-display font-black uppercase tracking-wide text-white leading-tight max-w-[20vw] truncate"
                style={{ fontSize: U(2.8) }}
              >
                {oppTeam.name}
              </div>
              <div className="flex items-center mt-[0.5vmin]" style={{ gap: U(0.8) }}>
                <span className="font-display font-bold uppercase tracking-wider text-slate-400" style={{ fontSize: U(1.5) }}>
                  {oppTeam.abbr}
                </span>
                <RecordPill record={oppTeam.record} />
              </div>
              {sog && (
                <div className="font-display font-semibold uppercase tracking-widest text-slate-400 mt-[0.8vmin]" style={{ fontSize: U(1.4) }}>
                  OPP SOG: <span className="font-black text-white">{sog.opp}</span>
                </div>
              )}
            </div>
            <TeamBadge team={oppTeam} size={U(11.5)} plain />
          </div>
        </div>

        <div
          className="absolute bottom-0 inset-x-0 h-[0.7vmin]"
          style={{
            background: `linear-gradient(90deg, ${myColor.fill} 0%, ${myColor.fill} 70%, ${oppColor.fill} 100%)`,
          }}
        />
      </div>
    </div>
  );
}

function SingleTeamPlatePortrait({
  game,
  isHome,
  now,
  scale,
}: {
  game: Game;
  isHome: boolean;
  now: number;
  scale: number;
}) {
  const { away, home } = resolveMatchup(game.away, game.home);
  const myColor = isHome ? home : away;
  const oppColor = isHome ? away : home;
  const myTeam = isHome ? game.home : game.away;
  const oppTeam = isHome ? game.away : game.home;
  const pre = game.status === "pre";
  const post = game.status === "post";
  const live = game.status === "in";
  const clock = useGameClock(live ? game : undefined);
  const left = startMs(game) - now;
  const label = shortPeriod(game.period_label ?? "");
  const clockText = game.intermission
    ? "INT"
    : clock.text || game.clock || (game.period_label === "shootout" ? "SO" : "");
  const w = whenLabel(startMs(game), now);

  const sit = singleTeamSituation(game, isHome);
  const sogRow = game.stat_rows?.find(
    (r) => r.key === "shots" || r.key === "SOG" || r.key === "S" || r.label?.toLowerCase() === "shots",
  );
  const sog = sogRow
    ? { my: isHome ? sogRow.home : sogRow.away, opp: isHome ? sogRow.away : sogRow.home }
    : game.sog
    ? { my: String(isHome ? game.sog.home : game.sog.away), opp: String(isHome ? game.sog.away : game.sog.home) }
    : undefined;

  const myScore = myTeam.score ?? 0;
  const oppScore = oppTeam.score ?? 0;
  const won = myScore > oppScore;
  const isOt = game.period > 3;
  const isSo = game.period_label === "shootout" || game.period === 5;
  const outcomeText = won ? "WIN" : isSo ? "SOL" : isOt ? "OTL" : "LOSS";

  return (
    <div
      className="relative flex h-full w-full flex-col justify-between p-[3vmin] overflow-hidden bg-[#04060a] text-white"
      style={{ ["--u" as string]: `calc(var(--u0) * ${scale})` }}
    >
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background: `linear-gradient(135deg, ${myColor.fill} 0%, transparent 60%)`,
          clipPath: "polygon(0 0, 55vmin 0, 0 55vmin)",
          opacity: 0.85,
        }}
      />
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background: "radial-gradient(80% 80% at 50% 50%, rgba(18,22,34,.6) 0%, rgba(4,6,10,.98) 100%)",
        }}
      />

      <div
        className="relative flex flex-col justify-between h-full rounded-[2.8vmin] bg-black/85 border border-white/12 shadow-[0_0_8vmin_rgba(0,0,0,0.95)] backdrop-blur-xl p-[3vmin]"
        style={{ borderLeft: `${U(0.8)} solid ${myColor.fill}` }}
      >
        <header className="flex items-center justify-between border-b border-white/10 pb-[1.6vmin]">
          <div className="flex items-center" style={{ gap: U(1.2) }}>
            <span
              className="inline-flex items-center rounded-full bg-white/10 font-display font-black uppercase tracking-[.22em] text-white"
              style={{ padding: `${U(0.35)} ${U(1.6)}`, fontSize: U(1.6) }}
            >
              {game.league.toUpperCase()}
            </span>
            <span className="font-display font-bold uppercase tracking-wider text-slate-400" style={{ fontSize: U(1.5) }}>
              {isHome ? `VS ${oppTeam.abbr}` : `@ ${oppTeam.abbr}`}
            </span>
          </div>

          <div className="flex items-center" style={{ gap: U(1) }}>
            {live && (
              <span
                className="live-dot inline-block rounded-full bg-red-500"
                style={{ width: U(1.1), height: U(1.1) }}
              />
            )}
            <span
              className="font-display font-bold uppercase tracking-[.2em] text-slate-300"
              style={{ fontSize: U(1.5) }}
            >
              {pre
                ? "UPCOMING"
                : post
                ? "FINAL"
                : game.intermission
                ? "INTERMISSION"
                : label}
            </span>
            {post && (
              <span
                className={`inline-flex items-center rounded-full font-display font-black uppercase tracking-wider ${
                  won
                    ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40"
                    : "bg-slate-500/20 text-slate-300 border border-slate-500/30"
                }`}
                style={{ padding: `${U(0.2)} ${U(1)}`, fontSize: U(1.3) }}
              >
                {outcomeText}
              </span>
            )}
          </div>
        </header>

        <div className="flex items-center rounded-[2vmin] bg-white/[0.03] border border-white/10 p-[2.2vmin]" style={{ gap: U(2) }}>
          <div className="relative inline-flex items-center justify-center shrink-0">
            <TeamBadge team={myTeam} size={U(13)} plain />
            {sit && (
              <span
                className={`absolute -top-[0.8vmin] -right-[1.2vmin] rounded-full px-[1.2vmin] py-[0.3vmin] font-display font-black uppercase tracking-wider text-black shadow-lg animate-pulse ${
                  sit.type === "pp" ? "bg-amber-400" : "bg-red-400 text-white"
                }`}
                style={{ fontSize: U(1.4) }}
              >
                {sit.text}
              </span>
            )}
          </div>
          <div className="flex flex-col min-w-0">
            <span
              className="font-display font-black uppercase tracking-wide truncate text-white"
              style={{
                fontSize: U(3.4),
                textShadow: "0 .04em .2em rgba(0,0,0,.6)",
              }}
            >
              {myTeam.name}
            </span>
            <div className="flex items-center mt-[0.4vmin]" style={{ gap: U(1) }}>
              <span className="font-display font-bold uppercase tracking-wider text-slate-400" style={{ fontSize: U(1.6), color: myColor.fill }}>
                {myTeam.abbr}
              </span>
              <RecordPill record={myTeam.record} />
            </div>
            {sog && (
              <span className="font-display font-semibold uppercase tracking-widest text-slate-400 mt-[0.6vmin]" style={{ fontSize: U(1.4) }}>
                SHOTS: <span className="font-black text-white">{sog.my}</span>
              </span>
            )}
          </div>
        </div>

        <div className="flex flex-col items-center justify-center my-auto rounded-[2.5vmin] bg-black/60 border border-white/10 p-[3vmin]" style={{ gap: U(1) }}>
          {pre ? (
            <>
              <span className="font-display font-bold uppercase tracking-[.22em] text-amber-400" style={{ fontSize: U(1.6) }}>
                PUCK DROP COUNTDOWN
              </span>
              <div
                className="num font-display font-black leading-none text-white tracking-tight"
                style={{ fontSize: U(left > 0 ? 9 : 7), textShadow: "0 .04em .3em rgba(0,0,0,.7)" }}
              >
                {left > 0 ? countdown(left) : "ANY MOMENT"}
              </div>
              <span className="font-display font-semibold uppercase tracking-wider text-slate-400" style={{ fontSize: U(1.6) }}>
                {w.date} · {w.time}
              </span>
            </>
          ) : (
            <>
              <div className="flex items-center" style={{ gap: U(3) }}>
                <div className="flex flex-col items-center">
                  <span className="font-display font-bold text-xs uppercase text-slate-400 mb-[0.2vmin]">{myTeam.abbr}</span>
                  <ScoreNum value={myScore} />
                </div>
                <span className="font-display font-thin text-white/30 text-center" style={{ fontSize: U(8) }}>
                  –
                </span>
                <div className="flex flex-col items-center">
                  <span className="font-display font-bold text-xs uppercase text-slate-400 mb-[0.2vmin]">{oppTeam.abbr}</span>
                  <span
                    className="score-pop num inline-block font-display font-black leading-none text-white/70 shrink-0"
                    style={{
                      fontSize: U(myScore < 10 && oppScore < 10 ? 14 : 11),
                      textShadow: "0 .04em .3em rgba(0,0,0,.6)",
                    }}
                  >
                    {oppScore}
                  </span>
                </div>
              </div>

              <div
                className="num font-display font-black leading-none text-white tracking-tight text-center mt-[1vmin]"
                style={{ fontSize: U(clockText.length > 5 ? 7 : 9.5) }}
              >
                {post ? statusText(game).toUpperCase() : clockText}
              </div>
            </>
          )}
        </div>

        <div
          className="flex items-center justify-between rounded-[2vmin] bg-black/60 border border-white/10 p-[2vmin]"
          style={{ borderRight: `${U(0.7)} solid ${oppColor.fill}` }}
        >
          <div className="flex items-center" style={{ gap: U(1.8) }}>
            <TeamBadge team={oppTeam} size={U(10.5)} plain />
            <div className="flex flex-col">
              <span className="font-display font-bold uppercase tracking-wider text-slate-400" style={{ fontSize: U(1.3) }}>
                {isHome ? "VISITOR" : "HOME"}
              </span>
              <span className="font-display font-black uppercase text-white truncate max-w-[45vw]" style={{ fontSize: U(2.6) }}>
                {oppTeam.name}
              </span>
              <div className="flex items-center mt-[0.3vmin]" style={{ gap: U(0.8) }}>
                <span className="font-display font-bold uppercase tracking-wider text-slate-400" style={{ fontSize: U(1.5) }}>
                  {oppTeam.abbr}
                </span>
                <RecordPill record={oppTeam.record} />
              </div>
            </div>
          </div>
          {sog && (
            <div className="flex flex-col items-end pr-2">
              <span className="font-display text-[1vmin] font-bold uppercase text-slate-400">SOG</span>
              <span className="font-display font-black text-white" style={{ fontSize: U(2.4) }}>{sog.opp}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function pickTeamGame(
  teamGames: Game[],
  wantGame: string,
  finalSeen: Map<string, number>,
  now: number,
): Game | undefined {
  if (wantGame !== "auto") {
    return teamGames.find((g) => g.id === wantGame) ?? teamGames[0];
  }
  const rank = (g: Game) =>
    g.status === "in" ? (g.intermission ? 1 : 0)
    : g.status === "pre" ? 2
    : now - (finalSeen.get(g.id) ?? now) < FINAL_MS ? 3 : 9;

  return [...teamGames].filter((g) => rank(g) < 9).sort((a, b) => rank(a) - rank(b) || startMs(a) - startMs(b))[0];
}

/* ------------------------------------------------------------------ main view */

export default function Plate() {
  useKiosk();
  const want = useQueryParam("game") ?? "auto";
  const wantTeamParam = useQueryParam("team");
  const isSingleTeamMode = wantTeamParam !== null;

  const { games, conn } = useLive("plate", want);
  const now = useNow(1000);
  const orientation = useOrientation();
  const finalSeen = useRef(new Map<string, number>());
  const sync = useSync(60_000);
  const nextMine = useNextMine(sync, want === "auto");

  const all = [...games.values()];
  for (const g of all) if (g.status === "post" && !finalSeen.current.has(g.id)) finalSeen.current.set(g.id, Date.now());

  // Single-team mode resolution
  const targetAbbr = isSingleTeamMode
    ? (wantTeamParam === "auto"
        ? (sync?.favorites?.find((f) =>
            all.some((g) => g.home.abbr.toUpperCase() === f.abbr.toUpperCase() || g.away.abbr.toUpperCase() === f.abbr.toUpperCase()),
          )?.abbr ?? sync?.favorites?.[0]?.abbr ?? (all[0]?.home?.abbr || "BOS")
          ).toUpperCase()
        : wantTeamParam.toUpperCase())
    : undefined;

  const match = (id: string) => {
    if (isSingleTeamMode && targetAbbr) {
      const g = games.get(id);
      if (!g) return false;
      return g.home.abbr.toUpperCase() === targetAbbr || g.away.abbr.toUpperCase() === targetAbbr;
    }
    return want === "auto" ? !sync || (sync.effective ?? sync.games).includes(id) : id === want;
  };

  const goal = useGoalQueue((e) => match(e.game.id));
  const overturned = useOverturned((e) => match(e.game.id));
  const scale = orientation === "portrait" ? 0.95 : 1.0;

  if (isSingleTeamMode && targetAbbr) {
    const teamGames = all.filter(
      (g) => g.home.abbr.toUpperCase() === targetAbbr || g.away.abbr.toUpperCase() === targetAbbr,
    );

    const singleTeamGame = pickTeamGame(teamGames, want, finalSeen.current, now);

    const finalExpired = !!singleTeamGame && singleTeamGame.status === "post" && now - (finalSeen.current.get(singleTeamGame.id) ?? now) >= FINAL_MS;

    if (!singleTeamGame || finalExpired) {
      const upcomingForTeam = teamGames.find((g) => g.status === "pre") ?? (nextMine && (nextMine.home.abbr.toUpperCase() === targetAbbr || nextMine.away.abbr.toUpperCase() === targetAbbr) ? nextMine : undefined);
      return (
        <div className="kiosk fixed inset-0">
          <SingleTeamIdleScreen teamAbbr={targetAbbr} next={upcomingForTeam} now={now} loading={wantTeamParam === "auto" && !sync} />
          <GoalOverlay event={goal.current} pending={goal.pending} />
          <ConnDot conn={conn} />
        </div>
      );
    }

    const isHome = singleTeamGame.home.abbr.toUpperCase() === targetAbbr;

    return (
      <div className="kiosk fixed inset-0 bg-[#04060a]">
        {orientation === "portrait" ? (
          <SingleTeamPlatePortrait game={singleTeamGame} isHome={isHome} now={now} scale={scale} />
        ) : (
          <SingleTeamPlateLandscape game={singleTeamGame} isHome={isHome} now={now} scale={scale} />
        )}
        <GoalOverlay event={goal.current} pending={goal.pending} />
        <OverturnedToast event={overturned} />
        <ConnDot conn={conn} />
        <SimBadge active={all.some((g) => g.id === "nhl:sim")} />
      </div>
    );
  }

  // Standard 2-team plate mode
  const game = pick(all, want, sync, finalSeen.current, now);
  const finalExpired = !!game && game.status === "post" && now - (finalSeen.current.get(game.id) ?? now) >= FINAL_MS;

  if (!game || finalExpired || (game.status === "pre" && want === "auto" && startMs(game) - now > PRE_WINDOW_MS)) {
    const livePre = (want === "auto" ? all.filter((g) => g.status === "pre" && sync && isMine(g, sync)) : all.filter((g) => g.status === "pre")).sort((a, b) => startMs(a) - startMs(b))[0];
    const next = want === "auto" ? [livePre, nextMine].filter((g): g is GameLite => !!g).sort((a, b) => startMs(a) - startMs(b))[0] : livePre;
    return (
      <div className="kiosk fixed inset-0">
        <IdleScreen next={next} now={now} loading={want === "auto" && !sync} />
        <GoalOverlay event={goal.current} pending={goal.pending} />
        <ConnDot conn={conn} />
      </div>
    );
  }

  return (
    <div className="kiosk fixed inset-0 bg-[#04060a]">
      {orientation === "portrait" ? (
        <PlatePortrait game={game} now={now} scale={scale} />
      ) : (
        <PlateLandscape game={game} now={now} scale={scale} />
      )}
      <GoalOverlay event={goal.current} pending={goal.pending} />
      <OverturnedToast event={overturned} />
      <ConnDot conn={conn} />
      <SimBadge active={all.some((g) => g.id === "nhl:sim")} />
    </div>
  );
}
