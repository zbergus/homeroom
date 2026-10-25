import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { leagueById } from "../leagues.js";
import type { Game, GoalieStats, HockeyBoxscore, SkaterStats, Team, TeamBoxscore } from "../types.js";
import { getJson, type Raw } from "./raw.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = path.resolve(here, "../../test/fixtures/espn-nhl-summary-live.json");

/** Parse ESPN summary format (summary.boxscore.players). */
export function parseEspnPlayerBoxscore(data: Raw, game: Game): HockeyBoxscore | null {
  const players: Raw[] = data?.boxscore?.players ?? [];
  if (!Array.isArray(players) || players.length === 0) return null;

  const parseTeam = (teamBlock: Raw, team: Team): TeamBoxscore => {
    const skaters: SkaterStats[] = [];
    const goalies: GoalieStats[] = [];

    const statsGroups: Raw[] = teamBlock.statistics ?? [];
    for (const group of statsGroups) {
      const keys: string[] = group.keys ?? [];
      const isGoalie = group.name === "goalies";
      const athletes: Raw[] = group.athletes ?? [];

      for (const item of athletes) {
        const athlete: Raw = item.athlete ?? {};
        const statValues: string[] = item.stats ?? [];
        const statMap: Record<string, string | undefined> = {};
        for (let i = 0; i < keys.length; i++) {
          const k = keys[i];
          if (k) statMap[k] = statValues[i];
        }

        const id = String(athlete.id ?? "");
        const name = String(athlete.displayName ?? athlete.shortName ?? "Unknown");
        const jersey = athlete.jersey ? String(athlete.jersey) : undefined;
        const position = athlete.position?.abbreviation ? String(athlete.position.abbreviation) : undefined;
        const headshot = athlete.headshot?.href ? String(athlete.headshot.href) : undefined;

        if (isGoalie) {
          const saves = Number(statMap["saves"]) || 0;
          const sa = Number(statMap["shotsAgainst"]) || 0;
          const ga = Number(statMap["goalsAgainst"]) || 0;
          let svPct = statMap["savePct"] ?? (sa > 0 ? (saves / sa).toFixed(3) : ".000");
          if (svPct.startsWith("0.")) svPct = svPct.slice(1);
          goalies.push({
            id,
            name,
            jersey,
            position: position ?? "G",
            headshot,
            toi: statMap["timeOnIce"] ?? "00:00",
            saves,
            shots_against: sa,
            save_pct: svPct,
            goals_against: ga,
          });
        } else {
          const goals = Number(statMap["goals"]) || 0;
          const assists = Number(statMap["assists"]) || 0;
          const sog = Number(statMap["shotsTotal"]) || 0;
          const pm = Number(statMap["plusMinus"]) || 0;
          skaters.push({
            id,
            name,
            jersey,
            position: position ?? "F",
            headshot,
            toi: statMap["timeOnIce"] ?? "00:00",
            sog,
            plus_minus: pm,
            goals,
            assists,
            points: goals + assists,
            hits: statMap["hits"] !== undefined ? Number(statMap["hits"]) || 0 : undefined,
            blocked_shots: statMap["blockedShots"] !== undefined ? Number(statMap["blockedShots"]) || 0 : undefined,
            penalty_minutes: statMap["penaltyMinutes"] !== undefined ? Number(statMap["penaltyMinutes"]) || 0 : undefined,
          });
        }
      }
    }

    return { team, skaters, goalies };
  };

  const findBlock = (abbr: string, id: string): Raw | undefined => {
    return players.find((p) => {
      const a = String(p.team?.abbreviation ?? "").toLowerCase();
      const tid = String(p.team?.id ?? "");
      return (abbr && a === abbr.toLowerCase()) || (id && tid === id);
    });
  };

  const awayBlock = findBlock(game.away.abbr, game.away.id) ?? players[0];
  const homeBlock = findBlock(game.home.abbr, game.home.id) ?? players[1];

  if (!awayBlock || !homeBlock) return null;

  return {
    game_id: game.id,
    game,
    away: parseTeam(awayBlock, game.away),
    home: parseTeam(homeBlock, game.home),
    updated_at: Date.now(),
  };
}

