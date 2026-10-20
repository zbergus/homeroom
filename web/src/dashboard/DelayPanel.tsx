import { useState } from "react";
import type { Game, GameLite, Settings, SyncState } from "../types";
import { api } from "../lib/api";
import { Button, Card, inputCls, Notice } from "../components/ui";
import Calibrate from "./Calibrate";
import DelayControl, { fmtDelay } from "./DelayControl";
import LeagueDelays from "./LeagueDelays";
import { errMsg } from "../lib/errors";

interface Props { settings: Settings; update: (p: Partial<Settings>) => void; games: GameLite[]; sync: SyncState; leagues: string[]; live: Map<string, Game>; active: boolean }

export default function DelayPanel({ settings, update, games, sync, leagues, live, active }: Props) {
  const [msg, setMsg] = useState<{ k: "ok" | "err"; t: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [add, setAdd] = useState("");
  const g = settings.delay_global_s;
  const by = settings.delay_by_game ?? {};
  const byL = settings.delay_by_league ?? {};
  const label = (id: string) => { const x = games.find((q) => q.id === id); return x ? `${x.away.abbr} @ ${x.home.abbr} (${x.league.toUpperCase()})` : id; };
  const candidates = games.filter((x) => (sync.games.includes(x.id) || x.status === "in") && !(x.id in by));

  const testGoal = async () => {
    setBusy(true); setMsg(null);
    try {
      const r = await api.trigger({ trigger: "goal" });
      const say = r.event?.natural_text ? ` Will say: “${r.event.natural_text}”` : "";
      setMsg({ k: "ok", t: `Test goal fired (horn + TTS; scorer is Test Player).${say}` });
    } catch (e) { setMsg({ k: "err", t: `Test goal failed: ${errMsg(e)}` }); }
    finally { setBusy(false); }
  };
  const testTts = async () => {
    setBusy(true); setMsg(null);
    try {
      const r = await api.trigger({ trigger: "period_start" });
      const say = r.event?.natural_text ? ` Will say: “${r.event.natural_text}”` : " (no spoken line — is TTS enabled?)";
      setMsg({ k: "ok", t: `Test TTS fired (no horn).${say}` });
    } catch (e) { setMsg({ k: "err", t: `Test TTS failed: ${errMsg(e)}` }); }
    finally { setBusy(false); }
  };
  const leagueRules = Object.entries(byL).map(([l, v]) => `${l.toUpperCase()} ${fmtDelay(v)} s`);

  return (
    <Card title="Stream delay" subtitle="Match the TV broadcast so alerts never spoil the play."
      actions={
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" onClick={() => void testGoal()} disabled={busy}>Test Goal Alert</Button>
          <Button onClick={() => void testTts()} disabled={busy}>Test TTS</Button>
        </div>
      }>
      <div className="flex flex-col gap-5">
        {msg && <Notice kind={msg.k}>{msg.t}</Notice>}
        <div className="flex flex-col gap-3">
          <h3 className="text-sm font-bold uppercase tracking-wider text-slate-400">Global delay</h3>
          <DelayControl id="delay-global" label="Global stream delay" value={g} onChange={(v) => update({ delay_global_s: v })} />
          <p className="rounded-lg bg-ink-900 px-3 py-2 text-sm text-slate-200" aria-live="polite">
            Rule: <strong className="text-white">game</strong> override, then <strong className="text-white">league</strong> preset, then <strong className="text-white">global</strong> ({fmtDelay(g)} s).
            {leagueRules.length > 0 && <> League presets: {leagueRules.join(", ")}.</>}
            {Object.keys(by).length > 0 && <> {Object.keys(by).length} game override{Object.keys(by).length > 1 ? "s" : ""}.</>}
          </p>
        </div>

        <LeagueDelays settings={settings} leagues={leagues} update={update} />

        <div>
          <h3 className="mb-2 text-sm font-bold uppercase tracking-wider text-slate-400">Per-game overrides</h3>
          {Object.keys(by).length === 0 && <p className="text-sm text-slate-400">None. Games use their league preset or the global delay.</p>}
          <ul className="flex flex-col gap-3">
            {Object.entries(by).map(([id, v]) => (
              <li key={id} className="rounded-xl bg-ink-900 p-3">
                <div className="mb-1 flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold">{label(id)}</span>
                  <Button variant="ghost" aria-label={`Remove override for ${label(id)}`} onClick={() => { const n = { ...by }; delete n[id]; update({ delay_by_game: n }); }}>Remove</Button>
                </div>
                <DelayControl id={`delay-${id}`} label={`Delay for ${label(id)}`} value={v} onChange={(x) => update({ delay_by_game: { ...by, [id]: x } })} />
              </li>
            ))}
          </ul>
          {candidates.length > 0 && (
            <div className="mt-3 flex gap-2">
              <select aria-label="Game to override" className={inputCls} value={add} onChange={(e) => setAdd(e.target.value)}>
                <option value="">Add override for a synced or live game...</option>
                {candidates.map((x) => <option key={x.id} value={x.id}>{label(x.id)}</option>)}
              </select>
              <Button disabled={!add} onClick={() => { update({ delay_by_game: { ...by, [add]: byL[games.find((q) => q.id === add)?.league ?? ""] ?? g } }); setAdd(""); }}>Add</Button>
            </div>
          )}
        </div>

        <Calibrate settings={settings} update={update} live={live} active={active} />
      </div>
    </Card>
  );
}
