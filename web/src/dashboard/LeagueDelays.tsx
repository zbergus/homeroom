import { useState } from "react";
import type { Settings } from "../types";
import { inputCls } from "../components/ui";
import { fmtDelay, snapDelay } from "./DelayControl";

function LeagueDelay({ league, value, onSet }: { league: string; value: number | undefined; onSet: (v: number | undefined) => void }) {
  const [text, setText] = useState<string | null>(null);
  const shown = text ?? (value === undefined ? "" : fmtDelay(value));
  return (
    <div className={`flex items-center gap-2 rounded-full border py-1 pl-3.5 pr-1.5 ${value === undefined ? "border-white/15" : "border-accent bg-accent/15"}`}>
      <label htmlFor={`ld-${league}`} className="text-sm font-bold">{league.toUpperCase()}</label>
      <input id={`ld-${league}`} type="number" inputMode="decimal" min={0} max={120} step={0.5} placeholder="global" value={shown}
        aria-label={`${league.toUpperCase()} delay in seconds, empty uses the global delay`}
        className={`${inputCls} num !min-h-[32px] w-[5.5rem] text-right !px-2`}
        onChange={(e) => { setText(e.target.value); const t = e.target.value.trim(); if (t === "") onSet(undefined); else { const n = parseFloat(t); if (!Number.isNaN(n)) onSet(snapDelay(n)); } }}
        onBlur={() => setText(null)} />
      <span className="pr-1.5 text-xs text-slate-400">s</span>
    </div>
  );
}

/** Per-league delay presets: written to settings.delay_by_league (replaced wholesale). */
export default function LeagueDelays({ settings, leagues, update }: { settings: Settings; leagues: string[]; update: (p: Partial<Settings>) => void }) {
  const by = settings.delay_by_league ?? {};
  const set = (l: string, v: number | undefined) => {
    const n = { ...by };
    if (v === undefined) delete n[l]; else n[l] = v;
    update({ delay_by_league: n });
  };
  return (
    <div>
      <h3 className="mb-1 text-sm font-bold uppercase tracking-wider text-slate-400">Per-league presets</h3>
      <p className="mb-2 text-sm text-slate-400">Cable, streaming and over-the-air lag differ by channel. Leave a league empty to use the global delay.</p>
      {leagues.length === 0 ? <p className="text-sm text-slate-400">No leagues enabled.</p> : (
        <div className="flex flex-wrap gap-2">{leagues.map((l) => <LeagueDelay key={l} league={l} value={by[l]} onSet={(v) => set(l, v)} />)}</div>
      )}
    </div>
  );
}
