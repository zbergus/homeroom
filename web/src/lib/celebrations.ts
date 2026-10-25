import type { CelebrationVideo, EventPayload, Game } from "../types";

/** The delayed event identifies the scorer; never consult the undelayed games API here. */
export function celebrationCandidates(event: EventPayload, videos: CelebrationVideo[]): string[] {
  if (event.type !== "goal" || !event.team) return [];
  const teamVideos = videos.filter((v) => v.league === event.league && v.abbr === event.team?.abbr);
  const ids = [event.scoring?.scorer_id, "default"].filter((id): id is string => !!id);
  return [...new Set(ids.flatMap((id) => teamVideos.filter((v) => v.player_id === id && v.url).map((v) => v.url)))];
}

export function knownScorers(games: Iterable<Game>, league: string, abbr: string) {
  const players = new Map<string, { id: string; name: string; number?: string | undefined }>();
  for (const g of games) {
    if (g.league !== league) continue;
    for (const p of g.goals) {
      if (p.team_abbr !== abbr || !p.scorer_id || !p.scorer) continue;
      players.set(p.scorer_id, { id: p.scorer_id, name: p.scorer, number: p.scorer_number ?? players.get(p.scorer_id)?.number });
    }
  }
  return [...players.values()].sort((a, b) => a.name.localeCompare(b.name));
}
