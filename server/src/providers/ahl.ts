import { periodLabel, type LeagueDef } from "../leagues.js";
import type { Game, GameStatus, Rgb, ScoringPlay, StatRow, Team } from "../types.js";
import { getJson, type Raw } from "./raw.js";

const AHL_KEY = process.env.AHL_KEY ?? "ccb91f29d6744675";
const AHL_CLIENT = process.env.AHL_CLIENT ?? "ahl";
const AHL_BASE = process.env.AHL_BASE ?? "https://lscluster.hockeytech.com/feed/index.php";

const GREY: Rgb = { r: 90, g: 98, b: 110 };
const WHITE: Rgb = { r: 255, g: 255, b: 255 };

function toAhlTeam(id: string, code: string, name: string, city: string, logo: string, score: number): Team {
  return {
    id: String(id || code),
    abbr: String(code || "???").toUpperCase(),
    name: name || city || code,
    display_name: `${city ? `${city} ` : ""}${name}`.trim(),
    logo: logo || "",
    score: Number(score) || 0,
    options: {
      primary_color_rgb: GREY,
      secondary_color_rgb: WHITE,
      alternate_color_rgb: WHITE,
    },
  };
}

export function normalizeAhlGame(league: LeagueDef, item: Raw): Game | undefined {
  if (!item?.ID) return undefined;
  const statusStr = String(item.GameStatusString || item.GameStatusStringLong || item.GameStatus || "");
  const isFinal = /final/i.test(statusStr);
  const period = Number(item.Period ?? 0) || 0;
  const isIn = !isFinal && (period > 0 || /in progress|live/i.test(statusStr));
  const status: GameStatus = isFinal ? "post" : isIn ? "in" : "pre";
  const intermission = String(item.Intermission) === "1";

  const dateStr = String(item.GameDateISO8601 || item.Date || "");
  const start = new Date(dateStr);
  const startTime = Number.isNaN(start.getTime()) ? new Date().toISOString() : start.toISOString();

  const home = toAhlTeam(
    String(item.HomeID ?? ""),
    String(item.HomeCode ?? ""),
    String(item.HomeNickname ?? item.HomeLongName ?? ""),
    String(item.HomeCity ?? ""),
    String(item.HomeLogo ?? ""),
    Number(item.HomeGoals ?? 0),
  );

  const away = toAhlTeam(
    String(item.VisitorID ?? ""),
    String(item.VisitorCode ?? ""),
    String(item.VisitorNickname ?? item.VisitorLongName ?? ""),
    String(item.VisitorCity ?? ""),
    String(item.VisitorLogo ?? ""),
    Number(item.VisitorGoals ?? 0),
  );

  const sog = item.HomeShots !== undefined && item.VisitorShots !== undefined
    ? { home: Number(item.HomeShots || 0), away: Number(item.VisitorShots || 0) }
    : undefined;

  return {
    id: `ahl:${item.ID}`,
    league: "ahl",
    sport: "hockey",
    status,
    start_time: startTime,
    period: status === "pre" ? 0 : period,
    period_label: status === "pre" ? "" : periodLabel(league, period),
    clock: status === "in" && !intermission ? String(item.GameClock || item.TimeString || "") : "",
    clock_dir: "down",
    intermission,
    home,
    away,
    linescores: { home: [], away: [] },
    stats: { home: {}, away: {} },
    goals: [],
    sog,
    authority: "espn",
  };
}

export async function fetchAhlScoreboard(league: LeagueDef): Promise<Game[]> {
  const url = `${AHL_BASE}?feed=modulekit&view=scorebar&client_code=${AHL_CLIENT}&key=${AHL_KEY}&fmt=json`;
  const data = await getJson(url);
  const items: Raw[] = data?.SiteKit?.Scorebar ?? [];
  return items.map((item) => normalizeAhlGame(league, item)).filter(Boolean) as Game[];
}

export interface AhlSummary {
  plays: ScoringPlay[];
  rows: StatRow[];
}

export function parseAhlSummary(league: LeagueDef, data: Raw, homeAbbr: string, awayAbbr: string): AhlSummary {
  const gc = data?.GC?.Gamesummary ?? {};
  const rawGoals: Raw[] = gc.goals ?? [];
  let homeScore = 0;
  let awayScore = 0;

  const plays: ScoringPlay[] = rawGoals.map((g: Raw, idx: number) => {
    const isHome = String(g.home) === "1";
    if (isHome) homeScore++;
    else awayScore++;

    const scorerObj = g.goal_scorer ?? {};
    const scorer = scorerObj.first_name && scorerObj.last_name
      ? `${scorerObj.first_name} ${scorerObj.last_name}`
      : scorerObj.last_name || undefined;

    const assists: string[] = [];
    if (g.assist1_player?.first_name && g.assist1_player?.last_name) {
      assists.push(`${g.assist1_player.first_name} ${g.assist1_player.last_name}`);
    }
    if (g.assist2_player?.first_name && g.assist2_player?.last_name) {
      assists.push(`${g.assist2_player.first_name} ${g.assist2_player.last_name}`);
    }

    const isPp = String(g.power_play) === "1";
    const isSh = String(g.short_handed) === "1";
    const isEn = String(g.empty_net) === "1";
    const strength = isPp ? "pp" : isSh ? "sh" : isEn ? "en" : "ev";

    const period = Number(g.period_id ?? 1) || 1;

    return {
      key: `ahl-${idx}-${period}-${g.time}-${homeScore}-${awayScore}`,
      period,
      period_label: periodLabel(league, period),
      clock: String(g.time ?? ""),
      team_abbr: isHome ? homeAbbr : awayAbbr,
      scorer,
      scorer_id: scorerObj.player_id ? `ahl:${scorerObj.player_id}` : undefined,
      scorer_number: scorerObj.jersey_number ? String(scorerObj.jersey_number) : undefined,
      assists,
      strength,
      home_score: homeScore,
      away_score: awayScore,
    };
  });

  const rows: StatRow[] = [];
  const shots = gc.totalShots;
  if (shots && typeof shots.home !== "undefined" && typeof shots.visitor !== "undefined") {
    rows.push({
      key: "shots",
      label: "Shots",
      home: String(shots.home),
      away: String(shots.visitor),
      home_n: Number(shots.home) || 0,
      away_n: Number(shots.visitor) || 0,
    });
  }

  return { plays, rows };
}

export async function fetchAhlGameSummary(league: LeagueDef, gameId: string, homeAbbr: string, awayAbbr: string): Promise<AhlSummary> {
  const eventId = gameId.replace(/^ahl:/, "");
  const url = `${AHL_BASE}?feed=gc&tab=gamesummary&game_id=${eventId}&key=${AHL_KEY}&client_code=${AHL_CLIENT}&fmt=json`;
  const data = await getJson(url);
  return parseAhlSummary(league, data, homeAbbr, awayAbbr);
}
