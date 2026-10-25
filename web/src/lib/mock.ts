import type { EventPayload, FormGame, Game, GoalieStats, HockeyBoxscore, Insight, PlayerWatch, ScoringPlay, SkaterStats, StartingGoalie, StatRow, Team } from "../types";

interface Seed {
  id: string; league: string; sport: "hockey"; status: Game["status"];
  away: [string, string, string, [number, number, number], [number, number, number]];
  home: [string, string, string, [number, number, number], [number, number, number]];
  startInMin: number; period: number; clock: string; as: number; hs: number; intermission?: boolean | undefined;
  rec?: [string | undefined, string];
}

const t = (id: string, [abbr, name, city, p, s]: Seed["home"], league = "nhl"): Team => ({
  id, abbr, name, display_name: `${city} ${name}`, score: 0,
  logo: `https://a.espncdn.com/i/teamlogos/${league}/500/${abbr.toLowerCase()}.png`,
  options: {
    primary_color_rgb: { r: p[0], g: p[1], b: p[2] },
    secondary_color_rgb: { r: s[0], g: s[1], b: s[2] },
    alternate_color_rgb: { r: 255, g: 255, b: 255 },
  },
});

const SEEDS: Seed[] = [
  { id: "nhl:m1", league: "nhl", sport: "hockey", status: "in", rec: ["4-3-1", "5-2-1"], away: ["CBJ", "Blue Jackets", "Columbus", [0, 38, 84], [206, 15, 46]], home: ["MIN", "Wild", "Minnesota", [18, 71, 52], [174, 18, 42]], startInMin: -40, period: 2, clock: "08:42", as: 1, hs: 2 },
  { id: "nhl:m2", league: "nhl", sport: "hockey", status: "in", rec: ["6-1-1", "3-4-2"], away: ["BOS", "Bruins", "Boston", [252, 181, 20], [20, 20, 20]], home: ["TOR", "Maple Leafs", "Toronto", [0, 32, 91], [60, 90, 160]], startInMin: -70, period: 3, clock: "01:47", as: 3, hs: 3 },
  { id: "nhl:m3", league: "nhl", sport: "hockey", status: "in", intermission: true, rec: ["5-3-0", "4-3-1"], away: ["EDM", "Oilers", "Edmonton", [4, 30, 66], [252, 76, 0]], home: ["VAN", "Canucks", "Vancouver", [0, 32, 91], [0, 132, 61]], startInMin: -50, period: 2, clock: "00:00", as: 2, hs: 3 },
  { id: "nhl:m4", league: "nhl", sport: "hockey", status: "pre", rec: ["5-2-1", "4-3-2"], away: ["COL", "Avalanche", "Colorado", [111, 38, 61], [35, 97, 146]], home: ["DAL", "Stars", "Dallas", [0, 104, 71], [143, 143, 140]], startInMin: 40, period: 0, clock: "20:00", as: 0, hs: 0 },
  { id: "nhl:m5", league: "nhl", sport: "hockey", status: "post", rec: ["3-5-1", "6-2-0"], away: ["SEA", "Kraken", "Seattle", [0, 22, 40], [153, 217, 217]], home: ["NJD", "Devils", "New Jersey", [206, 17, 38], [0, 0, 0]], startInMin: -170, period: 3, clock: "00:00", as: 2, hs: 4 },
  { id: "nhl:m6", league: "nhl", sport: "hockey", status: "pre", away: ["PIT", "Penguins", "Pittsburgh", [252, 181, 20], [0, 0, 0]], home: ["PHI", "Flyers", "Philadelphia", [247, 73, 2], [0, 0, 0]], startInMin: 150, period: 0, clock: "20:00", as: 0, hs: 0 },
  { id: "iihf:m1", league: "iihf", sport: "hockey", status: "in", rec: ["4-0-0", "3-1-0"], away: ["USA", "United States", "USA", [0, 40, 104], [186, 12, 47]], home: ["CAN", "Canada", "Canada", [235, 30, 44], [0, 0, 0]], startInMin: -65, period: 3, clock: "04:12", as: 3, hs: 2 },
  { id: "iihf:m2", league: "iihf", sport: "hockey", status: "in", rec: ["3-1-0", "2-2-0"], away: ["SWE", "Sweden", "Sweden", [0, 75, 135], [254, 204, 0]], home: ["FIN", "Finland", "Finland", [0, 47, 108], [255, 255, 255]], startInMin: -85, period: 4, clock: "02:45", as: 2, hs: 2 },
  { id: "iihf:m3", league: "iihf", sport: "hockey", status: "pre", away: ["CZE", "Czechia", "Czechia", [17, 69, 126], [215, 20, 26]], home: ["SUI", "Switzerland", "Switzerland", [218, 41, 28], [255, 255, 255]], startInMin: 120, period: 0, clock: "20:00", as: 0, hs: 0 },
  { id: "ahl:m1", league: "ahl", sport: "hockey", status: "in", rec: ["22-14-3", "28-10-2"], away: ["PRO", "Bruins", "Providence", [0, 0, 0], [252, 181, 20]], home: ["HER", "Bears", "Hershey", [84, 43, 29], [197, 160, 89]], startInMin: -45, period: 2, clock: "11:20", as: 1, hs: 2 },
  { id: "ahl:m2", league: "ahl", sport: "hockey", status: "post", rec: ["18-19-4", "24-15-2"], away: ["LAV", "Rocket", "Laval", [175, 30, 45], [0, 30, 70]], home: ["SYR", "Crunch", "Syracuse", [15, 32, 75], [198, 146, 20]], startInMin: -160, period: 4, clock: "00:00", as: 4, hs: 3 },
];

