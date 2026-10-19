import type { StatRow } from "../types.js";
import type { Raw } from "./raw.js";
type Cell = { display: string };
type Stats = Map<string, Cell>;
type Val = { d: string; n: number };
interface Spec {
  key: string;
  label: string;
  lower?: boolean;
  get: (s: Stats) => Val | undefined;
}

const num = (s: string | undefined): number | undefined => {
  const v = parseFloat((s ?? "").replace(/[^\d.\-]/g, ""));
  return Number.isFinite(v) ? v : undefined;
};
const round = (n: number) => Math.round(n);

const count = (name: string) => (s: Stats): Val | undefined => {
  const n = num(s.get(name)?.display);
  return n === undefined ? undefined : { d: String(round(n) === n ? n : n), n };
};
/** percentage given directly (43, 47.8) */
const pct = (name: string) => (s: Stats): Val | undefined => {
  const n = num(s.get(name)?.display);
  return n === undefined ? undefined : { d: `${round(n)}%`, n };
};
/** percentage derived from two counts (accurate / total) */
const pctOf = (a: string, b: string) => (s: Stats): Val | undefined => {
  const x = num(s.get(a)?.display), y = num(s.get(b)?.display);
  return x === undefined || !y ? undefined : { d: `${round((x / y) * 100)}%`, n: (x / y) * 100 };
};
/** "made/attempted" from two counts (power play goals / opportunities) */
const ratio = (made: string, att: string) => (s: Stats): Val | undefined => {
  const m = num(s.get(made)?.display), a = num(s.get(att)?.display);
  return m === undefined || a === undefined ? undefined : { d: `${m}/${a}`, n: a ? m / a : 0 };
};
/** "5-11" or "24/34" kept as printed, ranked by the first number over the second */
const ratioStr = (name: string) => (s: Stats): Val | undefined => {
  const d = s.get(name)?.display;
  const m = /^(\d+)\s*[-/]\s*(\d+)$/.exec(d ?? "");
  return m ? { d: `${m[1]}/${m[2]}`, n: Number(m[2]) ? Number(m[1]) / Number(m[2]) : 0 } : undefined;
};
/** "29:37" -> seconds */
const time = (name: string) => (s: Stats): Val | undefined => {
  const m = /^(\d+):(\d{2})$/.exec(s.get(name)?.display ?? "");
  return m ? { d: `${m[1]}:${m[2]}`, n: Number(m[1]) * 60 + Number(m[2]) } : undefined;
};
/** "6-40" penalties-yards: count only */
const firstOf = (name: string) => (s: Stats): Val | undefined => {
  const m = /^(\d+)/.exec(s.get(name)?.display ?? "");
  return m ? { d: m[1], n: Number(m[1]) } : undefined;
};

/** Row order and wording follow the reference break screens; keys are ESPN's own stat names. */
const ROWS: Record<string, Spec[]> = {
  hockey: [
    { key: "shots", label: "Shots", get: count("shotsTotal") },
    { key: "hits", label: "Hits", get: count("hits") },
    { key: "faceoffs", label: "Faceoffs", get: pct("faceoffPercent") },
    { key: "powerplay", label: "Power play", get: ratio("powerPlayGoals", "powerPlayOpportunities") },
    { key: "takeaways", label: "Takeaways", get: count("takeaways") },
    { key: "giveaways", label: "Giveaways", lower: true, get: count("giveaways") },
    { key: "pim", label: "Penalty minutes", lower: true, get: count("penaltyMinutes") },
  ],
  basketball: [
    { key: "fg", label: "Field goal %", get: pct("fieldGoalPct") },
    { key: "fg3", label: "3-point %", get: pct("threePointFieldGoalPct") },
    { key: "ft", label: "Free throw %", get: pct("freeThrowPct") },
    { key: "reb", label: "Rebounds", get: count("totalRebounds") },
    { key: "ast", label: "Assists", get: count("assists") },
    { key: "stl", label: "Steals", get: count("steals") },
    { key: "blk", label: "Blocks", get: count("blocks") },
    { key: "tov", label: "Turnovers", lower: true, get: count("totalTurnovers") },
    { key: "paint", label: "Points in paint", get: count("pointsInPaint") },
    { key: "fastbreak", label: "Fast break points", get: count("fastBreakPoints") },
  ],
  football: [
    { key: "yards", label: "Total yards", get: count("totalYards") },
    { key: "pass", label: "Passing yards", get: count("netPassingYards") },
    { key: "rush", label: "Rushing yards", get: count("rushingYards") },
    { key: "first", label: "1st downs", get: count("firstDowns") },
    { key: "third", label: "3rd downs", get: ratioStr("thirdDownEff") },
    { key: "turnovers", label: "Turnovers", lower: true, get: count("turnovers") },
    { key: "penalties", label: "Penalties", lower: true, get: firstOf("totalPenaltiesYards") },
    { key: "top", label: "Possession", get: time("possessionTime") },
  ],
  baseball: [
    { key: "hits", label: "Hits", get: count("batting.hits") },
    { key: "hr", label: "Home runs", get: count("batting.homeRuns") },
    { key: "bb", label: "Walks", get: count("batting.walks") },
    { key: "k", label: "Strikeouts", lower: true, get: count("batting.strikeouts") },
    { key: "lob", label: "Left on base", lower: true, get: count("batting.runnersLeftOnBase") },
    { key: "err", label: "Errors", lower: true, get: count("fielding.errors") },
  ],
  soccer: [
    { key: "poss", label: "Possession", get: pct("possessionPct") },
    { key: "shots", label: "Shots", get: count("totalShots") },
    { key: "sot", label: "Shots on target", get: count("shotsOnTarget") },
    { key: "corners", label: "Corners", get: count("wonCorners") },
    { key: "passes", label: "Pass accuracy", get: pctOf("accuratePasses", "totalPasses") },
    { key: "fouls", label: "Fouls", lower: true, get: count("foulsCommitted") },
    { key: "yellow", label: "Yellow cards", lower: true, get: count("yellowCards") },
    { key: "red", label: "Red cards", lower: true, get: count("redCards") },
  ],
};

/** Flatten ESPN's `statistics` (flat list for most sports, category-nested for baseball) into name -> cell. */
function flatten(stats: Raw[] | undefined): Stats {
  const m: Stats = new Map();
  for (const s of stats ?? []) {
    if (Array.isArray(s.stats)) for (const x of s.stats) m.set(`${s.name}.${x.name}`, { display: String(x.displayValue ?? "") });
    else if (s.name) m.set(s.name, { display: String(s.displayValue ?? "") });
  }
  return m;
}

/**
 * Canonical comparison rows from `summary.boxscore.teams`. A row is only emitted when BOTH teams have a value,
 * so a feed that omits a stat just drops that row instead of showing a blank.
 */
export function buildStatRows(sport: string, teams: Raw[] | undefined): StatRow[] {
  const specs = ROWS[sport];
  if (!specs || !teams || teams.length < 2) return [];
  const home = teams.find((t) => t.homeAway === "home") ?? teams[1];
  const away = teams.find((t) => t.homeAway === "away") ?? teams[0];
  const hs = flatten(home.statistics), as = flatten(away.statistics);
  const rows: StatRow[] = [];
  for (const sp of specs) {
    const h = sp.get(hs), a = sp.get(as);
    if (!h || !a) continue;
    rows.push({ key: sp.key, label: sp.label, home: h.d, away: a.d, home_n: h.n, away_n: a.n, ...(sp.lower ? { lower_is_better: true } : {}) });
  }
  return rows;
}
