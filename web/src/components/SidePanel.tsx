import type { FormGame, Game, Team, TeamForm } from "../types";
import { TeamBadge } from "./Kiosk";
import { SplitBars, rowsFor } from "./StatBars";

const U = (n: number) => `calc(var(--u) * ${n})`;

const RES: Record<FormGame["result"], { bg: string; fg: string }> = {
  W: { bg: "#15803d", fg: "#fff" },
  L: { bg: "#b91c1c", fg: "#fff" },
  OTL: { bg: "#b45309", fg: "#fff" },
  T: { bg: "#475569", fg: "#fff" },
};

function Chip({ g, size }: { g: FormGame; size: number }) {
  const c = RES[g.result];
  return (
    <span
      className="relative inline-flex min-w-0 flex-1 items-center justify-center overflow-hidden rounded-[.3em] font-display font-black"
      style={{ background: c.bg, color: c.fg, height: U(size), fontSize: U(size * .42), boxShadow: "inset 0 0 0 1px rgba(255,255,255,.25)" }}
      title={`${g.result} ${g.gf}-${g.ga} ${g.venue === "A" ? "@" : "vs"} ${g.opp_abbr}`}
    >
      {g.opp_logo ? (
        <img src={g.opp_logo} alt="" className="absolute left-[.25em] h-[72%] w-[48%] object-contain" />
      ) : (
        <span className="absolute left-[.3em] opacity-80" style={{ fontSize: "62%" }}>{g.opp_abbr.slice(0, 3)}</span>
      )}
      <span className="absolute right-[.3em]">{g.result === "OTL" ? "OT" : g.result}</span>
    </span>
  );
}

/** "Last 10 Games" W/L chips with opponent logos. Renders nothing without data. */
function LastTen({ team, form, size = 2.8 }: { team: Team; form?: TeamForm | undefined; size?: number | undefined }) {
  const games = form?.games?.slice(-10) ?? [];
  if (!games.length) return null;
  return (
    <div>
      <div className="flex items-center justify-between" style={{ gap: U(1), marginBottom: U(.5) }}>
        <div className="flex items-center" style={{ gap: U(.8) }}>
          <TeamBadge team={team} size={U(2.6)} plain />
          <span className="font-display font-bold uppercase tracking-[.12em] text-white/85" style={{ fontSize: U(1.5) }}>{team.abbr} · Last {games.length} games</span>
        </div>
        {form?.record && <span className="num font-display font-bold text-white/70" style={{ fontSize: U(1.5) }}>{form.record}</span>}
      </div>
      <div className="flex" style={{ gap: U(.4) }}>
        {games.map((g, i) => <Chip key={i} g={g} size={size} />)}
      </div>
    </div>
  );
}

/** Right-hand scoreboard panel: stat bars (or form averages pre-game) + Last 10 chips. */
export function SidePanel({ game, maxRows = 7, size = 1 }: { game: Game; maxRows?: number | undefined; size?: number | undefined }) {
  const form = game.insight?.form;
  let rows = rowsFor(game, maxRows);
  let heading = "Game stats";
  if (!rows.length && form?.rows?.length) { rows = rowsFor({ stat_rows: form.rows, stats: game.stats }, maxRows); heading = "Recent form · per game"; }
  const hasLast = !!(form?.away?.games?.length || form?.home?.games?.length);
  if (!rows.length && !hasLast) return null;
  return (
    <aside className="flex min-h-0 flex-col justify-center bg-ink-900/90 text-white" style={{ padding: `${U(1.4)} ${U(2.2)}`, gap: U(1.6) }}>
      {rows.length > 0 && (
        <section>
          <div className="flex items-center justify-between" style={{ marginBottom: U(1.2) }}>
            <span className="flex items-center" style={{ gap: U(.8) }}><TeamBadge team={game.away} size={U(3)} plain /><b className="font-display" style={{ fontSize: U(2) }}>{game.away.abbr}</b></span>
            <span className="font-display font-bold uppercase tracking-[.18em] text-white/50" style={{ fontSize: U(1.2) }}>{heading}</span>
            <span className="flex items-center" style={{ gap: U(.8) }}><b className="font-display" style={{ fontSize: U(2) }}>{game.home.abbr}</b><TeamBadge team={game.home} size={U(3)} plain /></span>
          </div>
          <SplitBars game={game} rows={rows} size={size} />
        </section>
      )}
      {hasLast && (
        <section className="flex flex-col" style={{ gap: U(1.2) }}>
          <LastTen team={game.away} form={form?.away} size={2.8 * Math.max(.85, size)} />
          <LastTen team={game.home} form={form?.home} size={2.8 * Math.max(.85, size)} />
        </section>
      )}
    </aside>
  );
}