/** Element `i` of a constant list, wrapping around, so the demo data never indexes out of range. */
const pick = <T,>(list: readonly T[], i: number): T => list[((i % list.length) + list.length) % list.length] as T;

const periodLabel = (_sport: string, n: number, _clock: string): string =>
  n <= 3 ? `${["", "1st", "2nd", "3rd"][n]} period` : n === 4 ? "OT" : `OT${n - 3}`;

const deltaFor = (_sport: string): number => 1;
const POSITIONS = ["C", "RW", "LW", "D"];
const SCORERS = ["A. Moreau", "S. Okafor", "J. Lindqvist", "D. Reyes", "M. Tanaka", "K. Abbott", "R. Novak", "T. Greene"];

const pad = (n: number) => String(n).padStart(2, "0");


/* ---------- deterministic fake context data ---------- */
const rng = (seed: string) => {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) { h = Math.imul(h ^ seed.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); }
  let a = h >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let x = a; x = Math.imul(x ^ (x >>> 15), x | 1); x ^= x + Math.imul(x ^ (x >>> 7), x | 61); return ((x ^ (x >>> 14)) >>> 0) / 4294967296; };
};
const OPPS = ["RIV", "COL", "NOR", "BAY", "PIN", "SEA", "VGK", "CGY", "LAK", "ANA"];
const FIRST = ["Alex", "Sam", "Jordan", "Rae", "Luis", "Mika", "Dmitri", "Noah"];
const LAST = ["Moreau", "Okafor", "Vale", "Chen", "Duarte", "Lindqvist", "Reyes", "Tanaka"];

function mkGames(abbr: string, n: number): FormGame[] {
  const r = rng(`form:${abbr}`);
  return Array.from({ length: n }, (_, i) => {
    const roll = r();
    const result: FormGame["result"] = roll < 0.55 ? "W" : roll < 0.8 ? "L" : "OTL";
    const lo = Math.floor(r() * 3), win = lo + 1 + Math.floor(r() * 2);
    const gf = result === "W" ? win : result === "OTL" ? lo + 1 : lo;
    const ga = result === "W" ? lo : result === "OTL" ? lo + 2 : lo + 1 + Math.floor(r() * 2);
    const d = new Date(Date.now() - (n - i) * 2 * 86400_000);
    return { opp_abbr: pick(OPPS, i + abbr.length), venue: r() < 0.5 ? "H" : "A", gf: result === "OTL" ? ga - 1 : gf, ga, result, date: d.toISOString() };
  });
}
const recOf = (g: FormGame[]) => `${g.filter((x) => x.result === "W").length}-${g.filter((x) => x.result === "L").length}-${g.filter((x) => x.result === "OTL").length}`;
const avg = (g: FormGame[], k: "gf" | "ga") => g.reduce((a, x) => a + x[k], 0) / Math.max(1, g.length);

