import { useRef } from "react";
import type { Game, GameLite, Team } from "../types";
import { useLive } from "../lib/live";
import { isMine, useNextMine, useSync } from "../lib/mine";
import { useKiosk, useNow, useOrientation, useQueryParam } from "../lib/hooks";
import { countdown, shortPeriod, startMs, whenLabel } from "../lib/format";
import { resolveMatchup, type SideColors } from "../lib/colors";
import { useGameClock } from "../lib/clock";
import { ConnDot, TeamBadge } from "../components/Kiosk";
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

function BaseBases({ bs, u }: { bs: NonNullable<Game["baseball_situation"]>; u: (n: number) => string }) {
  const baseBox = (on: boolean) =>
    `rotate-45 border transition-all ${
      on
        ? "bg-amber-400 border-amber-200 shadow-[0_0_0.6vmin_rgba(251,191,36,0.9)]"
        : "bg-white/10 border-white/20"
    }`;
  return (
    <div className="flex items-center shrink-0" style={{ gap: u(1.4) }}>
      <div className="relative inline-flex items-center justify-center shrink-0" style={{ width: u(2.8), height: u(2.6) }}>
        {/* 2nd Base */}
        <div
          className={`absolute top-0 rounded-[0.1vmin] ${baseBox(bs.on_second)}`}
          style={{ width: u(0.8), height: u(0.8) }}
        />
        {/* 3rd Base */}
        <div
          className={`absolute bottom-0 left-0 rounded-[0.1vmin] ${baseBox(bs.on_third)}`}
          style={{ width: u(0.8), height: u(0.8) }}
        />
        {/* 1st Base */}
        <div
          className={`absolute bottom-0 right-0 rounded-[0.1vmin] ${baseBox(bs.on_first)}`}
          style={{ width: u(0.8), height: u(0.8) }}
        />
      </div>
      <div className="flex items-center font-display font-bold uppercase tracking-wider text-amber-300" style={{ gap: u(0.7), fontSize: u(1.7) }}>
        <span>{bs.balls}-{bs.strikes}</span>
        <span className="opacity-40 font-normal">·</span>
        <span>{bs.outs} {bs.outs === 1 ? "OUT" : "OUTS"}</span>
      </div>
    </div>
  );
}

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

