import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Game, GameLite, GoalieStats, HockeyBoxscore, PlayerWatch, SkaterStats, Team } from "../types";
import { useLive } from "../lib/live";
import { isMine, useNextMine, useSync } from "../lib/mine";
import { useKiosk, useNow, useOrientation, useQueryParam } from "../lib/hooks";
import { shortPeriod, startMs, statusText } from "../lib/format";
import { resolveMatchup, type SideColors } from "../lib/colors";
import { useGameClock } from "../lib/clock";
import { ConnDot, SimBadge, TeamBadge } from "../components/Kiosk";
import { GoalOverlay, useGoalQueue } from "../kiosk/GoalOverlay";
import { OverturnedToast, useOverturned } from "../kiosk/Toast";
import { FINAL_MS, IdleScreen, PRE_WINDOW_MS, pick, trackFinalSeen } from "../kiosk/kioskState";
import { Headshot, PlayerHalf, panelBg, Watermark } from "../kiosk/Breaks";
import { api } from "../lib/api";
import { compareSkaters, powerPlayFor, type SkaterSortField } from "../lib/hockey";

const U = (n: number) => `calc(var(--u) * ${n})`;
const D = "font-display";

type DisplayMode = "boxscore" | "cards";
type TeamMode = "both" | "away" | "home";

/* ------------------------------------------------------------------ fallback boxscore */

function fallbackHockeyBoxscore(game: Game): HockeyBoxscore {
  const awaySog = game.sog?.away ?? 0;
  const homeSog = game.sog?.home ?? 0;
  const awayScore = game.away.score ?? 0;
  const homeScore = game.home.score ?? 0;

  const awaySaves = Math.max(0, homeSog - homeScore);
  const homeSaves = Math.max(0, awaySog - awayScore);

  const awaySvPct = homeSog > 0 ? (awaySaves / homeSog).toFixed(3).replace(/^0\./, ".") : ".000";
  const homeSvPct = awaySog > 0 ? (homeSaves / awaySog).toFixed(3).replace(/^0\./, ".") : ".000";

  const extractSkaters = (abbr: string): SkaterStats[] => {
    const list: SkaterStats[] = [];
    for (const g of game.goals) {
      if (g.team_abbr === abbr && g.scorer) {
        list.push({
          id: g.scorer_id ?? `${abbr}:${g.scorer}`,
          name: g.scorer,
          jersey: g.scorer_number,
          position: "F",
          toi: "16:00",
          sog: 1,
          plus_minus: 1,
          goals: 1,
          assists: 0,
          points: 1,
        });
      }
    }
    return list;
  };

  return {
    game_id: game.id,
    game,
    away: {
      team: game.away,
      skaters: extractSkaters(game.away.abbr),
      goalies: [
        {
          id: `${game.away.abbr}:G1`,
          name: `${game.away.name} Goalie`,
          position: "G",
          toi: game.clock || "60:00",
          saves: awaySaves,
          shots_against: homeSog,
          save_pct: awaySvPct,
          goals_against: homeScore,
        },
      ],
    },
    home: {
      team: game.home,
      skaters: extractSkaters(game.home.abbr),
      goalies: [
        {
          id: `${game.home.abbr}:G1`,
          name: `${game.home.name} Goalie`,
          position: "G",
          toi: game.clock || "60:00",
          saves: homeSaves,
          shots_against: awaySog,
          save_pct: homeSvPct,
          goals_against: awayScore,
        },
      ],
    },
    updated_at: Date.now(),
  };
}

/* ------------------------------------------------------------------ Goalie Card */