function mkPlayer(abbr: string, side: number): PlayerWatch {
  const r = rng(`pl:${abbr}`);
  const first = pick(FIRST, Math.floor(r() * FIRST.length)), last = pick(LAST, Math.floor(r() * LAST.length) + side);
  const log = Array.from({ length: 5 }, (_, i) => ({ opp_abbr: `${i % 2 ? "@" : ""}${pick(OPPS, i * 3 + side)}`, value: Math.floor(r() * 4) }));
  const g = Math.floor(r() * 6) + 2, a = Math.floor(r() * 6) + 1;
  return {
    id: `${abbr}-p`, name: `${first} ${last}`, first, last, jersey: String(Math.floor(r() * 80) + 2), position: pick(POSITIONS, Math.floor(r() * 3)), team_abbr: abbr,
    tiles: [{ label: "Goals", value: String(g) }, { label: "Assists", value: String(a) }, { label: "Points", value: String(g + a) }, { label: "Shots", value: String(g * 4 + 3) }],
    log, log_label: "Points per game",
  };
}

const GOALIE_NAMES: Record<string, { name: string; jersey: string }> = {
  CBJ: { name: "Elvis Merzlikins", jersey: "90" },
  MIN: { name: "Filip Gustavsson", jersey: "32" },
  BOS: { name: "Jeremy Swayman", jersey: "1" },
  TOR: { name: "Anthony Stolarz", jersey: "41" },
  EDM: { name: "Stuart Skinner", jersey: "74" },
  VAN: { name: "Kevin Lankinen", jersey: "32" },
  COL: { name: "Alexandar Georgiev", jersey: "40" },
  DAL: { name: "Jake Oettinger", jersey: "29" },
  SEA: { name: "Joey Daccord", jersey: "35" },
  NJD: { name: "Jacob Markstrom", jersey: "25" },
  PIT: { name: "Alex Nedeljkovic", jersey: "39" },
  PHI: { name: "Samuel Ersson", jersey: "33" },
  USA: { name: "Connor Hellebuyck", jersey: "37" },
  CAN: { name: "Jordan Binnington", jersey: "50" },
  SWE: { name: "Linus Ullmark", jersey: "35" },
  FIN: { name: "Juuse Saros", jersey: "74" },
  CZE: { name: "Lukas Dostal", jersey: "1" },
  SUI: { name: "Leonardo Genoni", jersey: "63" },
  PRO: { name: "Brandon Bussi", jersey: "30" },
  HER: { name: "Hunter Shepard", jersey: "31" },
  LAV: { name: "Jakub Dobes", jersey: "75" },
  SYR: { name: "Matt Tomkins", jersey: "90" },
};

function mkGoalie(abbr: string, side: number, isPre: boolean): StartingGoalie {
  const g = GOALIE_NAMES[abbr] ?? { name: `${abbr} Goalie`, jersey: "30" };
  const r = rng(`gl:${abbr}:${side}`);
  const [first = "", ...rest] = g.name.split(" ");
  const last = rest.join(" ");
  const confirmed = isPre ? r() > 0.4 : true;
  const w = Math.floor(r() * 15) + 8;
  const l = Math.floor(r() * 10) + 3;
  const otl = Math.floor(r() * 5) + 1;
  const gaa = (2.2 + r() * 0.7).toFixed(2);
  const sv = `.${900 + Math.floor(r() * 25)}`;
  return {
    id: `${abbr}-g`,
    name: g.name,
    first,
    last: last || first,
    jersey: g.jersey,
    confirmed,
    status: confirmed ? "Confirmed" : "Probable",
    record: `${w}-${l}-${otl}`,
    gaa,
    save_pct: sv,
  };
}

