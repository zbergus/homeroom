import { useState } from "react";
import type { FormGame, Game, PlayerWatch, ScoringPlay, Team, TeamForm } from "../types";
import { resolveMatchup, type SideColors } from "../lib/colors";
import { intermissionTitle, ordinal } from "../lib/format";
import { useOrientation } from "../lib/hooks";
import { TeamBadge } from "../components/Kiosk";
import { MirrorBars, rowsFor } from "../components/StatBars";

/* Four TV break screens. All sizes are multiples of --u (1u = 1% of the short-edge-derived width). */
const U = (n: number) => `calc(var(--u) * ${n})`;
const D = "font-display";

export const hasPlayers = (g: Game) => !!(g.insight?.players?.home || g.insight?.players?.away);
export const hasForm = (g: Game) => !!(g.insight?.form && (g.insight.form.rows?.length || g.insight.form.home?.games?.length || g.insight.form.away?.games?.length));

export const panelBg = (c: SideColors) => `linear-gradient(165deg, ${c.fill} 0%, ${c.deep} 100%)`;

/** Portrait gets a 1.7x unit so the same layouts (designed on a ~59u x 104u canvas) fill the tall screen. */
const PORTRAIT_SCALE = 1.7;
export function Shell({ children }: { children: React.ReactNode }) {
  const o = useOrientation();
  return (
    <div className="fade-in absolute inset-0 flex flex-col overflow-hidden text-white" style={{ background: "#07090f", ["--u" as string]: `calc(var(--u0) * ${o === "portrait" ? PORTRAIT_SCALE : 1})` }}>
      {children}
    </div>
  );
}

export function Watermark({ text, right }: { text: string; right?: boolean | undefined }) {
  return (
    <span aria-hidden className={`${D} pointer-events-none absolute select-none font-black leading-none`} style={{ fontSize: U(34), opacity: .07, bottom: U(-4), [right ? "right" : "left"]: U(-2) }}>{text}</span>
  );
}

/* ------------------------------------------------------------------ Players to watch */

export function Headshot({ p, team, size }: { p: PlayerWatch; team: Team; size: number }) {
  const [bad, setBad] = useState(false);
  const init = `${p.first?.[0] ?? ""}${p.last?.[0] ?? ""}`.toUpperCase() || team.abbr.slice(0, 2);
  return (
    <div className="shrink-0 overflow-hidden" style={{ width: U(size), height: U(size), borderRadius: U(size * .12), border: `${U(.18)} solid rgba(255,255,255,.9)`, background: "rgba(255,255,255,.14)" }}>
      {p.headshot && !bad ? (
        <img src={p.headshot} alt="" className="h-full w-full object-cover object-top" onError={() => setBad(true)} />
      ) : (
        <div className={`${D} flex h-full w-full items-center justify-center font-black`} style={{ fontSize: U(size * .38), background: "linear-gradient(180deg, rgba(255,255,255,.25), rgba(255,255,255,.05))" }}>{init}</div>
      )}
    </div>
  );
}

