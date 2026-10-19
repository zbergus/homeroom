import { useState } from "react";
import type { League, Settings, SettingsPatch } from "../types";
import { Card, Notice, Switch } from "../components/ui";
import { errMsg } from "../lib/errors";

export default function Leagues({ leagues, settings, saveNow }: { leagues: League[]; settings: Settings; saveNow: (p: SettingsPatch) => Promise<void> }) {
  const enabled = settings.enabled_leagues ?? leagues.map((l) => l.id);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const toggle = async (id: string, on: boolean) => {
    const next = on ? [...new Set([...enabled, id])] : enabled.filter((x) => x !== id);
    if (next.length === 0) { setErr("Keep at least one league enabled."); return; }
    setBusy(true); setErr("");
    try { await saveNow({ enabled_leagues: next }); } catch (e) { setErr(`Could not save: ${errMsg(e)}`); } finally { setBusy(false); }
  };
  return (
    <Card title="Leagues" subtitle="Disabled leagues stop being polled: no schedule, no live updates, less traffic to ESPN.">
      {err && <div className="mb-3"><Notice kind="err">{err}</Notice></div>}
      {leagues.length === 0 && <p className="text-sm text-slate-400">No leagues available.</p>}
      <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {leagues.map((l) => {
          const on = enabled.includes(l.id);
          return (
            <li key={l.id} className="flex items-center gap-3 rounded-xl bg-ink-900 px-4 py-3">
              <Switch checked={on} onChange={(v) => void toggle(l.id, v)} label={`Poll ${l.name}`} disabled={busy} />
              <div className="min-w-0"><div className="truncate font-semibold">{l.name}</div><div className="text-xs capitalize text-slate-400">{l.sport ?? l.id.toUpperCase()}</div></div>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
