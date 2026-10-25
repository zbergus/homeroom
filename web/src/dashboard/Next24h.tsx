import { useMemo } from "react";
import type { GameLite, Settings, SyncState } from "../types";
import { startMs, timeLabel } from "../lib/format";
import { useNow } from "../lib/hooks";
import { TeamBadge } from "../components/Kiosk";
import { Card, Notice } from "../components/ui";
import { isMockUrl } from "../lib/live";
import { syncView } from "./syncing";
import type { Poll } from "./usePoll";

const DAY = 24 * 3600_000;
function until(ms: number) {
  const m = Math.max(0, Math.round(ms / 60_000));
  return m >= 60 ? `in ${Math.floor(m / 60)}h ${m % 60}m` : m <= 0 ? "starting" : `in ${m}m`;
}

export default function Next24h({ schedule, settings, sync }: { schedule: Poll<{ days: { date: string; games: GameLite[] }[] }>; settings: Settings | null; sync: SyncState }) {
  const now = useNow(30_000);
  const rows = useMemo(() => {
    if (!settings) return [];
    const seen = new Map<string, GameLite>();
    for (const d of schedule.data?.days ?? []) for (const g of d.games) seen.set(g.id, g);
    return [...seen.values()]
      .filter((g) => syncView(g, settings, sync).synced && (g.status === "in" || (g.status === "pre" && startMs(g) - now <= DAY && startMs(g) - now > -60_000)))
      .sort((a, b) => (a.status === "in" ? 0 : 1) - (b.status === "in" ? 0 : 1) || startMs(a) - startMs(b));
  }, [schedule.data, settings, sync, now]);
  const mock = isMockUrl() ? "&mock=1" : "";
  return (
    <Card title="Next 24 hours" subtitle="Watched games that are live or about to start.">
      {schedule.err && !schedule.data && <Notice kind="err">Could not load schedule: {schedule.err}</Notice>}
      {!schedule.data && !schedule.err && <p className="text-sm text-slate-400">Loading...</p>}
      {schedule.data && rows.length === 0 && <p className="py-3 text-sm text-slate-400">Nothing live or starting in the next 24 hours. Sync a game below, or star a team to watch its games automatically.</p>}
      <ul className="grid gap-2 md:grid-cols-2">
        {rows.map((g) => {
          const v = settings ? syncView(g, settings, sync) : null;
          const live = g.status === "in";
          return (
            <li key={g.id} className="flex items-center gap-3 rounded-xl bg-ink-900 px-3 py-2.5">
              <div className="flex shrink-0 -space-x-2"><TeamBadge team={g.away} size="32px" /><TeamBadge team={g.home} size="32px" /></div>
              <div className="min-w-0 flex-1">
                <div className="truncate font-semibold">{g.away.abbr} @ {g.home.abbr}{v?.auto && <span className="ml-2 rounded bg-sky-500/20 px-1.5 text-xs font-bold text-sky-300">auto</span>}</div>
                <div className={`num text-sm ${live ? "font-bold text-red-400" : "text-slate-400"}`}>
                  {live ? `Live ${g.away.score ?? 0}-${g.home.score ?? 0}${g.period_label ? ` · ${g.period_label}` : ""}` : `${g.league.toUpperCase()} · ${timeLabel(startMs(g))} · ${until(startMs(g) - now)}`}
                </div>
              </div>
              <a href={`/scoreboard?game=${encodeURIComponent(g.id)}${mock}`} target="_blank" rel="noreferrer"
                className="inline-flex min-h-[40px] shrink-0 items-center rounded-lg bg-ink-600 px-3 text-sm font-semibold hover:bg-[#2f3a56] focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent-soft">
                Open scoreboard<span className="sr-only"> for {g.away.abbr} at {g.home.abbr} in a new tab</span>
              </a>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