export function PlayerHalf({ team, c, p, right }: { team: Team; c: SideColors; p?: PlayerWatch | undefined; right: boolean }) {
  const K = U;
  const k = 1;
  const maxV = Math.max(1, ...(p?.log ?? []).map((l) => l.value));
  const lastFont = p ? 6.4 * Math.min(1, 9 / Math.max(9, p.last.length)) : 0;
  return (
    <section className="relative flex min-h-0 min-w-0 flex-col justify-center overflow-hidden" style={{ background: panelBg(c), color: c.text, padding: `${K(2)} ${K(2.6)}`, gap: K(2.2) }}>
      <div className="pointer-events-none absolute inset-0" style={{ background: "linear-gradient(180deg, transparent 40%, rgba(0,0,0,.35))" }} />
      <Watermark text={team.abbr} right={right} />
      {p ? (
        <>
          <div className={`relative flex items-center ${right ? "flex-row-reverse text-right" : ""}`} style={{ gap: K(2.4) }}>
            <Headshot p={p} team={team} size={10 * k} />
            <div className="min-w-0">
              <div className={`${D} font-semibold uppercase tracking-[.16em]`} style={{ fontSize: K(1.5), opacity: .85 }}>
                {[p.team_abbr, p.jersey ? `#${p.jersey}` : "", p.position].filter(Boolean).join(" · ")}
              </div>
              <div className={`${D} font-medium uppercase leading-none`} style={{ fontSize: K(3), marginTop: K(.5) }}>{p.first}</div>
              <div className={`${D} truncate font-black uppercase leading-[.95]`} style={{ fontSize: K(lastFont) }}>{p.last}</div>
            </div>
          </div>
          {p.tiles.length > 0 && (
            <div className="relative grid" style={{ gridTemplateColumns: `repeat(${Math.min(4, p.tiles.length)}, minmax(0,1fr))`, gap: K(1) }}>
              {p.tiles.slice(0, 4).map((t) => (
                <div key={t.label} className={`${right ? "text-right" : ""}`} style={{ background: "rgba(255,255,255,.14)", borderRadius: K(1), padding: `${K(1.1)} ${K(1.4)}` }}>
                  <div className={`${D} num font-black leading-none`} style={{ fontSize: K(4.4) }}>{t.value}</div>
                  <div className={`${D} font-semibold uppercase tracking-[.16em]`} style={{ fontSize: K(1.2), opacity: .8, marginTop: K(.4) }}>{t.label}</div>
                </div>
              ))}
            </div>
          )}
          {p.log.length > 0 && (
            <div className="relative">
              <div className={`${D} font-semibold uppercase tracking-[.18em] ${right ? "text-right" : ""}`} style={{ fontSize: K(1.3), opacity: .85, marginBottom: K(.8) }}>{p.log_label}</div>
              <div className="flex items-end" style={{ gap: K(1.2), height: K(12) }}>
                {p.log.map((l, i) => (
                  <div key={i} className="flex min-w-0 flex-1 flex-col items-center justify-end" style={{ height: "100%" }}>
                    <span className={`${D} num font-black leading-none`} style={{ fontSize: K(2.3), marginBottom: K(.5) }}>{l.value}</span>
                    <div className="w-full" style={{ height: `${Math.max(3, (l.value / maxV) * 78)}%`, minHeight: K(.35), background: c.textIsDark ? "rgba(10,13,20,.9)" : "#fff", borderRadius: `${K(.5)} ${K(.5)} 0 0`, opacity: l.value > 0 ? 1 : .35 }} />
                  </div>
                ))}
              </div>
              <div className="flex" style={{ gap: K(1.2), marginTop: K(.7) }}>
                {p.log.map((l, i) => <span key={i} className={`${D} min-w-0 flex-1 truncate text-center font-semibold uppercase tracking-wider`} style={{ fontSize: K(1.2), opacity: .85 }}>{l.opp_abbr}</span>)}
              </div>
            </div>
          )}
        </>
      ) : (
        <div className="relative flex flex-col items-center" style={{ gap: K(1.5) }}>
          <TeamBadge team={team} size={K(10)} plain />
          <span className={`${D} font-bold uppercase tracking-widest opacity-70`} style={{ fontSize: K(2) }}>No player data</span>
        </div>
      )}
    </section>
  );
}

export function PlayersScreen({ game }: { game: Game }) {
  const { away, home } = resolveMatchup(game.away, game.home);
  const pl = game.insight?.players;
  const n = Math.max(pl?.away?.log.length ?? 0, pl?.home?.log.length ?? 0);
  const sub = n ? `Last ${n} games` : "";
  return (
    <Shell>
      <header className="relative flex items-center justify-between" style={{ padding: `${U(1.2)} ${U(2.4)}` }}>
        <TeamBadge team={game.away} size={U(3.6)} />
        <div className="text-center">
          <div className={`${D} font-black uppercase leading-none tracking-wide`} style={{ fontSize: U(3.9) }}>Players to watch</div>
          {sub && <div className={`${D} font-semibold uppercase tracking-[.3em] text-white/55`} style={{ fontSize: U(1.5), marginTop: U(.4) }}>{sub}</div>}
        </div>
        <TeamBadge team={game.home} size={U(3.6)} />
      </header>
      <div className="relative grid min-h-0 flex-1 landscape:grid-cols-2 portrait:grid-rows-2" style={{ gap: U(.3) }}>
        <PlayerHalf team={game.away} c={away} p={pl?.away} right={false} />
        <PlayerHalf team={game.home} c={home} p={pl?.home} right />
        <div className={`${D} absolute left-1/2 top-1/2 z-10 flex -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-ink-950 font-black`} style={{ width: U(4.8), height: U(4.8), fontSize: U(2), boxShadow: "0 0 0 .3vmin #fff" }}>VS</div>
      </div>
    </Shell>
  );
}

/* ------------------------------------------------------------------ Recent form */

