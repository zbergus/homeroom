import type { Game, StatRow, StatValue } from "../types";
import { resolveMatchup } from "../lib/colors";

const U = (n: number) => `calc(var(--u) * ${n})`;

const parse = (v: StatValue | undefined): number | null => {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (v == null || v === "") return null;
  const m = String(v).replace("%", "").match(/-?\d+(\.\d+)?/);
  return m ? parseFloat(m[0]) : null;
};

const STAT_LABELS: Record<string, string> = {
  SOG: "Shots", S: "Shots", SH: "Shots", SV: "Saves", "SV%": "Save %", G: "Goals", A: "Assists",
  PIM: "Penalty min", HIT: "Hits", HITS: "Hits", BLK: "Blocks", TK: "Takeaways", GV: "Giveaways",
  FO: "Faceoffs", "FO%": "Faceoff %", PP: "Power play", "PP%": "Power play %", PTS: "Points",
};
const statLabel = (k: string) => STAT_LABELS[k] ?? STAT_LABELS[k.toUpperCase()] ?? k;

const HOCKEY_PRIORITY = ["SOG", "S", "SH", "SHOTS", "SV", "SV%", "FO%", "FO", "PP", "PP%", "HIT", "HITS", "BLK", "PIM", "TK", "GV"];

/** Rows to render: `stat_rows` when present, else a conversion of the legacy `stats` map. Empty = hide the block. */
export function rowsFor(game: Pick<Game, "stat_rows" | "stats">, max = 8): StatRow[] {
  if (game.stat_rows?.length) return game.stat_rows.filter(validRow).slice(0, max);
  const away = game.stats?.away ?? {}, home = game.stats?.home ?? {};
  const keys = Array.from(new Set([...Object.keys(away), ...Object.keys(home)]));
  keys.sort((a, b) => {
    const ai = HOCKEY_PRIORITY.indexOf(a.toUpperCase());
    const bi = HOCKEY_PRIORITY.indexOf(b.toUpperCase());
    if (ai >= 0 && bi >= 0) return ai - bi;
    if (ai >= 0) return -1;
    if (bi >= 0) return 1;
    return a.localeCompare(b);
  });
  const rows: StatRow[] = [];
  for (const k of keys) {
    const a = parse(away[k]), h = parse(home[k]);
    if (a == null || h == null) continue;
    rows.push({ key: k, label: statLabel(k), away: String(away[k]), home: String(home[k]), away_n: a, home_n: h });
  }
  return rows.slice(0, max);
}

const validRow = (r: StatRow) => Number.isFinite(r.home_n) && Number.isFinite(r.away_n) && !!r.label;

/* StatRow is typed home/away; the UI is away-left, home-right. */
const sides = (r: StatRow) => ({ lv: r.away, rv: r.home, ln: r.away_n, rn: r.home_n });

function better(r: StatRow): "l" | "r" | "=" {
  const { ln, rn } = sides(r);
  if (ln === rn) return "=";
  const leftHigher = ln > rn;
  return leftHigher !== !!r.lower_is_better ? "l" : "r";
}

/**
 * Mirrored bars growing outward from a centre label (break screens). Better value white, other grey.
 * `gap` in u between rows. Away left, home right.
 */
export function MirrorBars({ rows, size = 2.6, gap = 2, className = "" }: { rows: StatRow[]; size?: number | undefined; gap?: number | undefined; className?: string | undefined }) {
  if (!rows.length) return null;
  return (
    <div className={`flex flex-col ${className}`} style={{ gap: U(gap) }}>
      {rows.map((r) => {
        const { lv, rv, ln, rn } = sides(r);
        const max = Math.max(ln, rn, 1e-9);
        const w = (n: number) => (n <= 0 ? 0 : Math.max(3, (n / max) * 100));
        const b = better(r);
        const col = (side: "l" | "r") => (b === "=" || b === side ? "#fff" : "rgba(255,255,255,.42)");
        return (
          <div key={r.key} className="grid items-center" style={{ gridTemplateColumns: `${U(size * 2.6)} minmax(0,1fr) ${U(size * 5.6)} minmax(0,1fr) ${U(size * 2.6)}`, gap: U(size * .45) }}>
            <span className="num text-right font-display font-bold leading-none" style={{ fontSize: U(size * 1.15), color: col("l") }}>{lv}</span>
            <div className="flex justify-end overflow-hidden rounded-full bg-white/[.07]" style={{ height: U(size * .62) }}>
              <div className="h-full rounded-full" style={{ width: `${w(ln)}%`, background: col("l"), transition: "width .8s" }} />
            </div>
            <span className="text-center font-display font-semibold uppercase leading-tight tracking-[.14em] text-white/80" style={{ fontSize: U(size * .62) }}>{r.label}</span>
            <div className="overflow-hidden rounded-full bg-white/[.07]" style={{ height: U(size * .62) }}>
              <div className="h-full rounded-full" style={{ width: `${w(rn)}%`, background: col("r"), transition: "width .8s" }} />
            </div>
            <span className="num font-display font-bold leading-none" style={{ fontSize: U(size * 1.15), color: col("r") }}>{rv}</span>
          </div>
        );
      })}
    </div>
  );
}

/**
 * Scoreboard side panel: value / label / value above a two-segment team-colour bar.
 */
export function SplitBars({ game, rows, size = 1 }: { game: Pick<Game, "away" | "home">; rows: StatRow[]; size?: number | undefined }) {
  if (!rows.length) return null;
  const { away, home } = resolveMatchup(game.away, game.home);
  return (
    <div className="flex flex-col" style={{ gap: U(1.15 * size) }}>
      {rows.map((r) => {
        const { lv, rv, ln, rn } = sides(r);
        const tot = ln + rn;
        const lp = tot > 0 ? (ln / tot) * 100 : 50;
        const b = better(r);
        const emph = (side: "l" | "r") => (b === side ? 1 : 0.62);
        return (
          <div key={r.key}>
            <div className="flex items-baseline justify-between" style={{ fontSize: U(1.7 * size) }}>
              <span className="num font-display font-bold" style={{ opacity: emph("l"), minWidth: U(5) }}>{lv}</span>
              <span className="truncate px-[.5em] text-center font-display font-semibold uppercase tracking-[.12em] text-white/70" style={{ fontSize: U(1.15 * size) }}>{r.label}</span>
              <span className="num text-right font-display font-bold" style={{ opacity: emph("r"), minWidth: U(5) }}>{rv}</span>
            </div>
            <div className="flex overflow-hidden rounded-full bg-white/10" style={{ height: U(.75 * size), marginTop: U(.25), gap: U(.2) }}>
              <div className="h-full" style={{ width: `${lp}%`, background: away.fill, filter: "brightness(1.7) saturate(1.1)", opacity: emph("l") }} />
              <div className="h-full" style={{ width: `${100 - lp}%`, background: home.fill, filter: "brightness(1.7) saturate(1.1)", opacity: emph("r") }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}
