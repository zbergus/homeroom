import type { Game, Team } from "../types";
import { resolveMatchup, type SideColors } from "../lib/colors";
import { useGameClock } from "../lib/clock";
import { countdown, shortPeriod, startMs, whenLabel } from "../lib/format";
import { TeamBadge } from "./Kiosk";

/**
 * Two stacked team-colour bars (logo, name, score) + big status text. Sized entirely in `em`:
 * the parent sets `font-size`. Used by the LED ticker and the scoreboard UPCOMING strip (compact).
 *   compact  : abbreviations, narrower bars, smaller status
 *   flashAbbr: abbreviation of a team whose bar should flash (goal)
 */
function statusLines(g: Game, clockText: string, now: number): [string, string?] {
  if (g.status === "post") {
    const pLabel = (g.period_label ?? "").toLowerCase();
    if (pLabel.includes("so") || pLabel.includes("shootout") || g.period === 5) return ["FINAL/SO"];
    if (g.period > 3 || pLabel.includes("ot") || pLabel.includes("overtime")) return ["FINAL/OT"];
    return ["FINAL"];
  }
  if (g.status === "pre") {
    const ms = startMs(g);
    const left = ms - now;
    if (left > 0 && left < 3600_000) return ["STARTS IN", countdown(left).slice(3)];
    const w = whenLabel(ms, now);
    return [w.date.toUpperCase(), w.time];
  }
  if (g.intermission) return ["END", shortPeriod(g.period_label).toUpperCase() || "PERIOD"];
  const label = shortPeriod(g.period_label ?? "").toUpperCase();
  if (!clockText) return [label];
  return label.toLowerCase().includes(clockText.toLowerCase()) ? [label] : [label, clockText];
}

function Bar({ team, colors, compact, flash, score, pp }: { team: Team; colors: SideColors; compact: boolean; flash: boolean; score: boolean; pp?: boolean | undefined }) {
  return (
    <div
      className={`relative flex items-center font-display font-black uppercase ${flash ? "bar-flash" : ""}`}
      style={{
        height: compact ? "1.55em" : "1.7em",
        padding: "0 .75em 0 .3em",
        gap: ".35em",
        color: colors.text,
        background: `linear-gradient(180deg, ${colors.fill}, ${colors.deep})`,
        clipPath: "polygon(0 0, 100% 0, calc(100% - .55em) 100%, 0 100%)",
        lineHeight: 1,
      }}
    >
      <TeamBadge team={team} size={compact ? "1.15em" : "1.3em"} plain ring="rgba(255,255,255,.25)" />
      <span className="min-w-0 flex-1 truncate tracking-wide" style={{ fontSize: compact ? ".9em" : "1em" }}>{compact ? team.abbr : team.name}</span>
      {pp && (
        <span
          className="shrink-0 rounded bg-amber-400 px-1 font-sans text-[0.6em] font-black text-black tracking-normal shadow-[0_0_0.6em_rgba(251,191,36,0.9)]"
          title="Power Play"
        >
          PP
        </span>
      )}
      {score && <span className="num" style={{ fontSize: compact ? "1.05em" : "1.15em" }}>{team.score ?? 0}</span>}
    </div>
  );
}

export function GameBars({ game, now, compact = false, flashAbbr }: { game: Game; now: number; compact?: boolean | undefined; flashAbbr?: string | undefined }) {
  const { away, home } = resolveMatchup(game.away, game.home);
  const clock = useGameClock(game.status === "in" && !game.intermission ? game : undefined, 250);
  const [a, b] = statusLines(game, clock.text || game.clock, now);
  const showScore = game.status !== "pre";
  const awayPp = game.status === "in" && game.situation?.advantage === "away";
  const homePp = game.status === "in" && game.situation?.advantage === "home";
  return (
    <div className="inline-flex items-center" style={{ gap: compact ? ".5em" : ".6em" }}>
      <div className="flex shrink-0 flex-col" style={{ gap: ".1em", width: compact ? "6em" : "10em" }}>
        <Bar team={game.away} colors={away} compact={compact} score={showScore} flash={!!flashAbbr && flashAbbr === game.away.abbr} pp={awayPp} />
        <Bar team={game.home} colors={home} compact={compact} score={showScore} flash={!!flashAbbr && flashAbbr === game.home.abbr} pp={homePp} />
      </div>
      <div className="num flex shrink-0 flex-col justify-center font-display font-black uppercase leading-[1.05] text-white" style={{ fontSize: compact ? ".8em" : "1em", minWidth: compact ? "3.9em" : "4.8em" }}>
        <span style={{ opacity: b ? 0.85 : 1, fontSize: b ? ".8em" : "1.15em" }}>{a}</span>
        {b && <span style={{ fontSize: "1.1em" }}>{b}</span>}
      </div>
    </div>
  );
}