const recordOf = (games: FormGame[]) => {
  const n = (r: string) => games.filter((g) => g.result === r).length;
  return [n("W"), n("L"), n("OTL")].join("-");
};

function FormPanel({ team, c, form, scale, row }: { team: Team; c: SideColors; form?: TeamForm | undefined; scale: number; row: boolean }) {
  const last5 = (form?.games ?? []).slice(-5);
  const K = (n: number) => U(n * scale);
  const max = Math.max(1, ...last5.flatMap((g) => [g.gf, g.ga]));
  const chips = (
    <div>
      {last5.length > 0 && (
        <>
          <div className={`${D} font-semibold uppercase tracking-[.14em]`} style={{ fontSize: K(1.4), opacity: .85, marginBottom: K(.8) }}>Last {last5.length} · {recordOf(last5)}</div>
          <div className="flex" style={{ gap: K(.6) }}>
            {last5.map((g, i) => (
              <span key={i} className={`${D} inline-flex items-center justify-center font-black`}
                style={{ width: K(3.6), height: K(3.6), borderRadius: K(.7), fontSize: g.result === "OTL" ? K(1.4) : K(2), background: g.result === "W" ? "#fff" : "rgba(255,255,255,.18)", color: g.result === "W" ? "#0a0d14" : "#fff" }}>{g.result}</span>
            ))}
          </div>
        </>
      )}
    </div>
  );
  const bars = last5.length > 0 && (
    <div className="min-w-0">
      <div className={`${D} font-semibold uppercase tracking-[.18em]`} style={{ fontSize: K(1.3), opacity: .8, marginBottom: K(.8) }}>Goals for / against</div>
      <div className="flex items-end justify-between" style={{ height: K(row ? 12 : 15), gap: K(1) }}>
        {last5.map((g, i) => (
          <div key={i} className="flex h-full flex-1 items-end justify-center" style={{ gap: K(.4) }}>
            <div style={{ width: K(1.6), height: `${Math.max(2, (g.gf / max) * 100)}%`, background: "#fff", borderRadius: K(.3) }} />
            <div style={{ width: K(1.6), height: `${Math.max(2, (g.ga / max) * 100)}%`, background: "rgba(255,255,255,.4)", borderRadius: K(.3) }} />
          </div>
        ))}
      </div>
      <div className="flex justify-between" style={{ marginTop: K(.6), gap: K(1) }}>
        {last5.map((g, i) => <span key={i} className={`${D} flex-1 truncate text-center font-semibold uppercase tracking-tight`} style={{ fontSize: K(0.95), opacity: .85 }}>{g.venue === "A" ? "@" : ""}{g.opp_abbr}</span>)}
      </div>
    </div>
  );
  return (
    <section className="relative flex min-h-0 min-w-0 overflow-hidden" style={{ background: panelBg(c), color: c.text, padding: K(2.6), gap: K(2), flexDirection: row ? "row" : "column", alignItems: row ? "center" : undefined, justifyContent: "space-between" }}>
      <Watermark text={team.abbr} />
      <div className="relative flex flex-col" style={{ gap: K(1.6), flex: row ? "0 0 38%" : undefined }}>
        <div className="flex items-center" style={{ gap: K(2) }}>
          <TeamBadge team={team} size={K(row ? 8 : 9.5)} ring="rgba(255,255,255,.22)" />
          {row && <div className={`${D} min-w-0 font-black uppercase leading-[.95]`} style={{ fontSize: K(3) }}>{team.name}</div>}
        </div>
        {!row && <div className={`${D} font-black uppercase leading-[.95]`} style={{ fontSize: K(4.2) }}>{team.name}</div>}
        {chips}
      </div>
      {bars && <div className="relative" style={{ flex: row ? "1 1 0" : undefined, minWidth: 0 }}>{bars}</div>}
    </section>
  );
}

