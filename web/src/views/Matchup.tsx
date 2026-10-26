import { useState } from "react";
import type { Game, GameLite, StartingGoalie, SyncState, Team } from "../types";
import { useLive } from "../lib/live";
import { isMine, useNextMine, useSync } from "../lib/mine";
import { useKiosk, useNow, useOrientation, useQueryParam } from "../lib/hooks";
import { countdown, startMs, statusText, whenLabel } from "../lib/format";
import { resolveMatchup, type SideColors } from "../lib/colors";
import { ConnDot, SimBadge, TeamBadge } from "../components/Kiosk";
import { GoalOverlay, useGoalQueue } from "../kiosk/GoalOverlay";
import { OverturnedToast, useOverturned } from "../kiosk/Toast";
import { IdleScreen } from "../kiosk/kioskState";

const U = (n: number) => `calc(var(--u) * ${n})`;

/* ------------------------------------------------------------------ helpers */

function RecordPill({ record }: { record?: string | undefined }) {
  if (!record) return null;
  return (
    <span
      className="inline-flex items-center rounded-full bg-white/10 font-display font-semibold uppercase tracking-wider text-slate-300"
      style={{ padding: `${U(0.3)} ${U(1.2)}`, fontSize: U(1.5) }}
    >
      {record}
    </span>
  );
}

function GoalieHeadshot({
  goalie,
  team,
  size,
}: {
  goalie?: StartingGoalie | undefined;
  team: Team;
  size: number;
}) {
  const [bad, setBad] = useState(false);
  const initials = goalie
    ? `${goalie.first?.[0] ?? ""}${goalie.last?.[0] ?? goalie.name[0] ?? ""}`.toUpperCase()
    : team.abbr.slice(0, 2);

  return (
    <div
      className="relative shrink-0 overflow-hidden rounded-xl border border-white/20 bg-white/5 shadow-inner"
      style={{ width: U(size), height: U(size) }}
    >
      {goalie?.headshot && !bad ? (
        <img
          src={goalie.headshot}
          alt=""
          className="h-full w-full object-cover object-top"
          onError={() => setBad(true)}
        />
      ) : (
        <div
          className="flex h-full w-full items-center justify-center font-display font-black text-white/80"
          style={{
            fontSize: U(size * 0.4),
            background: "linear-gradient(180deg, rgba(255,255,255,0.18), rgba(255,255,255,0.04))",
          }}
        >
          {initials}
        </div>
      )}
      {goalie?.jersey && (
        <span
          className="num absolute bottom-0 right-0 rounded-tl-md bg-black/80 px-[0.7vmin] py-[0.1vmin] font-display font-black text-white"
          style={{ fontSize: U(1.3) }}
        >
          #{goalie.jersey}
        </span>
      )}
    </div>
  );
}