/** Parse NHL API official boxscore format (playerByGameStats). */
export function parseNhlApiBoxscore(data: Raw, game: Game): HockeyBoxscore | null {
  const stats: Raw = data?.playerByGameStats ?? data?.boxscore?.playerByGameStats;
  if (!stats) return null;

  const awayRaw: Raw = stats.awayTeam ?? {};
  const homeRaw: Raw = stats.homeTeam ?? {};

  const parseTeam = (raw: Raw, team: Team): TeamBoxscore => {
    const skaters: SkaterStats[] = [];
    const goalies: GoalieStats[] = [];

    const parseSkaters = (list: Raw[]) => {
      for (const item of list) {
        const id = String(item.playerId ?? "");
        const name = String(item.name?.default ?? "Unknown");
        const jersey = item.sweaterNumber ? String(item.sweaterNumber) : undefined;
        const position = item.position ? String(item.position) : undefined;
        const goals = Number(item.goals) || 0;
        const assists = Number(item.assists) || 0;
        const sog = Number(item.sog ?? item.shots) || 0;
        const pm = Number(item.plusMinus) || 0;
        skaters.push({
          id,
          name,
          jersey,
          position,
          toi: String(item.toi ?? "00:00"),
          sog,
          plus_minus: pm,
          goals,
          assists,
          points: goals + assists,
          hits: item.hits !== undefined ? Number(item.hits) || 0 : undefined,
          blocked_shots: item.blockedShots !== undefined ? Number(item.blockedShots) || 0 : undefined,
          penalty_minutes: item.pim !== undefined ? Number(item.pim) || 0 : undefined,
        });
      }
    };

    const parseGoalies = (list: Raw[]) => {
      for (const item of list) {
        const id = String(item.playerId ?? "");
        const name = String(item.name?.default ?? "Unknown");
        const jersey = item.sweaterNumber ? String(item.sweaterNumber) : undefined;
        const saves = Number(item.saves) || 0;
        const sa = Number(item.shots) || 0;
        const ga = Number(item.goalsAgainst) || 0;
        let svPct = item.savePctg ? String(item.savePctg) : sa > 0 ? (saves / sa).toFixed(3) : ".000";
        if (svPct.startsWith("0.")) svPct = svPct.slice(1);
        goalies.push({
          id,
          name,
          jersey,
          position: "G",
          toi: String(item.toi ?? "00:00"),
          saves,
          shots_against: sa,
          save_pct: svPct,
          goals_against: ga,
          starter: !!item.starter,
          decision: item.decision ? String(item.decision) : undefined,
        });
      }
    };

    parseSkaters(raw.forwards ?? []);
    parseSkaters(raw.defense ?? []);
    parseGoalies(raw.goalies ?? []);

    return { team, skaters, goalies };
  };

  return {
    game_id: game.id,
    game,
    away: parseTeam(awayRaw, game.away),
    home: parseTeam(homeRaw, game.home),
    updated_at: Date.now(),
  };
}