function GoalieCard({
  goalie,
  team,
  c,
  side,
}: {
  goalie: GoalieStats;
  team: Team;
  c: SideColors;
  side: "away" | "home";
}) {
  const isHigh =
    Number(goalie.save_pct) >= 0.92 ||
    goalie.save_pct.startsWith(".92") ||
    goalie.save_pct.startsWith(".93") ||
    goalie.save_pct.startsWith(".94") ||
    goalie.save_pct.startsWith(".95") ||
    goalie.save_pct === "1.000" ||
    goalie.save_pct === "1.0" ||
    goalie.save_pct === "1";
  const isLow = Number(goalie.save_pct) < 0.88 && Number(goalie.save_pct) > 0;
  const svPctFormatted =
    goalie.save_pct === "1" || goalie.save_pct === "1.0"
      ? "1.000"
      : goalie.save_pct;
  const shotsAgainst = Math.max(goalie.shots_against, goalie.saves + goalie.goals_against);

  return (
    <div
      className="relative flex items-center overflow-hidden rounded-xl border border-white/10 bg-slate-900/60 p-[1.4vmin] shadow-lg backdrop-blur-md"
      style={{
        gap: U(1.8),
        borderLeft: side === "away" ? `${U(0.6)} solid ${c.fill}` : undefined,
        borderRight: side === "home" ? `${U(0.6)} solid ${c.fill}` : undefined,
      }}
    >
      <div className="relative shrink-0">
        <TeamBadge team={team} size={U(6.5)} />
        <span
          className="absolute -bottom-[0.5vmin] -right-[0.5vmin] inline-flex items-center justify-center rounded-full bg-slate-950 font-display font-black text-white px-[0.7vmin] py-[0.1vmin] border border-white/20"
          style={{ fontSize: U(1.3) }}
        >
          #{goalie.jersey || "G"}
        </span>
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-[0.8vmin]">
          <span className="truncate font-display font-black uppercase text-white" style={{ fontSize: goalie.name.length > 14 ? U(1.3) : U(1.5) }}>
            {goalie.name}
          </span>
          <span className="rounded bg-white/10 px-[0.8vmin] py-[0.1vmin] font-display font-bold uppercase text-slate-300" style={{ fontSize: U(1.2) }}>
            {team.abbr} · G
          </span>
        </div>
        <div className="flex items-center font-display uppercase tracking-wider text-slate-400" style={{ gap: U(1.6), fontSize: U(1.4) }}>
          <span>GA: <strong className="num text-white font-bold">{goalie.goals_against}</strong></span>
          <span>TOI: <strong className="num text-slate-300 font-bold">{goalie.toi}</strong></span>
        </div>
      </div>

      <div className="flex items-center shrink-0" style={{ gap: U(2) }}>
        <div className="flex flex-col items-end">
          <span className="font-display font-bold uppercase tracking-wider text-slate-400" style={{ fontSize: U(1.1) }}>
            SAVES / SHOTS
          </span>
          <span className="num font-display font-black text-white" style={{ fontSize: U(2.8) }}>
            {goalie.saves} <span className="opacity-40">/</span> {shotsAgainst}
          </span>
        </div>

        <div
          className={`flex flex-col items-center justify-center rounded-lg px-[1.2vmin] py-[0.5vmin] border ${
            isHigh
              ? "bg-emerald-950/60 border-emerald-500/50 text-emerald-300 shadow-[0_0_1.5vmin_rgba(16,185,129,0.3)]"
              : isLow
              ? "bg-rose-950/60 border-rose-500/40 text-rose-300"
              : "bg-slate-800/60 border-white/15 text-slate-200"
          }`}
          style={{ minWidth: U(8.5) }}
        >
          <span className="font-display font-extrabold uppercase tracking-widest opacity-80" style={{ fontSize: U(1.1) }}>
            SV%
          </span>
          <span className="num font-display font-black text-white" style={{ fontSize: U(2.8) }}>
            {svPctFormatted}
          </span>
        </div>
      </div>
    </div>
  );
}

function getPrimaryGoalie(goalies: GoalieStats[] | undefined): GoalieStats | undefined {
  if (!goalies || goalies.length === 0) return undefined;
  return [...goalies].sort((a, b) => {
    const toiSec = (t: string) => {
      const [m = 0, s = 0] = t.split(":").map(Number);
      return (Number.isFinite(m) ? m : 0) * 60 + (Number.isFinite(s) ? s : 0);
    };
    const diff = toiSec(b.toi) - toiSec(a.toi);
    if (diff !== 0) return diff;
    if (a.starter && !b.starter) return -1;
    if (b.starter && !a.starter) return 1;
    return b.saves - a.saves;
  })[0];
}

/* ------------------------------------------------------------------ Skater Table */

