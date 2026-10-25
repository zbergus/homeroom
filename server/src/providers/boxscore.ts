import type { StatRow } from "../types.js";
import type { Raw } from "./raw.js";
type Cell = { display: string };
type Stats = Map<string, Cell>;
type Val = { d: string; n: number };
interface Spec {
  key: string;
  label: string;
  lower?: boolean | undefined;
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
/** "made/attempted" from two counts (power play goals / opportunities) */
const ratio = (made: string, att: string) => (s: Stats): Val | undefined => {
  const m = num(s.get(made)?.display), a = num(s.get(att)?.display);
  return m === undefined || a === undefined ? undefined : { d: `${m}/${a}`, n: a ? m / a : 0 };
};

/** Row order and wording follow the reference hockey break screens; keys are ESPN's own stat names. */
const HOCKEY_ROWS: Spec[] = [
  { key: "shots", label: "Shots", get: count("shotsTotal") },
  { key: "hits", label: "Hits", get: count("hits") },
  { key: "faceoffs", label: "Faceoffs", get: pct("faceoffPercent") },
  { key: "powerplay", label: "Power play", get: ratio("powerPlayGoals", "powerPlayOpportunities") },
  { key: "takeaways", label: "Takeaways", get: count("takeaways") },
  { key: "giveaways", label: "Giveaways", lower: true, get: count("giveaways") },
  { key: "pim", label: "Penalty minutes", lower: true, get: count("penaltyMinutes") },
];

function indexStats(team: Raw | undefined): Stats {
  const map: Stats = new Map();
  for (const s of team?.statistics ?? []) {
    const name: string | undefined = s?.name ?? s?.abbreviation;
    if (name && (s.displayValue !== undefined || s.value !== undefined)) {
      map.set(name, { display: String(s.displayValue ?? s.value) });
    }
  }
  return map;
}

export function buildStatRows(sport: string, teams: Raw[] | undefined): StatRow[] {
  if (sport !== "hockey" || !teams || teams.length < 2) return [];
  const home = teams.find((t) => t.homeAway === "home") ?? teams[0];
  const away = teams.find((t) => t.homeAway === "away") ?? teams[1];
  const hs = indexStats(home), as = indexStats(away);
  const rows: StatRow[] = [];
  for (const spec of HOCKEY_ROWS) {
    const hv = spec.get(hs);
    const av = spec.get(as);
    if (!hv || !av) continue;
    rows.push({
      key: spec.key,
      label: spec.label,
      home: hv.d,
      away: av.d,
      home_n: hv.n,
      away_n: av.n,
      lower_is_better: spec.lower,
    });
  }
  return rows;
}