function GoalieCard({
  goalie,
  team,
  c,
  side,
}: {
  goalie?: StartingGoalie | undefined;
  team: Team;
  c: SideColors;
  side: "away" | "home";
}) {
  const isConfirmed = goalie?.confirmed === true;
  const statusLabel = isConfirmed ? "CONFIRMED" : "PROBABLE";
  const alignRight = side === "home";

  return (
    <div
      className={`relative flex flex-1 flex-col justify-between rounded-[2vmin] bg-black/60 border border-white/10 p-[1.6vmin] backdrop-blur-md overflow-hidden ${
        alignRight ? "border-r-[0.8vmin]" : "border-l-[0.8vmin]"
      }`}
      style={{
        borderColor: c.fill,
        gap: U(1.1),
      }}
    >
      {/* Background tint */}
      <div
        className="pointer-events-none absolute inset-0 opacity-15"
        style={{
          background: `radial-gradient(circle at ${alignRight ? "100% 0%" : "0% 0%"}, ${c.fill} 0%, transparent 70%)`,
        }}
      />

      {/* Header with Starter tag & Status badge - consistent left-to-right alignment */}
      <div className="relative flex items-center justify-between">
        <div className="flex items-center" style={{ gap: U(0.8) }}>
          <span className="font-display font-black uppercase tracking-[.18em] text-slate-400" style={{ fontSize: U(1.3) }}>
            {side === "away" ? "AWAY STARTER" : "HOME STARTER"}
          </span>
        </div>
        <span
          className={`inline-flex items-center rounded-full font-display font-black uppercase tracking-wider ${
            isConfirmed
              ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 shadow-[0_0_1vmin_rgba(16,185,129,0.3)]"
              : "bg-amber-500/20 text-amber-300 border border-amber-500/30 shadow-[0_0_1vmin_rgba(245,158,11,0.25)]"
          }`}
          style={{ padding: `${U(0.2)} ${U(1.1)}`, fontSize: U(1.2) }}
        >
          {statusLabel}
        </span>
      </div>

      {/* Goalie Bio */}
      {goalie ? (
        <div className={`relative flex items-center ${alignRight ? "flex-row-reverse text-right" : "flex-row"}`} style={{ gap: U(1.6) }}>
          <GoalieHeadshot goalie={goalie} team={team} size={7.5} />
          <div className="min-w-0 flex-1">
            {goalie.first && (
              <div className="font-display font-medium uppercase leading-tight text-slate-300" style={{ fontSize: U(1.4) }}>
                {goalie.first}
              </div>
            )}
            <div
              className="truncate font-display font-black uppercase leading-[0.95] text-white"
              style={{
                fontSize: U(3.0),
                textShadow: "0 .04em .2em rgba(0,0,0,.6)",
              }}
            >
              {goalie.last || goalie.name}
            </div>
            <div className="font-display font-semibold uppercase tracking-wider text-slate-400 mt-[0.3vmin]" style={{ fontSize: U(1.3) }}>
              {team.name} {goalie.jersey ? `· #${goalie.jersey}` : ""}
            </div>
          </div>
        </div>
      ) : (
        <div className="relative flex items-center justify-center py-[1.5vmin]" style={{ gap: U(1.5) }}>
          <GoalieHeadshot team={team} size={6.5} />
          <div className="flex flex-col">
            <span className="font-display font-bold uppercase tracking-wider text-slate-400" style={{ fontSize: U(1.6) }}>
              Starter Unannounced
            </span>
            <span className="font-display text-xs text-slate-500">Probable closer to puck drop</span>
          </div>
        </div>
      )}

      {/* Goalie Season Stats Grid */}
      <div className="relative grid grid-cols-3 rounded-[1.2vmin] bg-white/[0.04] p-[1vmin] border border-white/5" style={{ gap: U(0.8) }}>
        <div className="flex flex-col items-center justify-center">
          <span className="font-display text-[1vmin] font-bold uppercase tracking-wider text-slate-400">RECORD</span>
          <span className="num font-display font-black text-white" style={{ fontSize: U(1.9) }}>
            {goalie?.record || "—"}
          </span>
        </div>
        <div className="flex flex-col items-center justify-center border-x border-white/10">
          <span className="font-display text-[1vmin] font-bold uppercase tracking-wider text-slate-400">GAA</span>
          <span className="num font-display font-black text-white" style={{ fontSize: U(1.9) }}>
            {goalie?.gaa != null ? String(goalie.gaa) : "—"}
          </span>
        </div>
        <div className="flex flex-col items-center justify-center">
          <span className="font-display text-[1vmin] font-bold uppercase tracking-wider text-slate-400">SV%</span>
          <span className="num font-display font-black text-white" style={{ fontSize: U(1.9) }}>
            {goalie?.save_pct != null ? String(goalie.save_pct) : "—"}
          </span>
        </div>
      </div>
    </div>
  );
}