const row = (key: string, label: string, away: string, home: string, an: number, hn: number, lower?: boolean): StatRow =>
  ({ key, label, away, home, away_n: an, home_n: hn, ...(lower ? { lower_is_better: true } : {}) });

function mkInsight(s: Seed): Insight {
  const r = rng(`ins:${s.id}`);
  const ga = mkGames(s.away[0], 10), gh = mkGames(s.home[0], 10);
  const f1 = (n: number) => n.toFixed(1);
  const pct = (n: number) => `${n.toFixed(1)}%`;
  const [sfa, sfh, saa, sah] = [28 + r() * 6, 28 + r() * 6, 27 + r() * 6, 27 + r() * 6];
  const [svA, svH, foA, foH] = [89 + r() * 3, 89 + r() * 3, 47 + r() * 6, 47 + r() * 6];
  return {
    updated_at: Date.now(),
    form: {
      away: { record: recOf(ga), games: ga }, home: { record: recOf(gh), games: gh },
      rows: [
        row("gf", "Goals for / g", f1(avg(ga, "gf")), f1(avg(gh, "gf")), avg(ga, "gf"), avg(gh, "gf")),
        row("ga", "Goals against / g", f1(avg(ga, "ga")), f1(avg(gh, "ga")), avg(ga, "ga"), avg(gh, "ga"), true),
        row("sf", "Shots for / g", f1(sfa), f1(sfh), sfa, sfh),
        row("sa", "Shots against / g", f1(saa), f1(sah), saa, sah, true),
        row("sv", "Save %", pct(svA), pct(svH), svA, svH),
        row("fo", "Faceoff %", pct(foA), pct(foH), foA, foH),
      ],
    },
    players: { away: mkPlayer(s.away[0], 0), home: mkPlayer(s.home[0], 1) },
  };
}

function mkStatRows(s: Seed): StatRow[] {
  const sa = 14 + s.as * 3, sh = 17 + s.hs * 2;
  return [
    row("shots", "Shots", String(sa), String(sh), sa, sh), row("hits", "Hits", "11", "15", 11, 15),
    row("fo", "Faceoffs %", "52%", "48%", 52, 48), row("pp", "Power play", "1/3", "0/2", 1 / 3, 0),
    row("tk", "Takeaways", "6", "4", 6, 4), row("gv", "Giveaways", "3", "7", 3, 7, true), row("pim", "Penalty minutes", "4", "6", 4, 6, true),
  ];
}

