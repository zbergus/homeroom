import type { Game, GameLite, Team } from "../types";
import { gradientFor, resolveTeam } from "./colors";

/** Solo colour for a team (white text stays >= 4.5:1). Matchup-aware colours: see lib/colors.ts. */
export function teamColors(t: Team): { primary: string; secondary: string } {
  const r = resolveTeam(t);
  return { primary: r.fill, secondary: r.deep };
}

/** Hard-ish diagonal split of the two *resolved* matchup colours. */
export const diagonal = (away: Team, home: Team, angle = 115) => gradientFor(away, home, angle);

export const startMs = (g: Pick<GameLite, "start_time">): number => {
  const v = g.start_time;
  if (typeof v === "number") return v < 1e12 ? v * 1000 : v;
  const n = Date.parse(v);
  return Number.isNaN(n) ? 0 : n;
};

export const shortPeriod = (label: string): string =>
  label.replace(/\s*(period|quarter|inning)$/i, "").trim();

/** `2nd 8:42`, `Final`, `Int 1st`, or "" for pre-game (caller renders countdown). */
export function statusText(g: Game | GameLite): string {
  if (g.status === "post") return "Final";
  if (g.status === "pre") return "";
  if (g.intermission) return `End ${shortPeriod(g.period_label ?? "")}`.trim();
  const label = shortPeriod(g.period_label ?? "");
  const clock = g.clock ?? "";
  return (label.includes(clock) ? label : `${label} ${clock}`).trim();
}

export function countdown(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(h)}:${p(m)}:${p(ss)}`;
}

export const timeLabel = (ms: number) =>
  new Date(ms).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

const dayKey = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export const ordinal = (n: number) => {
  const s = ["th", "st", "nd", "rd"], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || "th");
};

export function sortGames<T extends GameLite>(games: T[]): T[] {
  const rank = (g: T) => (g.status === "in" ? 0 : g.status === "pre" ? 1 : 2);
  return [...games].sort((a, b) => {
    const r = rank(a) - rank(b);
    if (r) return r;
    if (a.status === "post") return startMs(b) - startMs(a);
    return startMs(a) - startMs(b);
  });
}

/** "END OF 2ND PERIOD" style title, or "" when not in an intermission. */
export const intermissionTitle = (g: Game) =>
  g.intermission && g.period_label ? `End of ${g.period_label.replace(/ period$/i, " period")}`.toUpperCase() : "";

/** "May 3 7:30 PM" style short date/time, or `Today`/`Tomorrow` prefix. */
export function whenLabel(ms: number, now = Date.now()): { date: string; time: string } {
  const d = new Date(ms);
  const key = (x: Date) => dayKey(x);
  const t = new Date(now);
  const tm = new Date(now); tm.setDate(tm.getDate() + 1);
  const date = key(d) === key(t) ? "Today" : key(d) === key(tm) ? "Tomorrow" : d.toLocaleDateString([], { month: "short", day: "numeric" });
  return { date, time: timeLabel(ms) };
}