/** Defensive fallback boxscore when live upstream player statistics are not yet populated. */
export function fallbackBoxscore(game: Game): HockeyBoxscore {
  const awaySog = game.sog?.away ?? 0;
  const homeSog = game.sog?.home ?? 0;
  const awayScore = game.away.score ?? 0;
  const homeScore = game.home.score ?? 0;

  const awayGoalieSaves = Math.max(0, homeSog - homeScore);
  const homeGoalieSaves = Math.max(0, awaySog - awayScore);

  const awaySvPct = homeSog > 0 ? (awayGoalieSaves / homeSog).toFixed(3).replace(/^0\./, ".") : ".000";
  const homeSvPct = awaySog > 0 ? (homeGoalieSaves / awaySog).toFixed(3).replace(/^0\./, ".") : ".000";

  const extractSkaters = (abbr: string): SkaterStats[] => {
    const map = new Map<string, SkaterStats>();
    for (const goal of game.goals) {
      if (goal.team_abbr === abbr && goal.scorer) {
        const id = goal.scorer_id ?? goal.scorer;
        const existing = map.get(id) ?? {
          id,
          name: goal.scorer,
          jersey: goal.scorer_number,
          position: "F",
          toi: "15:00",
          sog: 1,
          plus_minus: 1,
          goals: 0,
          assists: 0,
          points: 0,
        };
        existing.goals += 1;
        existing.points += 1;
        map.set(id, existing);
      }
      for (const assist of goal.assists) {
        if (goal.team_abbr === abbr && assist) {
          const id = assist;
          const existing = map.get(id) ?? {
            id,
            name: assist,
            position: "F",
            toi: "15:00",
            sog: 1,
            plus_minus: 1,
            goals: 0,
            assists: 0,
            points: 0,
          };
          existing.assists += 1;
          existing.points += 1;
          map.set(id, existing);
        }
      }
    }
    return [...map.values()];
  };

  const awayGoalies: GoalieStats[] = [
    {
      id: `${game.away.abbr}:G1`,
      name: `${game.away.name} Goaltender`,
      position: "G",
      toi: game.clock || "60:00",
      saves: awayGoalieSaves,
      shots_against: homeSog,
      save_pct: awaySvPct,
      goals_against: homeScore,
    },
  ];

  const homeGoalies: GoalieStats[] = [
    {
      id: `${game.home.abbr}:G1`,
      name: `${game.home.name} Goaltender`,
      position: "G",
      toi: game.clock || "60:00",
      saves: homeGoalieSaves,
      shots_against: awaySog,
      save_pct: homeSvPct,
      goals_against: awayScore,
    },
  ];

  return {
    game_id: game.id,
    game,
    away: {
      team: game.away,
      skaters: extractSkaters(game.away.abbr),
      goalies: awayGoalies,
    },
    home: {
      team: game.home,
      skaters: extractSkaters(game.home.abbr),
      goalies: homeGoalies,
    },
    updated_at: Date.now(),
  };
}

/** Fetch live or simulated boxscore for a game. */
export async function fetchGameBoxscore(game: Game): Promise<HockeyBoxscore> {
  if (game.id === "nhl:sim") {
    try {
      if (fs.existsSync(FIXTURE_PATH)) {
        const raw = JSON.parse(await fs.promises.readFile(FIXTURE_PATH, "utf-8")) as Raw;
        const parsed = parseEspnPlayerBoxscore(raw, game);
        if (parsed) return parsed;
      }
    } catch {
      // ignore and use fallback
    }
    return fallbackBoxscore(game);
  }

  const [leagueId, eventId] = game.id.split(":");
  if (!leagueId || !eventId) return fallbackBoxscore(game);

  // NHL official API
  if (leagueId === "nhl" && game.nhl_id) {
    try {
      const nhlBase = process.env.NHL_BASE ?? "https://api-web.nhle.com/v1";
      const nhlData = await getJson(`${nhlBase}/gamecenter/${game.nhl_id}/boxscore`, 5000);
      const parsed = parseNhlApiBoxscore(nhlData, game);
      if (parsed && (parsed.away.skaters.length > 0 || parsed.away.goalies.length > 0)) {
        return parsed;
      }
    } catch {
      // try ESPN summary
    }
  }

  // ESPN summary
  try {
    const league = leagueById(leagueId);
    const espnBase = process.env.ESPN_BASE ?? "https://site.api.espn.com/apis/site/v2/sports/hockey";
    const data = await getJson(`${espnBase}/${league.espn}/summary?event=${eventId}`, 5000);
    const parsed = parseEspnPlayerBoxscore(data, game);
    if (parsed && (parsed.away.skaters.length > 0 || parsed.away.goalies.length > 0)) {
      return parsed;
    }
  } catch {
    // fallback
  }

  return fallbackBoxscore(game);
}
