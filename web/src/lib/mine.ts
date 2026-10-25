import { useEffect, useState } from "react";
import type { Game, GameLite, SyncState } from "../types";
import { api } from "./api";
import { startMs } from "./format";

/** A game is "mine" when it is synced (ticked or auto-synced) or involves a favourite team. */
export function isMine(g: Pick<GameLite, "id" | "league" | "home" | "away">, sync: SyncState): boolean {
  if ((sync.effective ?? sync.games).includes(g.id)) return true;
  return sync.favorites.some((f) => f.league === g.league && (f.abbr === g.home.abbr || f.abbr === g.away.abbr));
}

/** Sync state (favourites + synced games), refreshed so adding or removing a team in the dashboard reaches the TV. null until the first load. */
export function useSync(ms = 30_000): SyncState | null {
  const [sync, setSync] = useState<SyncState | null>(null);
  useEffect(() => {
    let dead = false;
    const load = () => api.sync().then((s) => !dead && setSync(s)).catch(() => undefined); // keep the last good value on a failed refresh
    void load();
    const i = setInterval(load, ms);
    return () => { dead = true; clearInterval(i); };
  }, [ms]);
  return sync;
}

/** The soonest not-yet-started game of mine over the next week. The live feed only carries the current slate, so this asks the schedule. */
export function useNextMine(sync: SyncState | null, enabled = true): GameLite | null {
  const [days, setDays] = useState<{ games: GameLite[] }[] | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let dead = false;
    const load = () => api.schedule(7).then((s) => !dead && setDays(s.days)).catch(() => undefined);
    void load();
    const i = setInterval(load, 5 * 60_000);
    return () => { dead = true; clearInterval(i); };
  }, [enabled]);
  if (!sync || !days) return null;
  const upcoming = days.flatMap((d) => d.games).filter((g) => g.status === "pre" && isMine(g, sync));
  return upcoming.sort((a, b) => startMs(a) - startMs(b))[0] ?? null;
}

/** `?only=mine` (alias `favorites`): the filter for Grid and Ticker. undefined = show everything; null = still loading. */
export function useOnlyMine(only: string | null): ((g: Game) => boolean) | undefined | null {
  const wanted = only === "mine" || only === "favorites" || only === "favourites";
  const sync = useSync();
  if (!wanted) return undefined;
  return sync ? (g) => isMine(g, sync) : null;
}