function TeamMatchupBlock({
  team,
  c,
  side,
}: {
  team: Team;
  c: SideColors;
  side: "away" | "home";
}) {
  const alignRight = side === "home";

  return (
    <div
      className={`flex flex-1 flex-col items-center justify-center ${alignRight ? "md:items-end" : "md:items-start"}`}
      style={{ gap: U(1.2), padding: `0 ${U(2)}` }}
    >
      <div className={`flex items-center ${alignRight ? "flex-row-reverse" : "flex-row"}`} style={{ gap: U(2) }}>
        <div className="relative shrink-0 inline-flex items-center justify-center">
          <TeamBadge team={team} size={U(11.5)} plain />
        </div>
        <div className={`flex flex-col min-w-0 ${alignRight ? "text-right items-end" : "text-left items-start"}`}>
          <span
            className="font-display font-black uppercase tracking-wider text-slate-400"
            style={{ fontSize: U(1.5) }}
          >
            {side === "away" ? "VISITOR" : "HOME"}
          </span>
          <div
            className="font-display font-black uppercase tracking-tight text-white leading-[0.95] max-w-[32vw] truncate"
            style={{
              fontSize: team.name.length > 11 ? U(3.0) : team.name.length > 8 ? U(3.4) : U(3.8),
              textShadow: "0 .04em .3em rgba(0,0,0,.7)",
            }}
          >
            {team.name}
          </div>
          <div className="flex items-center mt-[0.6vmin]" style={{ gap: U(1) }}>
            <span
              className="font-display font-bold uppercase tracking-widest text-slate-300"
              style={{ fontSize: U(1.7), color: c.fill }}
            >
              {team.abbr}
            </span>
            <RecordPill record={team.record} />
          </div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ selection */

export function pickMatchupGame(
  games: Game[],
  wantGame: string | null,
  wantTeam: string | null,
  sync: SyncState | null | undefined,
  now: number,
): Game | undefined {
  if (wantGame && wantGame !== "auto") {
    return games.find((g) => g.id === wantGame);
  }
  if (wantTeam && wantTeam !== "auto") {
    const t = wantTeam.toUpperCase();
    return games.find((g) => g.home.abbr.toUpperCase() === t || g.away.abbr.toUpperCase() === t);
  }

  // Auto mode: prioritize user's synced / favorite teams if any
  const mine = (g: Game) => {
    if (!sync) return false;
    const favs = sync.favorites ?? [];
    if (favs.some((f) => f.abbr.toUpperCase() === g.home.abbr.toUpperCase() || f.abbr.toUpperCase() === g.away.abbr.toUpperCase())) return true;
    return (sync.effective ?? sync.games).includes(g.id);
  };
  const pool = sync ? games.filter(mine) : games;
  const candidates = pool.length > 0 ? pool : games;

  // Rank:
  // 0: upcoming pregame (positive left ms)
  // 1: pregame any moment (left <= 0)
  // 2: in-progress game
  // 3: finished game
  const rank = (g: Game) => {
    if (g.status === "pre") {
      const left = startMs(g) - now;
      return left > 0 ? 0 : 1;
    }
    if (g.status === "in") return 2;
    return 3;
  };

  return [...candidates].sort((a, b) => {
    const ra = rank(a), rb = rank(b);
    if (ra !== rb) return ra - rb;
    return startMs(a) - startMs(b);
  })[0];
}

/* ------------------------------------------------------------------ landscape */

function MatchupLandscape({ game, now, scale }: { game: Game; now: number; scale: number }) {
  const { away, home } = resolveMatchup(game.away, game.home);
  const pre = game.status === "pre";
  const live = game.status === "in";
  const left = startMs(game) - now;
  const w = whenLabel(startMs(game), now);

  const oddsText = typeof game.odds === "object" && game.odds !== null && "details" in game.odds
    ? String((game.odds as { details?: unknown }).details ?? "")
    : "";

  return (
    <div
      className="relative flex h-full w-full items-center justify-center p-[2.8vmin] overflow-hidden bg-[#04060a] text-white"
      style={{ ["--u" as string]: `calc(var(--u0) * ${scale})` }}
    >
      {/* Background team glow */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background: `linear-gradient(135deg, ${away.fill} 0%, ${away.deep} 40%, transparent 75%)`,
          clipPath: "polygon(0 0, 48vmin 0, 0 48vmin)",
          opacity: 0.85,
        }}
      />
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background: `linear-gradient(225deg, ${home.fill} 0%, ${home.deep} 40%, transparent 75%)`,
          clipPath: "polygon(calc(100% - 48vmin) 0, 100% 0, 100% 48vmin)",
          opacity: 0.85,
        }}
      />
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background: "radial-gradient(85% 75% at 50% 50%, rgba(14,18,28,.6) 0%, rgba(4,6,10,.98) 100%)",
        }}
      />

      {/* Center divider line */}
      <div className="pointer-events-none absolute inset-y-0 left-1/2 w-[1px] bg-gradient-to-b from-transparent via-white/10 to-transparent -translate-x-1/2" />

      {/* Main Container Card */}
      <div className="relative flex flex-col justify-between w-full max-w-[96vw] h-[90vh] rounded-[2.6vmin] bg-black/85 border border-white/12 shadow-[0_0_8vmin_rgba(0,0,0,0.9)] backdrop-blur-2xl p-[3vmin] overflow-hidden">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-[1px] bg-gradient-to-r from-transparent via-white/30 to-transparent" />

        {/* Top Header: League, Countdown, When */}
        <header className="relative flex items-center justify-between border-b border-white/10 pb-[1.8vmin]">
          <div className="flex items-center" style={{ gap: U(1.2) }}>
            <span
              className="inline-flex items-center rounded-full bg-white/10 font-display font-black uppercase tracking-[.25em] text-white"
              style={{ padding: `${U(0.4)} ${U(1.6)}`, fontSize: U(1.6) }}
            >
              {game.league.toUpperCase()}
            </span>
            <span className="font-display font-bold uppercase tracking-widest text-slate-400" style={{ fontSize: U(1.5) }}>
              MATCHUP PREVIEW
            </span>
          </div>

          {/* Central Puck Drop Countdown Pill */}
          <div className="flex flex-col items-center">
            <div className="flex items-center" style={{ gap: U(1) }}>
              {live && (
                <span className="live-dot inline-block rounded-full bg-red-500" style={{ width: U(1.2), height: U(1.2) }} />
              )}
              <span className="font-display font-bold uppercase tracking-[.22em] text-amber-400" style={{ fontSize: U(1.5) }}>
                {pre ? "PUCK DROP COUNTDOWN" : live ? "IN PROGRESS" : statusText(game).toUpperCase()}
              </span>
            </div>
            <div
              className="num font-display font-black leading-none text-white tracking-tight"
              style={{
                fontSize: U(pre ? 5.5 : 4.5),
                textShadow: "0 .04em .3em rgba(0,0,0,.7)",
              }}
            >
              {pre ? (left > 0 ? countdown(left) : "ANY MOMENT") : live ? `${game.clock || "LIVE"} · ${game.period_label}` : "FINAL"}
            </div>
          </div>

          <div className="flex flex-col items-end">
            <span className="font-display font-semibold uppercase tracking-wider text-slate-300" style={{ fontSize: U(1.5) }}>
              {w.date}
            </span>
            <span className="font-display font-bold text-white/80" style={{ fontSize: U(1.4) }}>
              {w.time}
            </span>
          </div>
        </header>

        {/* Middle: Teams Face-Off */}
        <div className="relative flex flex-1 items-center justify-between my-[1.5vmin]" style={{ gap: U(2) }}>
          <TeamMatchupBlock team={game.away} c={away} side="away" />

          {/* VS Center Duel Ring */}
          <div className="flex flex-col items-center justify-center shrink-0" style={{ gap: U(0.8) }}>
            <div
              className="flex items-center justify-center rounded-full bg-ink-950 font-display font-black text-white shadow-[0_0_3vmin_rgba(255,255,255,0.25)] border-2 border-white/80"
              style={{ width: U(7.5), height: U(7.5), fontSize: U(3.2) }}
            >
              VS
            </div>
            {oddsText && (
              <span
                className="rounded-full bg-white/10 px-[1.2vmin] py-[0.3vmin] font-display font-bold uppercase tracking-wider text-slate-300 text-center"
                style={{ fontSize: U(1.2) }}
              >
                {oddsText}
              </span>
            )}
          </div>

          <TeamMatchupBlock team={game.home} c={home} side="home" />
        </div>

        {/* Bottom: In The Crease / Starting Goalies Duel */}
        <div className="relative flex flex-col border-t border-white/10 pt-[1.8vmin]" style={{ gap: U(1) }}>
          <div className="flex items-center justify-between">
            <div className="flex items-center" style={{ gap: U(1) }}>
              <span className="font-display font-black uppercase tracking-[.22em] text-white" style={{ fontSize: U(1.6) }}>
                IN THE CREASE
              </span>
              <span className="font-display font-semibold uppercase tracking-wider text-slate-400" style={{ fontSize: U(1.3) }}>
                STARTING GOALIES
              </span>
            </div>
            <span className="font-display font-medium uppercase tracking-widest text-slate-500 text-xs">
              CONFIRMED OR PROBABLE
            </span>
          </div>

          <div className="grid grid-cols-2" style={{ gap: U(2.5) }}>
            <GoalieCard goalie={game.goalies?.away} team={game.away} c={away} side="away" />
            <GoalieCard goalie={game.goalies?.home} team={game.home} c={home} side="home" />
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