export function FormScreen({ game }: { game: Game }) {
  const o = useOrientation();
  const { away, home } = resolveMatchup(game.away, game.home);
  const f = game.insight?.form;
  const rows = rowsFor({ stat_rows: f?.rows, stats: game.stats }, 6);
  const portrait = o === "portrait";
  const centre = (
    <div className="flex min-h-0 flex-col justify-center" style={{ padding: `${U(2)} ${U(portrait ? 3 : 2.4)}`, gap: U(portrait ? 4 : 3) }}>
      <div className="text-center">
        <div className={`${D} font-black uppercase leading-none tracking-wide`} style={{ fontSize: U(4.2) }}>Recent form</div>
        <div className={`${D} font-semibold uppercase tracking-[.3em] text-white/55`} style={{ fontSize: U(1.5), marginTop: U(.5) }}>Average per game</div>
      </div>
      <MirrorBars rows={rows} size={2.3} gap={portrait ? 3 : 3.2} />
    </div>
  );
  return (
    <Shell>
      <div className="grid min-h-0 flex-1 landscape:grid-cols-[26fr_48fr_26fr] portrait:grid-rows-[auto_1fr_auto]" style={{ gap: U(.3) }}>
        <FormPanel team={game.away} c={away} form={f?.away} scale={1} row={portrait} />
        {centre}
        <FormPanel team={game.home} c={home} form={f?.home} scale={1} row={portrait} />
      </div>
    </Shell>
  );
}

/* ------------------------------------------------------------------ Game stats */

function LineScore({ game, size = 1.8 }: { game: Game; size?: number | undefined }) {
  const n = Math.max(game.linescores.home.length, game.linescores.away.length);
  if (!n) return null;
  const cols = Array.from({ length: n }, (_, i) => i);
  const head = (i: number) => (i === 3 ? "OT" : i === 4 ? "SO" : String(i + 1));
  const row = (t: Team, ls: (number | string)[]) => (
    <tr key={t.id}>
      <td className={`${D} text-left font-black`} style={{ padding: `${U(.25)} ${U(.9)} ${U(.25)} 0` }}>{t.abbr}</td>
      {cols.map((i) => <td key={i} className="num text-center" style={{ padding: `${U(.25)} ${U(.7)}` }}>{ls[i] ?? "-"}</td>)}
      <td className="num text-center font-black" style={{ padding: `${U(.25)} 0 ${U(.25)} ${U(.7)}` }}>{t.score ?? 0}</td>
    </tr>
  );
  return (
    <table className={D} style={{ fontSize: U(size), margin: "0 auto" }}>
      <thead>
        <tr className="text-white/50" style={{ fontSize: U(size * .7) }}>
          <th />{cols.map((i) => <th key={i} className="num font-semibold">{head(i)}</th>)}<th className="font-semibold">T</th>
        </tr>
      </thead>
      <tbody>{row(game.away, game.linescores.away)}{row(game.home, game.linescores.home)}</tbody>
    </table>
  );
}

function Banner({ team, c, side, vertical }: { team: Team; c: SideColors; side: "l" | "r"; vertical: boolean }) {
  const left = side === "l";
  const bg = c.textIsDark ? c.fill : `linear-gradient(${left ? 90 : 270}deg, ${c.fill} 0%, ${c.fill} 35%, #07090f 108%)`;
  const score = <span className={`${D} num font-black leading-none`} style={{ fontSize: U(vertical ? 8 : 9) }}>{team.score ?? 0}</span>;
  const name = <span className={`${D} min-w-0 font-black uppercase leading-[.92]`} style={{ fontSize: U(vertical ? 2.8 : 3.2), textAlign: vertical ? "center" : left ? "left" : "right", flex: vertical ? undefined : "1 1 0", overflowWrap: "anywhere" }}>{team.name}</span>;
  const badge = <TeamBadge team={team} size={U(vertical ? 6 : 7)} ring="rgba(255,255,255,.22)" />;
  return (
    <div className={`relative flex items-center overflow-hidden ${vertical ? "flex-col justify-center" : ""}`} style={{ background: bg, color: c.text, padding: `${U(1.2)} ${U(2.2)}`, gap: U(vertical ? .8 : 1.6) }}>
      {vertical ? <>{badge}{name}{score}</> : left ? <>{badge}{name}{score}</> : <>{score}{name}{badge}</>}
    </div>
  );
}