function build(s: Seed): Game {
  const away = t(`${s.id}-a`, s.away, s.league);
  const home = t(`${s.id}-h`, s.home, s.league);
  away.score = s.as; home.score = s.hs;
  away.record = s.rec?.[0]; home.record = s.rec?.[1];
  const label = periodLabel(s.sport, s.period, s.clock);
  const clockSecs = (c: string) => { const [m = NaN, sec = NaN] = c.split(":").map(Number); return Number.isFinite(m) && Number.isFinite(sec) ? m * 60 + sec : undefined; };
  const g: Game = {
    id: s.id, league: s.league, sport: s.sport, status: s.status,
    start_time: new Date(Date.now() + s.startInMin * 60_000).toISOString(),
    period: s.period, period_label: s.status === "pre" ? "" : label,
    clock: s.clock, intermission: !!s.intermission, away, home,
    clock_s: clockSecs(s.clock), clock_dir: "down", clock_running: s.status === "in" && !s.intermission,
    linescores: { home: [], away: [] },
    stats: { home: {}, away: {} }, goals: [],
    sog: { away: 15 + s.as * 4, home: 18 + s.hs * 4 },
    odds: { details: `${s.home[0]} -120 • O/U 6.0` },
    goalies: {
      away: mkGoalie(s.away[0], 0, s.status === "pre"),
      home: mkGoalie(s.home[0], 1, s.status === "pre"),
    },
  };
  g.insight = mkInsight(s);
  if (s.id === "nhl:m1") {
    g.situation = { advantage: "home", home_skaters: 5, away_skaters: 4 };
  } else if (s.id === "nhl:m2") {
    g.situation = { advantage: "away", home_skaters: 4, away_skaters: 5 };
  } else if (s.id === "iihf:m1") {
    g.situation = { advantage: null, home_skaters: 6, away_skaters: 5, empty_net: "home" };
  } else if (s.id === "iihf:m2") {
    g.situation = { advantage: null, home_skaters: 3, away_skaters: 3 };
  } else if (s.id === "ahl:m1") {
    g.situation = { advantage: "home", home_skaters: 5, away_skaters: 3 };
  }
  if (s.status !== "pre") g.stat_rows = mkStatRows(s);
  if (s.status !== "pre") {
    const upto = s.status === "post" ? 3 : Math.max(1, s.period);
    const split = (total: number) => {
      const a = new Array(upto).fill(0);
      let left = total, i = 0;
      while (left > 0) { const d = 1; a[i % upto] += d; left -= d; i++; }
      return a;
    };
    g.linescores = { away: split(s.as), home: split(s.hs) };
    let ha = 0, aa = 0, i = 0;
    const plays: ScoringPlay[] = [];
    const seq: ("a" | "h")[] = [];
    for (let k = 0; k < s.as; k++) seq.push("a");
    for (let k = 0; k < s.hs; k++) seq.push("h");
    seq.sort(() => Math.random() - 0.5);
    for (const side of seq) {
      const per = Math.min(upto, 1 + Math.floor((i * upto) / Math.max(1, seq.length)));
      if (side === "a") aa = Math.min(s.as, aa + 1); else ha = Math.min(s.hs, ha + 1);
      plays.push({
        period: per, period_label: periodLabel(s.sport, per, ""), clock: `${pad(2 + ((i * 7) % 16))}:${pad((i * 13) % 60)}`,
        team_abbr: side === "a" ? s.away[0] : s.home[0], scorer: pick(SCORERS, i * 3),
        assists: i % 2 ? [pick(SCORERS, i + 1)] : [pick(SCORERS, i + 2), pick(SCORERS, i + 4)],
        strength: i === 1 ? "pp" : i === 4 ? "en" : "ev", home_score: ha, away_score: aa,
      });
      i++;
    }
    g.goals = plays;
  }
  return g;
}

type MockSink = {
  snapshot: (g: Game[]) => void;
  game: (g: Game) => void;
  event: (e: EventPayload) => void;
};