function MatchupPortrait({ game, now, scale }: { game: Game; now: number; scale: number }) {
  const { away, home } = resolveMatchup(game.away, game.home);
  const pre = game.status === "pre";
  const live = game.status === "in";
  const left = startMs(game) - now;
  const w = whenLabel(startMs(game), now);

  const oddsText = typeof game.odds === "object" && game.odds !== null && "details" in game.odds
    ? String((game.odds as { details?: unknown }).details ?? "")
    : "";

  return (
    <div
      className="relative flex h-full w-full flex-col justify-between p-[2.5vmin] overflow-hidden bg-[#04060a] text-white"
      style={{ ["--u" as string]: `calc(var(--u0) * ${scale})` }}
    >
      {/* Background glow */}
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

      <div className="relative flex flex-col justify-between h-full rounded-[2.6vmin] bg-black/85 border border-white/12 shadow-[0_0_8vmin_rgba(0,0,0,0.9)] backdrop-blur-2xl p-[2.8vmin] overflow-y-auto">
        {/* Top Header */}
        <header className="flex items-center justify-between border-b border-white/10 pb-[1.6vmin]">
          <div className="flex items-center" style={{ gap: U(1) }}>
            <span
              className="inline-flex items-center rounded-full bg-white/10 font-display font-black uppercase tracking-[.25em] text-white"
              style={{ padding: `${U(0.3)} ${U(1.4)}`, fontSize: U(1.5) }}
            >
              {game.league.toUpperCase()}
            </span>
            <span className="font-display font-bold uppercase tracking-widest text-slate-400" style={{ fontSize: U(1.4) }}>
              MATCHUP
            </span>
          </div>
          <div className="text-right">
            <span className="font-display font-semibold uppercase tracking-wider text-slate-300" style={{ fontSize: U(1.4) }}>
              {w.date} · {w.time}
            </span>
          </div>
        </header>

        {/* Central Countdown Box */}
        <div className="flex flex-col items-center justify-center my-[1.5vmin] rounded-[2vmin] bg-white/[0.04] border border-white/10 p-[1.8vmin]" style={{ gap: U(0.5) }}>
          <div className="flex items-center" style={{ gap: U(1) }}>
            {live && <span className="live-dot inline-block rounded-full bg-red-500" style={{ width: U(1), height: U(1) }} />}
            <span className="font-display font-bold uppercase tracking-[.22em] text-amber-400" style={{ fontSize: U(1.4) }}>
              {pre ? "PUCK DROP COUNTDOWN" : live ? "IN PROGRESS" : statusText(game).toUpperCase()}
            </span>
          </div>
          <div
            className="num font-display font-black leading-none text-white tracking-tight"
            style={{
              fontSize: U(pre ? 7 : 5.5),
              textShadow: "0 .04em .3em rgba(0,0,0,.7)",
            }}
          >
            {pre ? (left > 0 ? countdown(left) : "ANY MOMENT") : live ? `${game.clock || "LIVE"} · ${game.period_label}` : "FINAL"}
          </div>
          {oddsText && (
            <span className="font-display font-semibold uppercase tracking-wider text-slate-400 text-center" style={{ fontSize: U(1.2) }}>
              {oddsText}
            </span>
          )}
        </div>

        {/* Teams Stack */}
        <div className="flex flex-col my-[1vmin]" style={{ gap: U(1.5) }}>
          {/* Away Team Card */}
          <div
            className="flex items-center justify-between rounded-[2vmin] bg-black/60 border border-white/10 p-[2vmin]"
            style={{ borderLeft: `${U(0.7)} solid ${away.fill}` }}
          >
            <div className="flex items-center" style={{ gap: U(1.6) }}>
              <TeamBadge team={game.away} size={U(10.5)} plain />
              <div className="flex flex-col">
                <span className="font-display font-bold uppercase tracking-wider text-slate-400" style={{ fontSize: U(1.3) }}>
                  VISITOR
                </span>
                <span className="font-display font-black uppercase text-white leading-tight truncate max-w-[50vw]" style={{ fontSize: U(2.8) }}>
                  {game.away.name}
                </span>
                <div className="flex items-center mt-[0.3vmin]" style={{ gap: U(0.8) }}>
                  <span className="font-display font-bold uppercase tracking-wider text-slate-300" style={{ fontSize: U(1.5) }}>
                    {game.away.abbr}
                  </span>
                  <RecordPill record={game.away.record} />
                </div>
              </div>
            </div>
          </div>

          <div className="flex items-center justify-center -my-[1vmin] z-10">
            <span className="flex items-center justify-center rounded-full bg-ink-950 font-display font-black text-white border-2 border-white/60" style={{ width: U(4.5), height: U(4.5), fontSize: U(2) }}>
              VS
            </span>
          </div>

          {/* Home Team Card */}
          <div
            className="flex items-center justify-between rounded-[2vmin] bg-black/60 border border-white/10 p-[2vmin]"
            style={{ borderLeft: `${U(0.7)} solid ${home.fill}` }}
          >
            <div className="flex items-center" style={{ gap: U(1.6) }}>
              <TeamBadge team={game.home} size={U(10.5)} plain />
              <div className="flex flex-col">
                <span className="font-display font-bold uppercase tracking-wider text-slate-400" style={{ fontSize: U(1.3) }}>
                  HOME
                </span>
                <span className="font-display font-black uppercase text-white leading-tight truncate max-w-[50vw]" style={{ fontSize: U(2.8) }}>
                  {game.home.name}
                </span>
                <div className="flex items-center mt-[0.3vmin]" style={{ gap: U(0.8) }}>
                  <span className="font-display font-bold uppercase tracking-wider text-slate-300" style={{ fontSize: U(1.5) }}>
                    {game.home.abbr}
                  </span>
                  <RecordPill record={game.home.record} />
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Goalie Duel Section */}
        <div className="flex flex-col border-t border-white/10 pt-[1.8vmin] mt-[1vmin]" style={{ gap: U(1) }}>
          <div className="flex items-center justify-between">
            <span className="font-display font-black uppercase tracking-[.2em] text-white" style={{ fontSize: U(1.6) }}>
              IN THE CREASE
            </span>
            <span className="font-display font-bold uppercase tracking-wider text-slate-400 text-xs">
              STARTING GOALIES
            </span>
          </div>

          <div className="flex flex-col" style={{ gap: U(1.4) }}>
            <GoalieCard goalie={game.goalies?.away} team={game.away} c={away} side="away" />
            <GoalieCard goalie={game.goalies?.home} team={game.home} c={home} side="home" />
          </div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ main view */

export default function Matchup() {
  useKiosk();
  const wantGame = useQueryParam("game");
  const wantTeam = useQueryParam("team");
  const { games, conn } = useLive("matchup", wantGame ?? "auto");
  const now = useNow(1000);
  const orientation = useOrientation();
  const sync = useSync(60_000);
  const nextMine = useNextMine(sync, !wantGame || wantGame === "auto");

  const all = [...games.values()];
  const game = pickMatchupGame(all, wantGame, wantTeam, sync, now);

  const match = (id: string) => {
    if (wantGame && wantGame !== "auto") return id === wantGame;
    if (wantTeam && wantTeam !== "auto") {
      const g = games.get(id);
      return !!g && (g.home.abbr.toUpperCase() === wantTeam.toUpperCase() || g.away.abbr.toUpperCase() === wantTeam.toUpperCase());
    }
    return !sync || (sync.effective ?? sync.games).includes(id);
  };

  const goal = useGoalQueue((e) => match(e.game.id));
  const overturned = useOverturned((e) => match(e.game.id));

  if (!game) {
    const livePre = (sync ? all.filter((g) => g.status === "pre" && isMine(g, sync)) : all.filter((g) => g.status === "pre")).sort(
      (a, b) => startMs(a) - startMs(b),
    )[0];
    const next = (!wantGame || wantGame === "auto")
      ? [livePre, nextMine].filter((g): g is GameLite => !!g).sort((a, b) => startMs(a) - startMs(b))[0]
      : livePre;

    return (
      <div className="kiosk fixed inset-0">
        <IdleScreen next={next} now={now} loading={(!wantGame || wantGame === "auto") && !sync} />
        <GoalOverlay event={goal.current} pending={goal.pending} />
        <ConnDot conn={conn} />
      </div>
    );
  }

  const scale = orientation === "portrait" ? 1.05 : 1.0;

  return (
    <div className="kiosk fixed inset-0 bg-[#04060a]">
      {orientation === "portrait" ? (
        <MatchupPortrait game={game} now={now} scale={scale} />
      ) : (
        <MatchupLandscape game={game} now={now} scale={scale} />
      )}
      <GoalOverlay event={goal.current} pending={goal.pending} />
      <OverturnedToast event={overturned} />
      <ConnDot conn={conn} />
      <SimBadge active={all.some((g) => g.id === "nhl:sim")} />
    </div>
  );
}