function TeamUnit({ team, pre }: { team: Team; pre: boolean }) {
  return (
    <div className="flex flex-col items-center justify-center shrink-0" style={{ gap: U(0.7), minWidth: U(16) }}>
      <TeamBadge team={team} size={U(pre ? 15 : 12.5)} plain />
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
    (r) => r.key === "SOG" || r.key === "S" || r.label?.toLowerCase() === "shots",
  );
  const sog = sogRow ? { away: sogRow.away, home: sogRow.home } : undefined;
  const fb = game.football_situation;

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
        <span className="opacity-75 font-black">{game.league}</span>
        <span>
          {pre
            ? "Upcoming"
            : post
            ? "Final"
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
          ? "FINAL"
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
        ) : game.sport === "hockey" && sog ? (
          <div
            className="flex items-center font-display uppercase tracking-widest text-slate-300"
            style={{ gap: U(1.4), fontSize: U(1.7) }}
          >
            <span className="font-black text-white">{sog.away}</span>
            <span className="opacity-60 text-xs font-bold tracking-wider">SOG</span>
            <span className="font-black text-white">{sog.home}</span>
          </div>
        ) : fb?.down_distance_text ? (
          <div
            className="flex items-center font-display font-bold uppercase tracking-wider text-amber-300"
            style={{ fontSize: U(1.7) }}
          >
            <span>{fb.down_distance_text}</span>
            {fb.yard_line ? (
              <span className="opacity-75">
                {" "}
                · {fb.possession ? `${fb.possession} ` : ""}
                {fb.yard_line}
              </span>
            ) : null}
          </div>
        ) : game.sport === "baseball" && game.baseball_situation ? (
          <BaseBases bs={game.baseball_situation} u={U} />
        ) : post ? (
          <div
            className="font-display font-semibold uppercase tracking-[.18em] opacity-80 text-slate-400"
            style={{ fontSize: U(1.6) }}
          >
            {game.period > 3 && game.sport === "hockey"
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
        {/* Subtle top edge highlight */}
        <div className="pointer-events-none absolute inset-x-0 top-0 h-[1px] bg-gradient-to-r from-transparent via-white/25 to-transparent" />

        {/* 3-column scoreboard body */}
        <div className="relative flex flex-1 items-center justify-between" style={{ gap: U(2) }}>
          {/* Away Side */}
          <div className="flex flex-1 items-center justify-between min-w-0" style={{ padding: `0 ${U(2.5)}` }}>
            <TeamUnit team={game.away} pre={pre} />
            {!pre && <ScoreNum value={game.away.score ?? 0} />}
          </div>

          {/* Center Clock Pod */}
          <ClockPodLandscape game={game} now={now} />

          {/* Home Side */}
          <div className="flex flex-1 items-center justify-between min-w-0" style={{ padding: `0 ${U(2.5)}` }}>
            {!pre && <ScoreNum value={game.home.score ?? 0} />}
            <TeamUnit team={game.home} pre={pre} />
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
}: {
  team: Team;
  c: SideColors;
  pre: boolean;
}) {
  return (
    <div
      className="flex items-center justify-between rounded-[2vmin] bg-black/60 border border-white/10 p-[2.4vmin]"
      style={{
        borderLeft: `${U(0.7)} solid ${c.fill}`,
      }}
    >
      <div className="flex items-center min-w-0" style={{ gap: U(2) }}>
        <TeamBadge team={team} size={U(11.5)} plain />
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
    (r) => r.key === "SOG" || r.key === "S" || r.label?.toLowerCase() === "shots",
  );
  const sog = sogRow ? { away: sogRow.away, home: sogRow.home } : undefined;
  const fb = game.football_situation;

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
        <TeamRowPortrait team={game.away} c={away} pre={pre} />

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
            <span className="opacity-75 font-black">{game.league}</span>
            <span>
              {pre
                ? "Upcoming"
                : post
                ? "Final"
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
              ? "FINAL"
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
            ) : game.sport === "hockey" && sog ? (
              <div
                className="flex items-center font-display uppercase tracking-widest text-slate-300"
                style={{ gap: U(1.4), fontSize: U(1.8) }}
              >
                <span className="font-black text-white">{sog.away}</span>
                <span className="opacity-60 text-xs font-bold tracking-wider">SOG</span>
                <span className="font-black text-white">{sog.home}</span>
              </div>
            ) : fb?.down_distance_text ? (
              <div
                className="flex items-center font-display font-bold uppercase tracking-wider text-amber-300"
                style={{ fontSize: U(1.8) }}
              >
                <span>{fb.down_distance_text}</span>
                {fb.yard_line ? (
                  <span className="opacity-75">
                    {" "}
                    · {fb.possession ? `${fb.possession} ` : ""}
                    {fb.yard_line}
                  </span>
                ) : null}
              </div>
            ) : game.sport === "baseball" && game.baseball_situation ? (
              <BaseBases bs={game.baseball_situation} u={U} />
            ) : post ? (
              <div
                className="font-display font-semibold uppercase tracking-[.18em] opacity-80 text-slate-400"
                style={{ fontSize: U(1.8) }}
              >
                {game.period > 3 && game.sport === "hockey"
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

        <TeamRowPortrait team={game.home} c={home} pre={pre} />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ main view */

export default function Plate() {
  useKiosk();
  const want = useQueryParam("game") ?? "auto";
  const scaleParam = useQueryParam("scale");
  const { games, conn } = useLive("scoreboard", want);
  const now = useNow(1000);
  const finalSeen = useRef(new Map<string, number>());
  const o = useOrientation();
  const portrait = o === "portrait";

  const sync = useSync(60_000);
  const nextMine = useNextMine(sync, want === "auto");

  const all = [...games.values()];
  for (const g of all) {
    if (g.status === "post" && !finalSeen.current.has(g.id)) {
      finalSeen.current.set(g.id, Date.now());
    }
  }

  const game = pick(all, want, sync, finalSeen.current, now);
  const finalExpired =
    !!game &&
    game.status === "post" &&
    now - (finalSeen.current.get(game.id) ?? now) >= FINAL_MS;

  const match = (id: string) =>
    want === "auto" ? !sync || (sync.effective ?? sync.games).includes(id) : id === want;
  const goal = useGoalQueue((e) => match(e.game.id));
  const overturned = useOverturned((e) => match(e.game.id));

  let body: React.ReactNode;
  if (
    !game ||
    finalExpired ||
    (game.status === "pre" && want === "auto" && startMs(game) - now > PRE_WINDOW_MS)
  ) {
    const livePre = (
      want === "auto"
        ? all.filter((g) => g.status === "pre" && sync && isMine(g, sync))
        : all.filter((g) => g.status === "pre")
    ).sort((a, b) => startMs(a) - startMs(b))[0];
    const next =
      want === "auto"
        ? [livePre, nextMine].filter((g): g is GameLite => !!g).sort((a, b) => startMs(a) - startMs(b))[0]
        : livePre;
    body = <IdleScreen next={next} now={now} loading={want === "auto" && !sync} />;
  } else {
    const parsedScale = scaleParam ? parseFloat(scaleParam) : undefined;
    const scale = Number.isFinite(parsedScale) && parsedScale! > 0 ? parsedScale! : portrait ? 1.35 : 1;
    body = portrait ? (
      <PlatePortrait key="plate-p" game={game} now={now} scale={scale} />
    ) : (
      <PlateLandscape key="plate-l" game={game} now={now} scale={scale} />
    );
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