export function StatsScreen({ game }: { game: Game }) {
  const o = useOrientation();
  const portrait = o === "portrait";
  const { away, home } = resolveMatchup(game.away, game.home);
  const rows = rowsFor(game, 8);
  const title = intermissionTitle(game) || "GAME STATS";
  const titleEl = (
    <div className="text-center">
      <div className={`${D} font-black uppercase leading-[.95] tracking-wide`} style={{ fontSize: U(portrait ? 4.6 : 3.3) }}>{title}</div>
    </div>
  );
  return (
    <Shell>
      {portrait ? (
        <div className="flex flex-col" style={{ padding: `${U(2)} 0 0`, gap: U(1.6) }}>
          {titleEl}
          <div className="grid grid-cols-2" style={{ gap: U(.3) }}>
            <Banner team={game.away} c={away} side="l" vertical />
            <Banner team={game.home} c={home} side="r" vertical />
          </div>
          <LineScore game={game} size={1.9} />
        </div>
      ) : (
        <div className="grid items-center" style={{ gridTemplateColumns: "37fr 26fr 37fr", height: U(16), gap: U(1) }}>
          <Banner team={game.away} c={away} side="l" vertical={false} />
          <div className="flex flex-col items-center" style={{ gap: U(.4) }}>{titleEl}<LineScore game={game} size={1.4} /></div>
          <Banner team={game.home} c={home} side="r" vertical={false} />
        </div>
      )}
      <div className="flex min-h-0 flex-1 flex-col justify-center" style={{ padding: `${U(1.5)} ${U(3.5)}` }}>
        {rows.length ? <MirrorBars rows={rows} size={portrait ? 3.3 : 2.9} gap={portrait ? 3.8 : 2.1} /> : <div className="text-center text-white/50" style={{ fontSize: U(2.4) }}>No stats yet</div>}
      </div>
    </Shell>
  );
}

/* ------------------------------------------------------------------ Game summary */

function periodName(_sport: string, n: number): string {
  return n <= 3 ? ordinal(n).toUpperCase() : n === 4 ? "OT" : n === 5 ? "SO" : `${n - 3}OT`;
}

const TAGS: Record<string, string> = { pp: "PP", en: "EN", sh: "SH" };
function tagFor(p: ScoringPlay): string[] {
  const t = [...(p.tags ?? [])];
  const s = TAGS[p.strength ?? ""];
  if (s) t.push(s);
  return t;
}

function GoalCard({ p, team, c, dense, outlined, isHome }: { p: ScoringPlay; team: Team; c: SideColors; dense: boolean; outlined: boolean; isHome: boolean }) {
  const [first, ...rest] = (p.scorer ?? team.display_name).split(" ");
  const surname = rest.length ? rest.join(" ") : first;
  const given = rest.length ? first : "";
  // scoring team's score first, e.g. "HAR 1-0"
  const score = isHome ? `${p.home_score}-${p.away_score}` : `${p.away_score}-${p.home_score}`;
  const tags = tagFor(p);
  const assists = p.assists?.length ? p.assists.join(", ") : "Unassisted";
  return (
    <div className="relative min-w-0 overflow-hidden" style={{ background: panelBg(c), color: c.text, borderRadius: U(1.2), padding: dense ? `${U(.7)} ${U(1.3)}` : `${U(1)} ${U(1.5)}`, boxShadow: outlined ? "inset 0 0 0 .25vmin rgba(255,255,255,.75)" : undefined }}>
      <div className="flex items-start justify-between" style={{ gap: U(1) }}>
        <TeamBadge team={team} size={U(dense ? 2.4 : 3)} ring="rgba(255,255,255,.25)" />
        <div className={`${D} num text-right font-black leading-none`} style={{ fontSize: U(dense ? 1.8 : 2.2) }}>
          {team.abbr} {score}
          <div className="font-semibold" style={{ fontSize: U(dense ? 1.3 : 1.6), opacity: .85, marginTop: U(.3) }}>{p.clock || (p.period >= 5 && p.period_label === "shootout" ? "SO" : "")}</div>
        </div>
      </div>
      <div className={`${D} flex items-baseline`} style={{ gap: U(1), marginTop: dense ? U(.2) : U(.6) }}>
        <div className="min-w-0 flex-1">
          {given && !dense && <div className="font-medium uppercase leading-none" style={{ fontSize: U(1.5), opacity: .9 }}>{given}</div>}
          <div className="truncate font-black uppercase leading-[.95]" style={{ fontSize: U(dense ? 2.4 : 3.2) }}>{dense && given ? `${given[0]}. ` : ""}{surname}</div>
        </div>
        {tags.map((tg) => <span key={tg} className="shrink-0 rounded-[.25em] font-black" style={{ fontSize: U(1.3), padding: `${U(.15)} ${U(.6)}`, background: c.textIsDark ? "#0a0d14" : "#fff", color: c.textIsDark ? "#fff" : "#0a0d14" }}>{tg}</span>)}
      </div>
      <div className={`${D} truncate font-medium`} style={{ fontSize: U(dense ? 1.3 : 1.6), opacity: .85, marginTop: U(.4) }}>{assists}</div>
    </div>
  );
}

