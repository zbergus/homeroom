#!/usr/bin/env node
// Records a FINISHED game's raw provider payloads (trimmed) into server/test/fixtures/replay/<league>-<id>/
// so the replay simulator (server/src/sim) can serve it offline. Dev tool only; makes a handful of polite requests.
//
//   node scripts/record-game.mjs --league nhl --espn 401892525 --date 20261017 --nhl 2026020127
//   node scripts/record-game.mjs --league epl --espn 401879263 --date 20261018
//
// --date is the ESPN scoreboard day (YYYYMMDD, US Eastern) the game was listed under. --nhl is the NHL api-web game id
// (hockey only, optional but needed for power plays and the NHL authority path).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const args = Object.fromEntries(process.argv.slice(2).reduce((a, x, i, all) => (x.startsWith("--") ? [...a, [x.slice(2), all[i + 1]]] : a), []));
const SLUG = {
  nhl: "hockey/nhl", nfl: "football/nfl", nba: "basketball/nba", mlb: "baseball/mlb", mls: "soccer/usa.1", epl: "soccer/eng.1",
  laliga: "soccer/esp.1", bundesliga: "soccer/ger.1", ucl: "soccer/uefa.champions", wnba: "basketball/wnba", ncaaf: "football/college-football", ncaah: "hockey/mens-college-hockey",
};
const league = args.league, espnId = args.espn, date = args.date;
if (!SLUG[league] || !espnId || !/^\d{8}$/.test(date ?? "")) {
  console.error("usage: record-game.mjs --league <id> --espn <eventId> --date YYYYMMDD [--nhl <gameId>]");
  process.exit(2);
}
const ESPN = "https://site.api.espn.com/apis/site/v2/sports";
const NHL = "https://api-web.nhle.com/v1";
const out = path.resolve(here, `../server/test/fixtures/replay/${league}-${espnId}`);
fs.mkdirSync(out, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function get(url) {
  await sleep(500);
  const res = await fetch(url, { headers: { "user-agent": "homeroom-recorder/0.1", "accept-encoding": "gzip" } });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
}
const write = (name, data) => {
  const s = JSON.stringify(data);
  fs.writeFileSync(path.join(out, name), s);
  console.log(`  ${name}  ${(s.length / 1024).toFixed(1)} KB`);
  return s.length;
};

// ---- trimming -------------------------------------------------------------------------------------------------------
const DROP = new Set(["links", "broadcasts", "geoBroadcasts", "highlights", "headlines", "videos", "tickets", "news", "article", "standings", "injuries", "pickcenter", "againstTheSpread", "seasonseries", "winprobability", "odds", "venue", "notes", "format", "gameInfo", "onIce", "meta", "commentary", "leaders", "uid", "guid", "linkText"]);
function strip(v) {
  if (Array.isArray(v)) return v.map(strip);
  if (v && typeof v === "object") {
    const o = {};
    for (const [k, x] of Object.entries(v)) if (!DROP.has(k)) o[k] = strip(x);
    return o;
  }
  return v;
}
const pick = (o, keys) => Object.fromEntries(keys.filter((k) => o?.[k] !== undefined).map((k) => [k, o[k]]));
function slimPlay(p) {
  const o = pick(p, ["id", "sequenceNumber", "awayScore", "homeScore", "period", "clock", "scoringPlay", "scoreValue", "wallclock", "strength", "outs", "scoreValue", "isPenalty", "isTurnover"]);
  o.type = pick(p.type ?? {}, ["id", "text", "abbreviation", "type"]);
  if (p.team?.id) o.team = { id: p.team.id };
  // only scoring plays are parsed for text/participants; everything else just feeds the timeline (keeps a game < 400 KB)
  if (!p.scoringPlay) return o;
  if (p.text) o.text = String(p.text).slice(0, 220);
  if (p.participants) o.participants = p.participants.map((x) => ({ type: x.type, athlete: pick(x.athlete ?? {}, ["id", "displayName", "shortName"]) }));
  if (p.end?.downDistanceText) o.end = pick(p.end, ["down", "distance", "downDistanceText", "shortDownDistanceText", "possessionText"]);
  if (p.teamParticipants) o.teamParticipants = p.teamParticipants;
  return o;
}
function slimSummary(s) {
  const o = {};
  o.boxscore = { teams: (s.boxscore?.teams ?? []).map((t) => ({ team: pick(t.team ?? {}, ["id", "abbreviation", "displayName"]), homeAway: t.homeAway, displayOrder: t.displayOrder, statistics: t.statistics })) };
  // baseball: pitch-by-pitch rows are ~70% of the payload and carry no state the sim needs; keep results + inning markers
  const keepPlay = (p) => league !== "mlb" || p.scoringPlay || /^(Play Result|Start Inning|End Inning|End Game|Game End)$/i.test(p.type?.text ?? "") || /inning|end/i.test(p.type?.text ?? "");
  if (s.plays) o.plays = s.plays.filter(keepPlay).map(slimPlay);
  if (s.scoringPlays) o.scoringPlays = s.scoringPlays.map(slimPlay);
  if (s.drives) o.drives = { previous: (s.drives.previous ?? []).map((d) => ({ id: d.id, description: d.description, team: d.team?.id ? { id: d.team.id } : undefined, plays: (d.plays ?? []).map(slimPlay) })) };
  if (s.keyEvents) {
    o.keyEvents = s.keyEvents.map((k) => ({
      id: k.id, type: k.type, text: String(k.text ?? "").slice(0, 200), period: k.period, clock: k.clock, scoringPlay: k.scoringPlay, shootout: k.shootout, wallclock: k.wallclock,
      team: k.team?.id ? { id: k.team.id } : undefined,
      participants: (k.participants ?? []).map((x) => ({ athlete: pick(x.athlete ?? {}, ["id", "displayName"]) })),
    }));
  }
  if (s.header) {
    const c = s.header.competitions?.[0] ?? {};
    o.header = { id: s.header.id, competitions: [{ id: c.id, date: c.date, status: c.status && pick(c.status, ["type", "period", "clock", "displayClock"]), competitors: (c.competitors ?? []).map((x) => ({ id: x.id, homeAway: x.homeAway, score: x.score, winner: x.winner, team: pick(x.team ?? {}, ["id", "abbreviation", "displayName", "name", "logo"]) })) }] };
  }
  return o;
}
const slimSchedule = (j) => ({
  // the schedule lists the whole season; the form screen only reads the last completed games
  events: (j.events ?? []).filter((ev) => ev.competitions?.[0]?.status?.type?.completed).slice(-12).map((ev) => ({
    id: ev.id, date: ev.date,
    competitions: (ev.competitions ?? []).map((c) => ({
      status: { type: pick(c.status?.type ?? {}, ["completed", "detail", "state"]) },
      competitors: (c.competitors ?? []).map((x) => ({ homeAway: x.homeAway, winner: x.winner, score: x.score, team: { id: x.team?.id, abbreviation: x.team?.abbreviation, logos: (x.team?.logos ?? []).slice(0, 1) } })),
    })),
  })),
});

// ---- record ---------------------------------------------------------------------------------------------------------
console.log(`recording ${league}:${espnId} into ${path.relative(process.cwd(), out)}`);
const base = `${ESPN}/${SLUG[league]}`;
const sb = await get(`${base}/scoreboard?dates=${date}&limit=200`);
const ev = (sb.events ?? []).find((e) => String(e.id) === String(espnId));
if (!ev) throw new Error(`event ${espnId} not on the ${date} scoreboard (try --date one day earlier/later)`);
if (ev.status?.type?.state !== "post") throw new Error(`game is not finished (${ev.status?.type?.name}); record finished games only`);
const evOut = strip(ev);
// competitor leaders are final-state but small and the pickLeader() parser reads them; keep from the original
(ev.competitions?.[0]?.competitors ?? []).forEach((c, i) => { if (c.leaders) evOut.competitions[0].competitors[i].leaders = c.leaders.map((l) => ({ name: l.name, leaders: (l.leaders ?? []).slice(0, 1).map((x) => ({ athlete: pick(x.athlete ?? {}, ["id", "displayName", "fullName", "jersey", "position", "headshot"]) })) })); });
let total = write("espn-event.json", evOut);

const sum = await get(`${base}/summary?event=${espnId}`);
total += write("espn-summary.json", slimSummary(sum));

const teamIds = (ev.competitions[0].competitors ?? []).map((c) => c.team.id);
for (const id of teamIds) {
  try {
    // team statistics are only read for hockey form rows, and are huge for baseball
    if (SLUG[league].startsWith("hockey")) total += write(`team-stats-${id}.json`, strip(await get(`${base}/teams/${id}/statistics`)));
    total += write(`team-schedule-${id}.json`, slimSchedule(await get(`${base}/teams/${id}/schedule`)));
  } catch (e) { console.warn("  team data skipped:", e.message); }
}

// players-to-watch (hockey): the game log of each side's scoreboard "points" leader, trimmed to what insight.ts reads
if (SLUG[league].startsWith("hockey")) {
  const WEB = "https://site.web.api.espn.com/apis/common/v3/sports";
  const ids = new Set();
  for (const c of ev.competitions[0].competitors ?? []) {
    const cat = (c.leaders ?? []).find((l) => l.name === "points") ?? (c.leaders ?? []).find((l) => l.name === "goals");
    const id = cat?.leaders?.[0]?.athlete?.id;
    if (id) ids.add(String(id));
  }
  for (const id of ids) {
    try {
      const g = await get(`${WEB}/${SLUG[league]}/athletes/${id}/gamelog`);
      const slimLog = {
        names: g.names,
        events: Object.fromEntries(Object.entries(g.events ?? {}).map(([k, e]) => [k, { gameDate: e.gameDate, atVs: e.atVs, opponent: { abbreviation: e.opponent?.abbreviation } }])),
        seasonTypes: (g.seasonTypes ?? []).slice(0, 1).map((st) => ({ summary: st.summary && { stats: (st.summary.stats ?? []).slice(0, 1) }, categories: (st.categories ?? []).map((c) => ({ events: (c.events ?? []).map((e) => ({ eventId: e.eventId, stats: e.stats })) })) })),
      };
      total += write(`gamelog-${id}.json`, slimLog);
    } catch (e) { console.warn("  gamelog skipped:", e.message); }
  }
}

const meta = { league, espn_id: espnId, date, recorded_at: new Date().toISOString().slice(0, 10), title: ev.shortName, start_time: ev.date };
if (league === "nhl" || league === "ncaah") {
  if (args.nhl) {
    const nd = (ev.date ?? "").slice(0, 10);
    // NHL days follow the local (ET) date, which is the same as the ESPN scoreboard date
    const nhlDate = `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`;
    const score = await get(`${NHL}/score/${nhlDate}`);
    const g = (score.games ?? []).find((x) => String(x.id) === String(args.nhl));
    if (!g) throw new Error(`NHL game ${args.nhl} not in score/${nhlDate} (${nd})`);
    total += write("nhl-score-game.json", g);
    const pbp = await get(`${NHL}/gamecenter/${args.nhl}/play-by-play`);
    const KEEP = new Set(["goal", "penalty", "faceoff", "period-start", "period-end", "game-end", "shootout-complete", "delayed-penalty", "stoppage"]);
    const slim = {
      ...pick(pbp, ["id", "season", "gameType", "gameDate", "startTimeUTC", "gameState", "gameScheduleState", "periodDescriptor", "clock", "displayPeriod", "maxPeriods", "gameOutcome", "regPeriods"]),
      awayTeam: pick(pbp.awayTeam, ["id", "name", "commonName", "abbrev", "score", "sog"]),
      homeTeam: pick(pbp.homeTeam, ["id", "name", "commonName", "abbrev", "score", "sog"]),
      rosterSpots: (pbp.rosterSpots ?? []).map((r) => pick(r, ["teamId", "playerId", "firstName", "lastName", "sweaterNumber", "positionCode"])),
      plays: (pbp.plays ?? []).filter((p) => KEEP.has(p.typeDescKey)).map((p) => ({
        ...pick(p, ["eventId", "periodDescriptor", "timeInPeriod", "timeRemaining", "situationCode", "typeCode", "typeDescKey", "sortOrder"]),
        details: p.details && pick(p.details, ["eventOwnerTeamId", "scoringPlayerId", "assist1PlayerId", "assist2PlayerId", "awayScore", "homeScore", "shotType", "typeCode", "descKey", "duration", "committedByPlayerId", "goalieInNetId", "reason", "secondaryReason"]),
      })),
    };
    total += write("nhl-pbp.json", slim);
    meta.nhl_id = args.nhl;
  }
}
write("meta.json", meta);
console.log(`done, ${(total / 1024).toFixed(0)} KB total`);
if (total > 400 * 1024) console.warn("WARNING: over the 400 KB per-game budget");