/** Starts the fake feed. Returns a stop function. */
export function startMock(sink: MockSink, intervalMs = 15000): () => void {
  const games = SEEDS.map(build);
  sink.snapshot(structuredClone(games));
  let n = 0;
  const emit = (g: Game) => sink.game(structuredClone(g));

  const tick = setInterval(() => {
    for (const g of games) {
      if (g.status === "pre") {
        if (Date.parse(g.start_time as string) <= Date.now()) {
          g.status = "in"; g.period = 1; g.period_label = periodLabel(g.sport, 1, ""); emit(g);
          sink.event(mkEvent(g, "game_start", ++n));
        }
        continue;
      }
      if (g.status !== "in" || g.intermission) continue;
      const [m = 0, s = 0] = g.clock.split(":").map(Number);
      let tot = m * 60 + s - 1;
      if (tot < 0) tot = 20 * 60;
      g.clock = `${pad(Math.floor(tot / 60))}:${pad(tot % 60)}`;
      g.clock_s = tot;
      // push every 3 s so the client-side interpolation is visible
      if (++n % 3 === 0) emit(g);
    }
  }, 1000);

  const goal = setInterval(() => {
    const live = games.filter((g) => g.status === "in" && !g.intermission);
    if (!live.length) return;
    const g = live[Math.floor(Math.random() * live.length)];
    if (!g) return;
    const home = Math.random() < 0.5;
    const team = home ? g.home : g.away;
    const delta = deltaFor(g.sport);
    team.score = (team.score ?? 0) + delta;
    const scorer = pick(SCORERS, Math.floor(Math.random() * SCORERS.length));
    const play: ScoringPlay = {
      period: g.period, period_label: g.period_label, clock: g.clock, team_abbr: team.abbr, scorer,
      assists: [pick(SCORERS, Math.floor(Math.random() * SCORERS.length))], strength: "ev",
      home_score: g.home.score ?? 0, away_score: g.away.score ?? 0,
    };
    g.goals.push(play);
    emit(g);
    const ev = mkEvent(g, "goal", ++n);
    ev.team = structuredClone(team);
    ev.scoring = { label: "GOAL", scorer, assists: play.assists, strength: "ev", delta, home_score: play.home_score, away_score: play.away_score };
    ev.natural_text = `GOAL, ${team.display_name}! ${scorer} scores.`;
    sink.event(ev);
  }, intervalMs);

  // first goal shortly after load so screenshots/dev see an overlay quickly
  const first = setTimeout(() => {
    const g = games[0];
    if (!g) return;
    g.home.score = (g.home.score ?? 0) + 1;
    const play: ScoringPlay = { period: g.period, period_label: g.period_label, clock: g.clock, team_abbr: g.home.abbr, scorer: "D. Yurov", assists: ["Y. Trenin"], strength: "ev", home_score: g.home.score, away_score: g.away.score ?? 0 };
    g.goals.push(play);
    emit(g);
    const ev = mkEvent(g, "goal", ++n);
    ev.team = structuredClone(g.home);
    ev.scoring = { label: "GOAL", scorer: "D. Yurov", assists: ["Y. Trenin"], strength: "ev", delta: 1, home_score: play.home_score, away_score: play.away_score };
    sink.event(ev);
  }, 4000);

  // fake VAR: take the first goal back ~10 s after it was scored
  const overturn = setTimeout(() => {
    const g = games[0];
    if (!g) return;
    const gone = g.goals.pop();
    if (!gone) return;
    g.home.score = Math.max(0, (g.home.score ?? 0) - 1);
    emit(g);
    const ev = mkEvent(g, "goal_overturned", ++n);
    ev.team = structuredClone(g.home);
    ev.scoring = { label: "GOAL", scorer: gone.scorer, delta: -1, home_score: g.home.score, away_score: g.away.score ?? 0 };
    sink.event(ev);
  }, 12000);

  return () => { clearInterval(tick); clearInterval(goal); clearTimeout(first); clearTimeout(overturn); };
}

function mkEvent(g: Game, type: EventPayload["type"], n: number): EventPayload {
  return {
    event_id: `evt_mock_${n}_${Date.now()}`, type, emitted_at: Date.now() / 1000, delay_s: 0,
    league: g.league, sport: g.sport,
    game: { id: g.id, status: g.status, period: g.period, period_label: g.period_label, clock: g.clock, home: structuredClone(g.home), away: structuredClone(g.away) },
  };
}

export const MOCK_SETTINGS = {
  delay_global_s: 12.5, delay_by_game: {}, public_base_url: "http://192.168.1.10:8080",
  ha: { url: "", token: "", fire_rest_events: false },
};

