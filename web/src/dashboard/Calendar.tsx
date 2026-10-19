import { useMemo, useState } from "react";
import type { GameLite, Settings, SettingsPatch, SyncState } from "../types";
import { api } from "../lib/api";
import { startMs, timeLabel } from "../lib/format";
import { TeamBadge } from "../components/Kiosk";
import { Button, Card, Chip, Notice, Switch } from "../components/ui";
import { applyToggle, hasFav, isFav, syncView } from "./syncing";
import type { Poll } from "./usePoll";

type Day = { date: string; games: GameLite[] };

function dayLabel(date: string) {
  const [y, m, d] = date.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  return { dow: dt.toLocaleDateString([], { weekday: "short" }), dom: dt.getDate(), mon: dt.toLocaleDateString([], { month: "short" }) };
}

type Fav = { league: string; abbr: string };

function GameRow({ g, synced, auto, onSync, favs, onFav }: { g: GameLite; synced: boolean; auto: boolean; onSync: (v: boolean) => void; favs: Fav[]; onFav: (f: Fav) => void }) {
  const name = `${g.away.display_name} at ${g.home.display_name}`;
  const status = g.status === "pre" ? timeLabel(startMs(g)) : g.status === "post" ? "Final" : "Live";
  const side = (t: GameLite["home"], right = false) => {
    const on = isFav(favs, g.league, t.abbr);
    return (
      <div className={`flex min-w-0 items-center gap-2 ${right ? "justify-end text-right" : ""}`}>
        {!right && <TeamBadge team={t} size="28px" />}
        <span className="min-w-0 truncate font-semibold">{t.display_name}</span>
        {g.status !== "pre" && <span className="num font-black">{t.score ?? 0}</span>}
        <button type="button" aria-pressed={on} aria-label={`${on ? "Unfollow" : "Follow"} ${t.display_name}`} onClick={() => onFav({ league: g.league, abbr: t.abbr })}
          className={`rounded p-1 text-lg leading-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent-soft ${on ? "text-amber-400" : "text-slate-600 hover:text-slate-400"}`}>
          {on ? "★" : "☆"}
        </button>
        {right && <TeamBadge team={t} size="28px" />}
      </div>
    );
  };
  return (
    <li className="grid grid-cols-[auto_1fr_auto] items-center gap-x-3 gap-y-1 rounded-xl bg-ink-900 px-3 py-2.5 sm:grid-cols-[88px_1fr_1fr_auto]">
      <div className="text-xs font-bold uppercase tracking-wider text-slate-400 sm:text-sm">
        <span className="block text-slate-200">{g.league.toUpperCase()}</span>
        <span className={g.status === "in" ? "text-red-400" : ""}>{status}</span>
        {auto && <span className="mt-0.5 block w-fit rounded bg-sky-500/20 px-1.5 text-[11px] font-bold normal-case text-sky-300" title="Watched because a team you follow is playing">auto</span>}
      </div>
      <div className="col-span-1 min-w-0 sm:col-span-1">{side(g.away)}</div>
      <div className="col-start-2 min-w-0 sm:col-start-auto">{side(g.home, true)}</div>
      <div className="col-start-3 row-start-1 row-span-2 self-center sm:col-start-auto sm:row-span-1 sm:row-start-auto"><Switch checked={synced} onChange={onSync} label={`Sync ${name}`} /></div>
    </li>
  );
}

interface Props {
  schedule: Poll<{ days: Day[] }>;
  settings: Settings | null;
  sync: SyncState;
  setSync: (s: SyncState) => void;
  saveNow: (p: SettingsPatch) => Promise<void>;
}

