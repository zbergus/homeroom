import type { GameLite, Settings, SyncState, TeamRef } from "../types";

export const isFav = (favs: TeamRef[], league: string, abbr: string) => favs.some((f) => f.league === league && f.abbr === abbr);
export const hasFav = (g: GameLite, favs: TeamRef[]) => isFav(favs, g.league, g.home.abbr) || isFav(favs, g.league, g.away.abbr);

interface SyncView { synced: boolean; auto: boolean; autoEligible: boolean }

/** Mirrors the server: a game is synced when picked explicitly, or when it holds a favourite and was not opted out. */
export function syncView(g: GameLite, s: Settings, sync: SyncState): SyncView {
  const explicit = sync.games.includes(g.id);
  const autoEligible = !!s.auto_sync_favorites && hasFav(g, sync.favorites);
  const auto = !explicit && autoEligible && !(s.sync_excluded ?? []).includes(g.id);
  return { synced: explicit || auto, auto, autoEligible };
}

/** Next sync + sync_excluded for flipping one game. ON: add, un-exclude. OFF: remove, and exclude if it would stay auto-synced. */
export function applyToggle(g: GameLite, on: boolean, s: Settings, sync: SyncState): { games: string[]; excluded: string[] } {
  const excluded = s.sync_excluded ?? [];
  const eligible = syncView(g, s, sync).autoEligible;
  if (on) return { games: [...new Set([...sync.games, g.id])], excluded: excluded.filter((x) => x !== g.id) };
  return { games: sync.games.filter((x) => x !== g.id), excluded: eligible ? [...new Set([...excluded, g.id])] : excluded };
}