export function mockSchedule() {
  const days: { date: string; games: Game[] }[] = [];
  const base = SEEDS.map(build);
  for (let d = 0; d < 7; d++) {
    const dt = new Date(); dt.setDate(dt.getDate() + d);
    const date = `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
    const games = d === 0 ? base : base.filter((_, i) => (i + d) % 3 !== 0).map((g, i) => ({
      ...structuredClone(g), id: `${g.id}-d${d}`, status: "pre" as const,
      start_time: new Date(new Date(dt).setHours(17 + (i % 4), (i % 2) * 30, 0, 0)).toISOString(),
      home: { ...g.home, score: 0 }, away: { ...g.away, score: 0 },
    }));
    days.push({ date, games });
  }
  return { days };
}

const KNOWN_ROSTERS: Record<string, { skaters: [string, string, string][]; goalie: [string, string] }> = {
  MIN: {
    skaters: [
      ["Kirill Kaprizov", "97", "LW"],
      ["Matt Boldy", "12", "RW"],
      ["Joel Eriksson Ek", "14", "C"],
      ["Mats Zuccarello", "36", "RW"],
      ["Marco Rossi", "23", "C"],
      ["Marcus Foligno", "17", "LW"],
      ["Brock Faber", "7", "D"],
      ["Jared Spurgeon", "46", "D"],
      ["Jonas Brodin", "25", "D"],
      ["Jake Middleton", "5", "D"],
      ["Ryan Hartman", "38", "C"],
      ["Marcus Johansson", "90", "LW"],
    ],
    goalie: ["Filip Gustavsson", "32"],
  },
  CBJ: {
    skaters: [
      ["Kirill Marchenko", "86", "RW"],
      ["Adam Fantilli", "11", "C"],
      ["Zach Werenski", "8", "D"],
      ["Boone Jenner", "38", "C"],
      ["Sean Monahan", "23", "C"],
      ["Cole Sillinger", "34", "C"],
      ["Kent Johnson", "91", "LW"],
      ["Damon Severson", "9", "D"],
      ["Ivan Provorov", "47", "D"],
      ["Yegor Chinakhov", "59", "RW"],
      ["Mathieu Olivier", "24", "RW"],
      ["Erik Gudbranson", "44", "D"],
    ],
    goalie: ["Elvis Merzlikins", "90"],
  },
  BOS: {
    skaters: [
      ["David Pastrnak", "88", "RW"],
      ["Brad Marchand", "63", "LW"],
      ["Charlie Coyle", "13", "C"],
      ["Pavel Zacha", "18", "C"],
      ["Charlie McAvoy", "73", "D"],
      ["Hampus Lindholm", "27", "D"],
      ["Trent Frederic", "11", "LW"],
      ["Morgan Geekie", "39", "C"],
      ["Brandon Carlo", "25", "D"],
      ["Nikita Zadorov", "91", "D"],
    ],
    goalie: ["Jeremy Swayman", "1"],
  },
  TOR: {
    skaters: [
      ["Auston Matthews", "34", "C"],
      ["Mitch Marner", "16", "RW"],
      ["William Nylander", "88", "RW"],
      ["John Tavares", "91", "C"],
      ["Morgan Rielly", "44", "D"],
      ["Matthew Knies", "23", "LW"],
      ["Max Domi", "11", "LW"],
      ["Oliver Ekman-Larsson", "95", "D"],
      ["Chris Tanev", "8", "D"],
      ["Bobby McMann", "74", "LW"],
    ],
    goalie: ["Anthony Stolarz", "41"],
  },
  EDM: {
    skaters: [
      ["Connor McDavid", "97", "C"],
      ["Leon Draisaitl", "29", "C"],
      ["Zach Hyman", "18", "LW"],
      ["Ryan Nugent-Hopkins", "93", "LW"],
      ["Evan Bouchard", "2", "D"],
      ["Mattias Ekholm", "14", "D"],
      ["Darnell Nurse", "25", "D"],
      ["Viktor Arvidsson", "33", "RW"],
      ["Jeff Skinner", "53", "LW"],
      ["Corey Perry", "90", "RW"],
    ],
    goalie: ["Stuart Skinner", "74"],
  },
  VAN: {
    skaters: [
      ["Quinn Hughes", "43", "D"],
      ["J.T. Miller", "9", "C"],
      ["Elias Pettersson", "40", "C"],
      ["Brock Boeser", "6", "RW"],
      ["Conor Garland", "8", "RW"],
      ["Filip Hronek", "17", "D"],
      ["Jake DeBrusk", "74", "LW"],
      ["Dakota Joshua", "81", "LW"],
      ["Tyler Myers", "57", "D"],
      ["Kiefer Sherwood", "44", "RW"],
    ],
    goalie: ["Thatcher Demko", "35"],
  },
};

export function mockHockeyBoxscore(gameId: string, gameArg?: Game): HockeyBoxscore {
  const seed = SEEDS.find((s) => s.id === gameId) ?? SEEDS[0]!;
  const game = gameArg ?? build(seed);

  const buildTeamStats = (abbr: string, oppScore: number, myScore: number, oppSog: number) => {
    const roster = KNOWN_ROSTERS[abbr] ?? {
      skaters: [
        [`${abbr} Forward 1`, "19", "C"],
        [`${abbr} Forward 2`, "21", "LW"],
        [`${abbr} Forward 3`, "88", "RW"],
        [`${abbr} Defense 1`, "4", "D"],
        [`${abbr} Defense 2`, "6", "D"],
        [`${abbr} Forward 4`, "11", "C"],
      ],
      goalie: [`${abbr} Goalie`, "30"],
    };

    let remainingGoals = myScore;
    const skaters: SkaterStats[] = roster.skaters.map(([name, jersey, pos], idx) => {
      const g = remainingGoals > 0 && (idx === 0 || idx === 1 || (idx === 2 && remainingGoals > 1)) ? 1 : 0;
      if (g) remainingGoals--;
      const a = (idx % 2 === 1 && myScore > 0) || (idx === 3 && myScore > 1) ? 1 : 0;
      const sog = Math.max(0, g + ((idx * 3 + 2) % 4));
      const pm = g > 0 ? 1 : oppScore > myScore && idx > 3 ? -1 : 0;
      const min = Math.max(8, 22 - idx * 2);
      const sec = (idx * 17) % 60;
      const toi = `${min}:${pad(sec)}`;
      return {
        id: `mock:${abbr}:${jersey}`,
        name,
        jersey,
        position: pos,
        toi,
        sog,
        plus_minus: pm,
        goals: g,
        assists: a,
        points: g + a,
        hits: (idx * 2 + 1) % 5,
        blocked_shots: (idx + 1) % 4,
        penalty_minutes: idx === 5 ? 2 : 0,
      };
    });

    const goalieSaves = Math.max(0, oppSog - oppScore);
    const svPct = oppSog > 0 ? (goalieSaves / oppSog).toFixed(3).replace(/^0\./, ".") : ".000";

    const startingGoalie = abbr === game.home.abbr ? game.goalies?.home : game.goalies?.away;
    const goalieName = startingGoalie?.name ?? roster.goalie[0];
    const goalieJersey = startingGoalie?.jersey ?? roster.goalie[1];

    const goalies: GoalieStats[] = [
      {
        id: `mock:${abbr}:${goalieJersey}`,
        name: goalieName,
        jersey: goalieJersey,
        position: "G",
        toi: game.clock ? `P${game.period} ${game.clock}` : "60:00",
        saves: goalieSaves,
        shots_against: oppSog,
        save_pct: svPct,
        goals_against: oppScore,
        starter: true,
      },
    ];

    return { skaters, goalies };
  };

  const awaySog = game.sog?.away ?? 24;
  const homeSog = game.sog?.home ?? 28;
  const awayScore = game.away.score ?? 0;
  const homeScore = game.home.score ?? 0;

  const awayStats = buildTeamStats(game.away.abbr, homeScore, awayScore, homeSog);
  const homeStats = buildTeamStats(game.home.abbr, awayScore, homeScore, awaySog);

  return {
    game_id: game.id,
    game,
    away: {
      team: game.away,
      skaters: awayStats.skaters,
      goalies: awayStats.goalies,
    },
    home: {
      team: game.home,
      skaters: homeStats.skaters,
      goalies: homeStats.goalies,
    },
    updated_at: Date.now(),
  };
}
