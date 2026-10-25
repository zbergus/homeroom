import { useEffect, useMemo, useState } from "react";
import type { League, Settings, SettingsPatch, SyncState, TeamInfo, TeamRef } from "../types";
import { api } from "../lib/api";
import { Card, Field, inputCls, Notice, Switch } from "../components/ui";
import { errMsg } from "../lib/errors";

interface Props {
  leagues: League[];
  settings: Settings;
  sync: SyncState;
  setSync: (s: SyncState) => void;
  saveNow: (p: SettingsPatch) => Promise<void>;
}

export default function TeamsAndLeagues({ leagues, settings, sync, setSync, saveNow }: Props) {
  const enabledLeagues = settings.enabled_leagues ?? leagues.map((l) => l.id);
  const [selectedLeague, setSelectedLeague] = useState<string>(() => leagues[0]?.id ?? "nhl");
  const [leagueTeams, setLeagueTeams] = useState<TeamInfo[]>([]);
  const [search, setSearch] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [loadingTeams, setLoadingTeams] = useState(false);

  // Keep selected league valid
  useEffect(() => {
    if (!selectedLeague && leagues[0]) setSelectedLeague(leagues[0].id);
  }, [leagues, selectedLeague]);

  // Load teams for selected league
  useEffect(() => {
    if (!selectedLeague) return;
    let cancelled = false;
    setLoadingTeams(true);
    api.teams(selectedLeague)
      .then((t) => {
        if (!cancelled) setLeagueTeams(t);
      })
      .catch((e) => {
        if (!cancelled) setErr(`Failed to load teams: ${errMsg(e)}`);
      })
      .finally(() => {
        if (!cancelled) setLoadingTeams(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedLeague]);

  // Toggle league enablement
  const toggleLeague = async (id: string, on: boolean) => {
    const next = on ? [...new Set([...enabledLeagues, id])] : enabledLeagues.filter((x) => x !== id);
    if (next.length === 0) {
      setErr("Keep at least one league enabled.");
      return;
    }
    setBusy(true);
    setErr("");
    try {
      await saveNow({ enabled_leagues: next });
    } catch (e) {
      setErr(`Could not save league settings: ${errMsg(e)}`);
    } finally {
      setBusy(false);
    }
  };

  // Toggle favorite team
  const toggleFav = async (ref: TeamRef) => {
    const isFav = sync.favorites.some((f) => f.league === ref.league && f.abbr === ref.abbr);
    const nextFavs = isFav
      ? sync.favorites.filter((f) => !(f.league === ref.league && f.abbr === ref.abbr))
      : [...sync.favorites, ref];

    const prevSync = sync;
    const nextSync = { ...sync, favorites: nextFavs };
    setSync(nextSync);
    setErr("");

    try {
      await api.putSync({ favorites: nextFavs });
    } catch (e) {
      setSync(prevSync);
      setErr(`Could not save favorite team: ${errMsg(e)}`);
    }
  };

  const filteredTeams = useMemo(() => {
    if (!search.trim()) return leagueTeams;
    const q = search.toLowerCase();
    return leagueTeams.filter(
      (t) => t.abbr.toLowerCase().includes(q) || t.name.toLowerCase().includes(q)
    );
  }, [leagueTeams, search]);

  return (
    <div className="flex flex-col gap-5">
      {/* 1. Favorite Teams Management */}
      <Card
        title="My Teams"
        subtitle="Follow your favorite teams so their games are watched automatically, trigger goal horns and lights, and stand out on your schedule."
      >
        {err && (
          <div className="mb-4">
            <Notice kind="err">{err}</Notice>
          </div>
        )}

        {/* Current Followed Teams Badges */}
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-400">
              Followed Teams ({sync.favorites.length})
            </span>
            {sync.favorites.length > 0 && (
              <span className="text-xs text-slate-400">Click a team to unfollow</span>
            )}
          </div>

          {sync.favorites.length === 0 ? (
            <div className="rounded-xl border border-dashed border-white/10 bg-ink-900/50 p-4 text-center text-sm text-slate-400">
              No teams followed yet. Choose a league and pick your teams below to auto-schedule their games!
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {sync.favorites.map((f) => (
                <button
                  key={`${f.league}-${f.abbr}`}
                  type="button"
                  onClick={() => void toggleFav(f)}
                  title={`Unfollow ${f.abbr} (${f.league.toUpperCase()})`}
                  className="group inline-flex items-center gap-2 rounded-lg border border-accent/40 bg-accent/15 px-3 py-1.5 text-xs font-bold text-white transition hover:border-red-500/50 hover:bg-red-500/10"
                >
                  <span className="text-amber-400">★</span>
                  <span>{f.abbr}</span>
                  <span className="rounded bg-black/30 px-1 py-0.5 text-[10px] text-slate-300">
                    {f.league.toUpperCase()}
                  </span>
                  <span className="ml-1 text-slate-400 group-hover:text-red-400">✕</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Team Search & League Picker */}
        <div className="mt-4 flex flex-col gap-3 border-t border-white/10 pt-4">
          <div className="grid gap-3 sm:grid-cols-[160px_1fr]">
            <Field label="Choose League" htmlFor="team-league">
              <select
                id="team-league"
                className={inputCls}
                value={selectedLeague}
                onChange={(e) => {
                  setSelectedLeague(e.target.value);
                  setSearch("");
                }}
              >
                {leagues.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name} ({l.id.toUpperCase()})
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Search Teams" htmlFor="team-search">
              <input
                id="team-search"
                className={inputCls}
                type="search"
                placeholder="Search by city or name (e.g. Canadiens, Wild, Chiefs)..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </Field>
          </div>

          {/* Teams Grid */}
          <div className="mt-1">
            {loadingTeams ? (
              <p className="py-6 text-center text-sm text-slate-400">Loading {selectedLeague.toUpperCase()} teams...</p>
            ) : filteredTeams.length === 0 ? (
              <p className="py-6 text-center text-sm text-slate-400">No teams match your search.</p>
            ) : (
              <div className="grid max-h-60 grid-cols-2 gap-2 overflow-y-auto rounded-xl bg-ink-900 p-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
                {filteredTeams.map((t) => {
                  const isFav = sync.favorites.some((f) => f.league === selectedLeague && f.abbr === t.abbr);
                  return (
                    <button
                      key={t.abbr}
                      type="button"
                      onClick={() => void toggleFav({ league: selectedLeague, abbr: t.abbr })}
                      className={`flex items-center justify-between rounded-lg px-2.5 py-2 text-left text-xs transition ${
                        isFav
                          ? "border border-accent/40 bg-accent/20 text-white font-bold"
                          : "border border-transparent bg-ink-800/60 text-slate-300 hover:bg-ink-700 hover:text-white"
                      }`}
                    >
                      <span className="truncate pr-1">
                        <span className="font-bold text-white">{t.abbr}</span> {t.name !== t.abbr ? t.name : ""}
                      </span>
                      <span className={isFav ? "text-amber-400" : "text-slate-500"}>★</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </Card>

      {/* 2. Enabled Leagues */}
      <Card
        title="Enabled Leagues"
        subtitle="Disabled leagues stop polling ESPN, reducing network traffic and keeping your calendar focused."
      >
        <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {leagues.map((l) => {
            const on = enabledLeagues.includes(l.id);
            return (
              <li key={l.id} className="flex items-center gap-3 rounded-xl bg-ink-900 px-4 py-3">
                <Switch
                  checked={on}
                  onChange={(v) => void toggleLeague(l.id, v)}
                  label={`Poll ${l.name}`}
                  disabled={busy}
                />
                <div className="min-w-0">
                  <div className="truncate font-semibold">{l.name}</div>
                  <div className="text-xs capitalize text-slate-400">{l.sport ?? l.id.toUpperCase()}</div>
                </div>
              </li>
            );
          })}
        </ul>
      </Card>
    </div>
  );
}