export default function Calendar({ schedule, settings, sync, setSync, saveNow }: Props) {
  const days = schedule.data?.days ?? null;
  const [sel, setSel] = useState(0);
  const [league, setLeague] = useState("all");
  const [saveErr, setSaveErr] = useState("");

  const day = days?.[Math.min(sel, Math.max(0, (days?.length ?? 1) - 1))];
  const leagues = useMemo(() => [...new Set((days ?? []).flatMap((d) => d.games.map((g) => g.league)))], [days]);
  const games = useMemo(() => {
    const list = (day?.games ?? []).filter((g) => league === "all" || g.league === league);
    return [...list].sort((a, b) => Number(hasFav(b, sync.favorites)) - Number(hasFav(a, sync.favorites))); // stable: favourites first
  }, [day, league, sync.favorites]);
  const view = (g: GameLite) => (settings ? syncView(g, settings, sync) : { synced: sync.games.includes(g.id), auto: false, autoEligible: false });

  const toggleGame = async (g: GameLite, on: boolean) => {
    if (!settings) return;
    const prevSync = sync, prevEx = settings.sync_excluded ?? [];
    const next = applyToggle(g, on, settings, sync);
    setSync({ ...sync, games: next.games }); setSaveErr("");
    try {
      await api.putSync({ games: next.games });
      if (JSON.stringify(next.excluded) !== JSON.stringify(prevEx)) await saveNow({ sync_excluded: next.excluded });
    } catch (e) {
      setSync(prevSync);
      void api.putSync({ games: prevSync.games }).catch(() => undefined);
      setSaveErr(`Could not save sync: ${(e as Error).message}`);
    }
  };
  const toggleFav = (f: Fav) => {
    const prev = sync;
    const next = { ...sync, favorites: isFav(sync.favorites, f.league, f.abbr) ? sync.favorites.filter((x) => !(x.league === f.league && x.abbr === f.abbr)) : [...sync.favorites, f] };
    setSync(next); setSaveErr("");
    api.putSync({ favorites: next.favorites }).catch((e: Error) => { setSync(prev); setSaveErr(`Could not save favourites: ${e.message}`); });
  };
  const syncFollowed = async () => {
    const ids = (days ?? []).flatMap((d) => d.games).filter((g) => g.status !== "post" && hasFav(g, sync.favorites)).map((g) => g.id);
    const prev = sync; const games = [...new Set([...sync.games, ...ids])];
    setSync({ ...sync, games }); setSaveErr("");
    try {
      await api.putSync({ games });
      const ex = (settings?.sync_excluded ?? []).filter((x) => !ids.includes(x));
      if (settings && ex.length !== (settings.sync_excluded ?? []).length) await saveNow({ sync_excluded: ex });
    } catch (e) { setSync(prev); setSaveErr(`Could not save sync: ${(e as Error).message}`); }
  };

  return (
    <Card title="Calendar" subtitle="Pick the games Homeroom should watch. Starred teams are watched automatically (see Automation). Synced games drive the TV scoreboard, lights and horn."
      actions={<Button onClick={() => void syncFollowed()} disabled={!sync.favorites.length}>Sync all followed teams ({sync.favorites.length})</Button>}>
      {schedule.err && !days && <Notice kind="err">Could not load schedule: {schedule.err}</Notice>}
      {saveErr && <Notice kind="err">{saveErr}</Notice>}
      {!days && !schedule.err && <p className="text-slate-400">Loading schedule...</p>}
      {days && (
        <>
          <div role="tablist" aria-label="Day" className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-2">
            {days.map((d, i) => {
              const l = dayLabel(d.date); const n = d.games.filter((g) => view(g).synced).length;
              return (
                <button key={d.date} role="tab" aria-selected={i === sel} onClick={() => setSel(i)}
                  className={`relative min-w-[64px] shrink-0 rounded-xl border px-3 py-2 text-center focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent-soft ${i === sel ? "border-accent bg-accent/20" : "border-white/10 bg-ink-900 hover:bg-white/5"}`}>
                  <span className="block text-xs font-bold uppercase tracking-wide text-slate-400">{i === 0 ? "Today" : l.dow}</span>
                  <span className="block text-xl font-black">{l.dom}</span>
                  <span className="block text-[11px] text-slate-400">{d.games.length} games{n ? ` · ${n} synced` : ""}</span>
                </button>
              );
            })}
          </div>
          <div className="my-3 flex flex-wrap gap-2" role="group" aria-label="League filter">
            <Chip active={league === "all"} onClick={() => setLeague("all")}>All</Chip>
            {leagues.map((l) => <Chip key={l} active={league === l} onClick={() => setLeague(l)}>{l.toUpperCase()}</Chip>)}
          </div>
          {games.length === 0 ? <p className="py-6 text-center text-slate-400">No games for this day.</p> : (
            <ul className="flex flex-col gap-2">
              {games.map((g) => { const v = view(g); return <GameRow key={g.id} g={g} synced={v.synced} auto={v.auto} onSync={(on) => void toggleGame(g, on)} favs={sync.favorites} onFav={toggleFav} />; })}
            </ul>
          )}
        </>
      )}
    </Card>
  );
}
