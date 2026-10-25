import { leagueById } from "../leagues.js";
import type { Game, RosterPlayer } from "../types.js";
import { digits, getJson, optStr, str } from "./raw.js";

const NHL_BASE = process.env.NHL_BASE ?? "https://api-web.nhle.com/v1";
const ESPN_SITE_BASE = process.env.ESPN_SITE_BASE ?? "https://site.api.espn.com/apis/site/v2/sports";

const cache = new Map<string, { fetchedAt: number; players: RosterPlayer[] }>();
const CACHE_MS = 60 * 60 * 1000; // 1 hour

export async function fetchNhlRoster(abbr: string): Promise<RosterPlayer[]> {
  const d = await getJson(`${NHL_BASE}/roster/${abbr}/current`, 5000);
  const out: RosterPlayer[] = [];
  const groups = [d.forwards, d.defensemen, d.goalies];
  for (const group of groups) {
    if (!Array.isArray(group)) continue;
    for (const p of group) {
      if (!p.id) continue;
      const first = str(p.firstName?.default);
      const last = str(p.lastName?.default);
      const name = `${first} ${last}`.trim();
      if (!name) continue;
      out.push({
        id: `nhl:${p.id}`,
        name,
        number: digits(p.sweaterNumber),
        position: optStr(p.positionCode),
      });
    }
  }
  return out;
}

export async function fetchEspnRoster(leagueId: string, teamAbbr: string): Promise<RosterPlayer[]> {
  const l = leagueById(leagueId);
  const d = await getJson(`${ESPN_SITE_BASE}/${l.espn}/teams/${teamAbbr}/roster`, 5000);
  const out: RosterPlayer[] = [];
  const athletes = Array.isArray(d.athletes) ? d.athletes : [];
  for (const group of athletes) {
    const items = Array.isArray(group.items) ? group.items : [];
    for (const a of items) {
      if (!a.id) continue;
      const name = optStr(a.fullName) ?? optStr(a.displayName) ?? "";
      if (!name) continue;
      out.push({
        id: `espn:${a.id}`,
        name,
        number: digits(a.jersey),
        position: optStr(a.position?.abbreviation),
      });
    }
  }
  return out;
}

export async function getTeamRoster(leagueId: string, teamAbbr: string, games: Iterable<Game> = []): Promise<RosterPlayer[]> {
  const key = `${leagueId}:${teamAbbr.toUpperCase()}`;
  const now = Date.now();
  const cached = cache.get(key);
  let players: RosterPlayer[] = [];

  if (cached && now - cached.fetchedAt < CACHE_MS) {
    players = [...cached.players];
  } else {
    try {
      if (leagueId === "nhl") {
        players = await fetchNhlRoster(teamAbbr);
      } else {
        players = await fetchEspnRoster(leagueId, teamAbbr);
      }
      cache.set(key, { fetchedAt: now, players });
    } catch {
      players = cached ? [...cached.players] : [];
    }
  }

  // Merge any scorers seen in games that may not be on the static roster (call-ups, traded players, etc.)
  const map = new Map<string, RosterPlayer>(players.map((p) => [p.id, p]));
  for (const g of games) {
    if (g.league !== leagueId) continue;
    for (const goal of g.goals) {
      if (goal.team_abbr === teamAbbr && goal.scorer_id && goal.scorer) {
        if (!map.has(goal.scorer_id)) {
          map.set(goal.scorer_id, {
            id: goal.scorer_id,
            name: goal.scorer,
            number: goal.scorer_number,
          });
        }
      }
    }
  }

  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** In-memory lookup across cached rosters and recent games. */
export function findRosterPlayerName(leagueId: string, teamAbbr: string, playerId: string, games: Iterable<Game> = []): string | undefined {
  const cached = cache.get(`${leagueId}:${teamAbbr.toUpperCase()}`);
  if (cached) {
    const found = cached.players.find((p) => p.id === playerId);
    if (found) return found.name + (found.number ? ` #${found.number}` : "");
  }
  for (const g of games) {
    if (g.league !== leagueId) continue;
    for (const goal of g.goals) {
      if (goal.team_abbr === teamAbbr && goal.scorer_id === playerId && goal.scorer) {
        return goal.scorer + (goal.scorer_number ? ` #${goal.scorer_number}` : "");
      }
    }
  }
  return undefined;
}