export function SummaryScreen({ game, final }: { game: Game; final?: boolean | undefined }) {
  const o = useOrientation();
  const portrait = o === "portrait";
  const { away, home } = resolveMatchup(game.away, game.home);
  const byPeriod = new Map<number, ScoringPlay[]>();
  for (const g of game.goals) byPeriod.set(g.period, [...(byPeriod.get(g.period) ?? []), g]);
  const maxP = Math.min(6, Math.max(game.linescores.home.length, game.linescores.away.length, ...byPeriod.keys(), game.status === "pre" ? 0 : game.period, 1));
  const periods = Array.from({ length: maxP }, (_, i) => i + 1);
  const maxCards = Math.max(1, ...periods.map((n) => byPeriod.get(n)?.length ?? 0));
  const dense = portrait ? game.goals.length > 8 : maxCards >= 3;
  const noun = "GOAL";
  const sub = final || game.status === "post" ? "Every goal · Final" : game.intermission ? `Every goal · ${intermissionTitle(game).toLowerCase().replace(/^./, (x) => x.toUpperCase())}` : "Every goal · In progress";
  const teamFor = (p: ScoringPlay) => (p.team_abbr === game.home.abbr ? { t: game.home, c: home, home: true } : { t: game.away, c: away, home: false });
  return (
    <Shell>
      <header className="flex items-center justify-between" style={{ padding: `${U(portrait ? 2.4 : 2)} ${U(3.4)} ${U(1.2)}` }}>
        <div>
          <div className={`${D} font-black uppercase leading-none tracking-wide`} style={{ fontSize: U(portrait ? 4.6 : 4.4) }}>Game summary</div>
          <div className={`${D} font-semibold uppercase tracking-[.25em] text-white/55`} style={{ fontSize: U(1.5), marginTop: U(.6) }}>{sub}</div>
        </div>
        <div className="flex items-center rounded-[1.4vmin] bg-white/[.08]" style={{ gap: U(1.2), padding: `${U(.7)} ${U(1.8)}` }}>
          <TeamBadge team={game.away} size={U(3.2)} />
          <span className={`${D} num font-black leading-none`} style={{ fontSize: U(4.4), opacity: (game.away.score ?? 0) >= (game.home.score ?? 0) ? 1 : .5 }}>{game.away.score ?? 0}</span>
          <span className="text-white/40" style={{ fontSize: U(3) }}>-</span>
          <span className={`${D} num font-black leading-none`} style={{ fontSize: U(4.4), opacity: (game.home.score ?? 0) >= (game.away.score ?? 0) ? 1 : .5 }}>{game.home.score ?? 0}</span>
          <TeamBadge team={game.home} size={U(3.2)} />
        </div>
      </header>
      {game.goals.length === 0 ? (
        <div className="flex flex-1 items-center justify-center text-white/50" style={{ fontSize: U(3) }}>No scoring yet</div>
      ) : (
        <div className="min-h-0 flex-1 overflow-hidden" style={{ padding: `${U(.8)} ${U(3.4)} ${U(1.6)}`, display: "grid", gap: U(portrait ? 1.6 : 2), gridTemplateColumns: portrait ? "1fr" : `repeat(${periods.length}, minmax(0,1fr))`, alignContent: portrait ? "start" : undefined }}>
          {periods.map((n) => {
            const plays = byPeriod.get(n) ?? [];
            const ended = game.intermission && n === game.period;
            return (
              <section key={n} className="min-h-0 min-w-0">
                <div className={`${D} flex items-baseline justify-between font-black uppercase`} style={{ borderBottom: `1px solid rgba(255,255,255,${ended ? .8 : .2})`, paddingBottom: U(.5), marginBottom: U(1), color: ended ? "#fff" : "rgba(255,255,255,.72)" }}>
                  <span style={{ fontSize: U(2.6) }}>{periodName(game.sport, n)}</span>
                  <span className="tracking-[.16em] text-white/55" style={{ fontSize: U(1.4) }}>{plays.length ? `${plays.length} ${noun}${plays.length > 1 ? "S" : ""}` : `NO ${noun}S`}</span>
                </div>
                <div className="grid" style={{ gap: U(1), gridTemplateColumns: portrait ? "repeat(2, minmax(0,1fr))" : "1fr" }}>
                  {plays.map((p, i) => {
                    const { t, c, home: isHome } = teamFor(p);
                    return <GoalCard key={i} p={p} team={t} c={c} dense={dense} outlined={ended} isHome={isHome} />;
                  })}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </Shell>
  );
}