function SkaterTable({
  skaters,
  team,
  c,
  sortField,
  sortDir,
  onSort,
}: {
  skaters: SkaterStats[];
  team: Team;
  c: SideColors;
  sortField: SkaterSortField;
  sortDir: "asc" | "desc";
  onSort: (field: SkaterSortField) => void;
}) {
  const sorted = useMemo(() => {
    return [...skaters].sort((a, b) => compareSkaters(a, b, sortField, sortDir));
  }, [skaters, sortField, sortDir]);

  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-hidden rounded-xl border border-white/10 bg-slate-950/70 shadow-xl backdrop-blur-md">
      {/* Table Team Header */}
      <div
        className="flex items-center justify-between px-[1.6vmin] py-[1vmin] border-b border-white/10"
        style={{
          background: `linear-gradient(90deg, ${c.fill}33, transparent)`,
          borderTop: `${U(0.4)} solid ${c.fill}`,
        }}
      >
        <div className="flex items-center" style={{ gap: U(1.2) }}>
          <TeamBadge team={team} size={U(3.8)} />
          <span className="font-display font-black uppercase text-white tracking-wide" style={{ fontSize: U(2.2) }}>
            {team.name}
          </span>
          <span className="font-display font-bold uppercase text-slate-400 opacity-80" style={{ fontSize: U(1.4) }}>
            ({skaters.length} Skaters)
          </span>
        </div>
        <div className="flex items-center font-display font-bold uppercase text-slate-400" style={{ gap: U(1.4), fontSize: U(1.3) }}>
          <span>Goals: <strong className="num text-white">{skaters.reduce((acc, s) => acc + s.goals, 0)}</strong></span>
          <span>SOG: <strong className="num text-white">{skaters.reduce((acc, s) => acc + s.sog, 0)}</strong></span>
        </div>
      </div>

      {/* Column Headers */}
      <div
        className="grid grid-cols-[5fr_1fr_1fr_1.1fr_1fr_1fr_1.4fr] items-center px-[1.6vmin] py-[0.8vmin] border-b border-white/10 font-display font-bold uppercase tracking-wider text-slate-400 select-none bg-slate-900/50"
        style={{ fontSize: U(1.3) }}
      >
        <span>Player</span>
        <button type="button" onClick={() => onSort("g")} className={`text-right hover:text-white transition-colors ${sortField === "g" ? "text-amber-400 font-black" : ""}`}>
          G {sortField === "g" ? (sortDir === "desc" ? "▼" : "▲") : ""}
        </button>
        <button type="button" onClick={() => onSort("a")} className={`text-right hover:text-white transition-colors ${sortField === "a" ? "text-amber-400 font-black" : ""}`}>
          A {sortField === "a" ? (sortDir === "desc" ? "▼" : "▲") : ""}
        </button>
        <button type="button" onClick={() => onSort("pts")} className={`text-right hover:text-white transition-colors ${sortField === "pts" ? "text-amber-400 font-black" : ""}`}>
          PTS {sortField === "pts" ? (sortDir === "desc" ? "▼" : "▲") : ""}
        </button>
        <button type="button" onClick={() => onSort("pm")} className={`text-right hover:text-white transition-colors ${sortField === "pm" ? "text-amber-400 font-black" : ""}`}>
          +/- {sortField === "pm" ? (sortDir === "desc" ? "▼" : "▲") : ""}
        </button>
        <button type="button" onClick={() => onSort("sog")} className={`text-right hover:text-white transition-colors ${sortField === "sog" ? "text-amber-400 font-black" : ""}`}>
          SOG {sortField === "sog" ? (sortDir === "desc" ? "▼" : "▲") : ""}
        </button>
        <button type="button" onClick={() => onSort("toi")} className={`text-right hover:text-white transition-colors ${sortField === "toi" ? "text-amber-400 font-black" : ""}`}>
          TOI {sortField === "toi" ? (sortDir === "desc" ? "▼" : "▲") : ""}
        </button>
      </div>

      {/* Skater Rows */}
      <div className="flex-1 overflow-y-auto divide-y divide-white/5 font-display">
        {sorted.map((s) => {
          const hasScore = s.goals > 0;
          const hasPoints = s.points > 0;
          return (
            <div
              key={s.id || s.name}
              className={`grid grid-cols-[5fr_1fr_1fr_1.1fr_1fr_1fr_1.4fr] items-center px-[1.6vmin] py-[0.7vmin] transition-colors ${
                hasScore ? "bg-amber-400/10 hover:bg-amber-400/15" : hasPoints ? "bg-white/[0.03] hover:bg-white/[0.06]" : "hover:bg-white/[0.04]"
              }`}
              style={{ fontSize: U(1.5) }}
            >
              {/* Player Info */}
              <div className="flex items-center min-w-0 pr-[0.8vmin]" style={{ gap: U(1) }}>
                <span
                  className="inline-flex items-center justify-center rounded bg-slate-800 text-slate-300 font-bold shrink-0 num px-[0.6vmin] py-[0.1vmin] text-center"
                  style={{ fontSize: U(1.3), minWidth: U(2.6) }}
                >
                  {s.jersey || "-"}
                </span>
                <span className={`truncate font-bold ${hasScore ? "text-amber-300 font-black" : "text-white"}`}>
                  {s.name}
                </span>
                <span
                  className="rounded bg-white/10 px-[0.5vmin] py-[0.1vmin] text-slate-400 text-xs font-bold shrink-0 uppercase"
                  style={{ fontSize: U(1.1) }}
                >
                  {s.position || "F"}
                </span>
              </div>

              {/* Goals */}
              <span className={`num text-right font-black ${s.goals > 0 ? "text-amber-400" : "text-slate-400"}`}>
                {s.goals}
              </span>

              {/* Assists */}
              <span className={`num text-right font-bold ${s.assists > 0 ? "text-slate-200" : "text-slate-500"}`}>
                {s.assists}
              </span>

              {/* Points */}
              <span className={`num text-right font-black ${s.points > 0 ? "text-white" : "text-slate-500"}`}>
                {s.points}
              </span>

              {/* +/- */}
              <span
                className={`num text-right font-black ${
                  s.plus_minus > 0
                    ? "text-emerald-400"
                    : s.plus_minus < 0
                    ? "text-rose-400"
                    : "text-slate-500"
                }`}
              >
                {s.plus_minus > 0 ? `+${s.plus_minus}` : s.plus_minus}
              </span>

              {/* SOG */}
              <span className="num text-right font-bold text-slate-200">
                {s.sog}
              </span>

              {/* TOI */}
              <span className="num text-right font-semibold text-slate-400 tracking-tight">
                {s.toi}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ Single Player Watch Card */

function SinglePlayerCard({
  team,
  c,
  p,
}: {
  team: Team;
  c: SideColors;
  p?: PlayerWatch | undefined;
}) {
  const maxV = Math.max(1, ...(p?.log ?? []).map((l) => l.value));
  const lastFont = p ? 5.2 * Math.min(1, 9 / Math.max(9, p.last.length)) : 0;

  return (
    <div
      className="relative flex min-h-0 min-w-0 flex-1 flex-col justify-between overflow-hidden p-[4cqw]"
      style={{ background: panelBg(c), color: c.text }}
    >
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-transparent via-black/10 to-black/45" />
      <Watermark text={team.abbr} right />

      {p ? (
        <>
          {/* Player Identity */}
          <div className="relative flex items-center gap-[3cqw]">
            <Headshot p={p} team={team} size={11} />
            <div className="min-w-0 flex-1">
              <div className={`${D} font-semibold uppercase tracking-[0.16em]`} style={{ fontSize: U(1.4), opacity: 0.85 }}>
                {[p.team_abbr, p.jersey ? `#${p.jersey}` : "", p.position].filter(Boolean).join(" · ")}
              </div>
              <div className={`${D} font-medium uppercase leading-tight`} style={{ fontSize: U(2.6), marginTop: U(0.3) }}>
                {p.first}
              </div>
              <div className={`${D} truncate font-black uppercase leading-none`} style={{ fontSize: U(lastFont) }}>
                {p.last}
              </div>
            </div>
          </div>

          {/* Stat Tiles */}
          {p.tiles.length > 0 && (
            <div className="relative grid grid-cols-2 gap-[2cqw] sm:grid-cols-4 my-[2cqh]">
              {p.tiles.slice(0, 4).map((t) => (
                <div
                  key={t.label}
                  className="rounded-lg bg-white/15 p-[2cqw] text-center shadow-inner backdrop-blur-sm"
                >
                  <div className={`${D} num font-black leading-none`} style={{ fontSize: U(3.8) }}>
                    {t.value}
                  </div>
                  <div className={`${D} font-bold uppercase tracking-wider opacity-80`} style={{ fontSize: U(1.2), marginTop: U(0.4) }}>
                    {t.label}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Game Log Chart */}
          {p.log.length > 0 && (
            <div className="relative mt-auto">
              <div className={`${D} font-semibold uppercase tracking-[0.18em] opacity-85`} style={{ fontSize: U(1.3), marginBottom: U(0.8) }}>
                {p.log_label}
              </div>
              <div className="flex items-end gap-[1.5cqw]" style={{ height: U(11) }}>
                {p.log.map((l, i) => (
                  <div key={i} className="flex min-w-0 flex-1 flex-col items-center justify-end h-full">
                    <span className={`${D} num font-black leading-none`} style={{ fontSize: U(2.1), marginBottom: U(0.4) }}>
                      {l.value}
                    </span>
                    <div
                      className="w-full rounded-t"
                      style={{
                        height: `${Math.max(6, (l.value / maxV) * 80)}%`,
                        background: c.textIsDark ? "rgba(10,13,20,.9)" : "#fff",
                        opacity: l.value > 0 ? 1 : 0.35,
                      }}
                    />
                    <span className={`${D} mt-[0.5cqh] w-full truncate text-center font-bold uppercase`} style={{ fontSize: U(1.1), opacity: 0.85 }}>
                      {l.opp_abbr}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      ) : (
        <div className="relative flex flex-1 flex-col items-center justify-center gap-3 text-center">
          <TeamBadge team={team} size={U(10)} plain />
          <span className={`${D} font-bold uppercase tracking-widest opacity-70`} style={{ fontSize: U(2) }}>
            No player data
          </span>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ Header Bar */

function HeaderBar({
  game,
  clockText,
  allGames,
  onPrevGame,
  onNextGame,
  teamMode,
  onToggleTeamMode,
  displayMode,
  onToggleDisplayMode,
  hasCards,
}: {
  game: Game;
  clockText: string;
  allGames: Game[];
  onPrevGame: () => void;
  onNextGame: () => void;
  teamMode: TeamMode;
  onToggleTeamMode: () => void;
  displayMode: DisplayMode;
  onToggleDisplayMode: () => void;
  hasCards: boolean;
}) {
  const live = game.status === "in";
  const pre = game.status === "pre";
  const post = game.status === "post";
  const ppAway = powerPlayFor(game, "away");
  const ppHome = powerPlayFor(game, "home");

  return (
    <header
      className="relative flex items-center justify-between px-[2vmin] py-[1.2vmin] bg-slate-950/80 border-b border-white/10 shrink-0"
      style={{ minHeight: U(8.5) }}
    >
      {/* Left: Game Switcher & Team Matchup */}
      <div className="flex items-center" style={{ gap: U(1.5) }}>
        {allGames.length > 1 && (
          <div className="flex items-center bg-slate-900 rounded-lg p-[0.3vmin] border border-white/15" style={{ gap: U(0.4) }}>
            <button
              type="button"
              onClick={onPrevGame}
              className="p-[0.5vmin] text-slate-400 hover:text-white rounded hover:bg-white/10 transition-colors"
              title="Previous Game (Left Arrow / K)"
            >
              ◀
            </button>
            <span className="font-display font-bold uppercase text-slate-300 px-[0.6vmin]" style={{ fontSize: U(1.3) }}>
              {allGames.findIndex((g) => g.id === game.id) + 1} / {allGames.length}
            </span>
            <button
              type="button"
              onClick={onNextGame}
              className="p-[0.5vmin] text-slate-400 hover:text-white rounded hover:bg-white/10 transition-colors"
              title="Next Game (Right Arrow / J)"
            >
              ▶
            </button>
          </div>
        )}

        <div className="flex items-center" style={{ gap: U(1.2) }}>
          {/* Away Team */}
          <div className="flex items-center" style={{ gap: U(0.8) }}>
            <TeamBadge team={game.away} size={U(4.6)} />
            <div className="flex flex-col">
              <div className="flex items-center gap-[0.6vmin]">
                <span className="font-display font-black text-white uppercase tracking-wide leading-none" style={{ fontSize: U(2.0) }}>
                  {game.away.abbr}
                </span>
                {ppAway && (
                  <span className="rounded-full bg-amber-400 px-[0.8vmin] py-[0.1vmin] font-display font-black text-black text-xs animate-pulse">
                    {ppAway}
                  </span>
                )}
              </div>
              <span className="font-display font-semibold uppercase text-slate-400 leading-none mt-[0.3vmin]" style={{ fontSize: U(1.1) }}>
                SOG: <strong className="num text-slate-200">{game.sog?.away ?? "-"}</strong>
              </span>
            </div>
            <span className="num font-display font-black text-white pl-[0.6vmin]" style={{ fontSize: U(3.6) }}>
              {pre ? "-" : game.away.score ?? 0}
            </span>
          </div>

          <span className="font-display font-bold text-slate-600 px-[0.4vmin]" style={{ fontSize: U(1.8) }}>
            @
          </span>

          {/* Home Team */}
          <div className="flex items-center" style={{ gap: U(0.8) }}>
            <span className="num font-display font-black text-white pr-[0.6vmin]" style={{ fontSize: U(3.6) }}>
              {pre ? "-" : game.home.score ?? 0}
            </span>
            <TeamBadge team={game.home} size={U(4.6)} />
            <div className="flex flex-col">
              <div className="flex items-center gap-[0.6vmin]">
                <span className="font-display font-black text-white uppercase tracking-wide leading-none" style={{ fontSize: U(2.0) }}>
                  {game.home.abbr}
                </span>
                {ppHome && (
                  <span className="rounded-full bg-amber-400 px-[0.8vmin] py-[0.1vmin] font-display font-black text-black text-xs animate-pulse">
                    {ppHome}
                  </span>
                )}
              </div>
              <span className="font-display font-semibold uppercase text-slate-400 leading-none mt-[0.3vmin]" style={{ fontSize: U(1.1) }}>
                SOG: <strong className="num text-slate-200">{game.sog?.home ?? "-"}</strong>
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Center: Period & Clock - Locked Dead Center */}
      <div className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 flex flex-col items-center">
        <div className="flex items-center gap-[0.8vmin]">
          {live && <span className="live-dot inline-block rounded-full bg-red-500 w-[1.2vmin] h-[1.2vmin]" />}
          <span className="font-display font-black uppercase tracking-wider text-white" style={{ fontSize: U(2.8) }}>
            {pre
              ? "UPCOMING"
              : post
              ? statusText(game).toUpperCase()
              : clockText}
          </span>
        </div>
        <div className="font-display font-bold uppercase tracking-widest text-slate-400" style={{ fontSize: U(1.3) }}>
          {pre
            ? "PRE-GAME"
            : post
            ? (game.period > 3 || (game.period_label ?? "").toLowerCase().includes("ot") || (game.period_label ?? "").toLowerCase().includes("overtime"))
              ? "OVERTIME"
              : (game.period_label ?? "").toLowerCase().includes("so") || (game.period_label ?? "").toLowerCase().includes("shootout") || game.period === 5
              ? "SHOOTOUT"
              : "REGULATION"
            : game.intermission
            ? "INTERMISSION"
            : shortPeriod(game.period_label || "")}
        </div>
      </div>

      {/* Right: Controls & Badges */}
      <div className="flex items-center" style={{ gap: U(1.6) }}>
        {hasCards && (
          <button
            type="button"
            onClick={onToggleDisplayMode}
            className={`rounded-lg border px-[1.2vmin] py-[0.6vmin] font-display font-black uppercase transition-colors cursor-pointer ${
              displayMode === "cards"
                ? "bg-amber-400/20 border-amber-400 text-amber-300"
                : "bg-slate-800/80 border-white/20 text-slate-300 hover:text-white"
            }`}
            style={{ fontSize: U(1.3) }}
            title="Toggle between Live Boxscore Table and Player Watch Cards (Key V)"
          >
            {displayMode === "cards" ? "CARDS" : "BOXSCORE"}
          </button>
        )}

        <button
          type="button"
          onClick={onToggleTeamMode}
          className="rounded-lg border border-white/20 bg-slate-800/80 px-[1.4vmin] py-[0.6vmin] font-display font-black uppercase text-slate-200 hover:text-white hover:bg-slate-700 transition-colors cursor-pointer"
          style={{ fontSize: U(1.4) }}
          title="Toggle view: Both / Away / Home (Key T)"
        >
          VIEW: {teamMode.toUpperCase()}
        </button>

        <span className="rounded bg-white/10 px-[1vmin] py-[0.4vmin] font-display font-black uppercase tracking-widest text-slate-300" style={{ fontSize: U(1.3) }}>
          {game.league.toUpperCase()}
        </span>
      </div>
    </header>
  );
}

/* ------------------------------------------------------------------ Main Tracker View */

export default function Tracker() {
  useKiosk();
  const wantParam = useQueryParam("game") ?? "auto";
  const cycleParam = useQueryParam("cycle");
  const cycleIntervalS = Math.max(5, Number(cycleParam) || 15);
  const teamParam = useQueryParam("team")?.toUpperCase();
  const sideParam = useQueryParam("side")?.toLowerCase();
  const modeParam = useQueryParam("mode") ?? useQueryParam("view");

  const { games, conn } = useLive("scoreboard", wantParam);
  const now = useNow(1000);
  const orientation = useOrientation();
  const finalSeen = useRef(new Map<string, number>());
  const sync = useSync(60_000);
  const nextMine = useNextMine(sync, wantParam === "auto");

  const [selectedGameId, setSelectedGameId] = useState<string | null>(null);
  const [teamMode, setTeamMode] = useState<TeamMode>(() => {
    if (sideParam === "home" || sideParam === "away") return sideParam;
    return "both";
  });
  const [displayMode, setDisplayMode] = useState<DisplayMode>(
    modeParam === "cards" || modeParam === "watch" ? "cards" : "boxscore",
  );
  const [sortField, setSortField] = useState<SkaterSortField>("pts");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const [boxscore, setBoxscore] = useState<HockeyBoxscore | null>(null);

  const all = useMemo(() => [...games.values()], [games]);
  trackFinalSeen(all, finalSeen.current, now);

  // Automatic picked game
  const autoPicked = pick(all, wantParam, sync, finalSeen.current, now);

  // Active or cycleable games
  const activeGames = useMemo(() => {
    return all.filter((g) => g.status === "in" || g.status === "pre" || g.status === "post");
  }, [all]);

  // Current active game
  const currentGame = useMemo(() => {
    if (wantParam !== "auto") return games.get(wantParam) ?? all.find((g) => g.id === wantParam);
    if (selectedGameId) {
      const g = games.get(selectedGameId);
      if (g) return g;
    }
    return autoPicked;
  }, [wantParam, selectedGameId, games, all, autoPicked]);

  // Handle explicit ?team= param
  useEffect(() => {
    if (!currentGame || !teamParam) return;
    if (currentGame.home.abbr.toUpperCase() === teamParam) setTeamMode("home");
    else if (currentGame.away.abbr.toUpperCase() === teamParam) setTeamMode("away");
  }, [currentGame, teamParam]);

  // Game clock helper
  const clock = useGameClock(currentGame, 250);

  // Auto-cycle through games if ?cycle is set or enabled
  useEffect(() => {
    if (!cycleParam || activeGames.length <= 1) return;
    const timer = setInterval(() => {
      setSelectedGameId((cur) => {
        const idx = activeGames.findIndex((g) => g.id === (cur ?? currentGame?.id));
        const nextIdx = (idx + 1) % activeGames.length;
        return activeGames[nextIdx]?.id ?? null;
      });
    }, cycleIntervalS * 1000);
    return () => clearInterval(timer);
  }, [cycleParam, activeGames, currentGame?.id, cycleIntervalS]);

  // Fetch boxscore data when currentGame changes
  useEffect(() => {
    if (!currentGame) return;

    let mounted = true;
    const fetchBox = async () => {
      try {
        const res = await api.boxscore(currentGame.id);
        if (mounted && res) {
          setBoxscore(res);
        }
      } catch {
        // Network fallback
        if (mounted) {
          setBoxscore(fallbackHockeyBoxscore(currentGame));
        }
      }
    };

    void fetchBox();
    const interval = setInterval(() => void fetchBox(), 10_000);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
    // Deliberately excludes `currentGame?.clock` — the formatted clock string changes every
    // server poll and would restart the fetch interval every second. Score and period changes
    // are sufficient triggers to refresh the boxscore without hammering the server.
  }, [currentGame?.id, currentGame?.period, currentGame?.home.score, currentGame?.away.score]);

  // Keyboard navigation
  const cycleGame = useCallback((direction: 1 | -1) => {
    if (activeGames.length <= 1) return;
    setSelectedGameId((cur) => {
      const idx = activeGames.findIndex((g) => g.id === (cur ?? currentGame?.id));
      const nextIdx = (idx + direction + activeGames.length) % activeGames.length;
      return activeGames[nextIdx]?.id ?? null;
    });
  }, [activeGames, currentGame?.id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === "ArrowRight" || e.key === "ArrowDown" || e.key.toLowerCase() === "j" || e.key.toLowerCase() === "n" || e.key.toLowerCase() === "g") {
        cycleGame(1);
      } else if (e.key === "ArrowLeft" || e.key === "ArrowUp" || e.key.toLowerCase() === "k" || e.key.toLowerCase() === "p") {
        cycleGame(-1);
      } else if (e.key.toLowerCase() === "t") {
        setTeamMode((cur) => (cur === "both" ? "away" : cur === "away" ? "home" : "both"));
      } else if (e.key.toLowerCase() === "v" || e.key.toLowerCase() === "m") {
        setDisplayMode((cur) => (cur === "boxscore" ? "cards" : "boxscore"));
      } else if (e.key.toLowerCase() === "s") {
        const fields: SkaterSortField[] = ["pts", "g", "a", "pm", "sog", "toi"];
        setSortField((cur) => {
          const idx = fields.indexOf(cur);
          return fields[(idx + 1) % fields.length] ?? "pts";
        });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [cycleGame]);

  const handleSort = (field: SkaterSortField) => {
    if (sortField === field) {
      setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    } else {
      setSortField(field);
      setSortDir("desc");
    }
  };

  const match = (id: string) => (wantParam === "auto" ? !sync || (sync.effective ?? sync.games).includes(id) : id === wantParam);
  const goal = useGoalQueue((e) => match(e.game.id));
  const overturned = useOverturned((e) => match(e.game.id));

  // Idle screen check
  const finalExpired = !!currentGame && currentGame.status === "post" && now - (finalSeen.current.get(currentGame.id) ?? now) >= FINAL_MS;
  if (!currentGame || finalExpired || (currentGame.status === "pre" && wantParam === "auto" && startMs(currentGame) - now > PRE_WINDOW_MS)) {
    const livePre = (wantParam === "auto" ? all.filter((g) => g.status === "pre" && sync && isMine(g, sync)) : all.filter((g) => g.status === "pre")).sort((a, b) => startMs(a) - startMs(b))[0];
    const next = wantParam === "auto" ? [livePre, nextMine].filter((g): g is GameLite => !!g).sort((a, b) => startMs(a) - startMs(b))[0] : livePre;
    return (
      <div className="kiosk fixed inset-0">
        <IdleScreen next={next} now={now} loading={wantParam === "auto" && !sync} />
        <GoalOverlay event={goal.current} pending={goal.pending} />
        <ConnDot conn={conn} />
      </div>
    );
  }

  // Active boxscore resolution (fallback if not yet fetched)
  const activeBox = boxscore && boxscore.game_id === currentGame.id ? boxscore : fallbackHockeyBoxscore(currentGame);
  const awayGoalie = getPrimaryGoalie(activeBox.away.goalies);
  const homeGoalie = getPrimaryGoalie(activeBox.home.goalies);
  const { away: awayColors, home: homeColors } = resolveMatchup(currentGame.away, currentGame.home, { whiteText: true });

  const showAway = teamMode === "both" || teamMode === "away";
  const showHome = teamMode === "both" || teamMode === "home";
  const pl = currentGame.insight?.players;
  const hasCards = !!(pl?.home || pl?.away);

  return (
    <div className="kiosk fixed inset-0 bg-[#04060a] flex flex-col text-slate-100 overflow-hidden select-none">
      {/* Top Header Strip */}
      <HeaderBar
        game={currentGame}
        clockText={clock.text}
        allGames={activeGames}
        onPrevGame={() => cycleGame(-1)}
        onNextGame={() => cycleGame(1)}
        teamMode={teamMode}
        onToggleTeamMode={() => setTeamMode((cur) => (cur === "both" ? "away" : cur === "away" ? "home" : "both"))}
        displayMode={displayMode}
        onToggleDisplayMode={() => setDisplayMode((cur) => (cur === "boxscore" ? "cards" : "boxscore"))}
        hasCards={hasCards}
      />

      {/* Main Companion Body */}
      {displayMode === "cards" && hasCards ? (
        <main className="relative flex min-h-0 flex-1 overflow-hidden">
          {teamMode === "home" ? (
            <SinglePlayerCard team={currentGame.home} c={homeColors} p={pl?.home} />
          ) : teamMode === "away" ? (
            <SinglePlayerCard team={currentGame.away} c={awayColors} p={pl?.away} />
          ) : orientation === "portrait" ? (
            <div className="grid h-full w-full grid-rows-2 gap-1 bg-ink-900">
              <SinglePlayerCard team={currentGame.away} c={awayColors} p={pl?.away} />
              <SinglePlayerCard team={currentGame.home} c={homeColors} p={pl?.home} />
            </div>
          ) : (
            <div className="relative grid h-full w-full grid-cols-2 gap-1 bg-ink-900">
              <PlayerHalf team={currentGame.away} c={awayColors} p={pl?.away} right={false} />
              <PlayerHalf team={currentGame.home} c={homeColors} p={pl?.home} right />
              <div
                className={`${D} absolute left-1/2 top-1/2 z-10 flex -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-ink-950 font-black`}
                style={{ width: U(4.8), height: U(4.8), fontSize: U(2), boxShadow: "0 0 0 .3vmin #fff" }}
              >
                VS
              </div>
            </div>
          )}
        </main>
      ) : (
        <div className="flex-1 min-h-0 flex flex-col p-[1.6vmin] overflow-hidden" style={{ gap: U(1.6) }}>
          {/* Goalie Duel Showcase */}
          <section className="grid grid-cols-1 md:grid-cols-2 shrink-0" style={{ gap: U(1.6) }}>
            {awayGoalie && (
              <GoalieCard
                goalie={awayGoalie}
                team={currentGame.away}
                c={awayColors}
                side="away"
              />
            )}
            {homeGoalie && (
              <GoalieCard
                goalie={homeGoalie}
                team={currentGame.home}
                c={homeColors}
                side="home"
              />
            )}
          </section>

          {/* Skater Tables */}
          <section
            className={`flex-1 min-h-0 ${
              orientation === "portrait" || teamMode !== "both"
                ? "flex flex-col"
                : "grid grid-cols-1 lg:grid-cols-2"
            }`}
            style={{ gap: U(1.6) }}
          >
            {showAway && (
              <SkaterTable
                skaters={activeBox.away.skaters}
                team={currentGame.away}
                c={awayColors}
                sortField={sortField}
                sortDir={sortDir}
                onSort={handleSort}
              />
            )}
            {showHome && (
              <SkaterTable
                skaters={activeBox.home.skaters}
                team={currentGame.home}
                c={homeColors}
                sortField={sortField}
                sortDir={sortDir}
                onSort={handleSort}
              />
            )}
          </section>
        </div>
      )}

      {/* Overlays & Status */}
      <GoalOverlay event={goal.current} pending={goal.pending} />
      <OverturnedToast event={overturned} />
      <ConnDot conn={conn} />
      <SimBadge active={all.some((g) => g.id === "nhl:sim")} />
    </div>
  );
}
