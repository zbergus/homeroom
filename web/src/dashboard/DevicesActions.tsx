import { useEffect, useState } from "react";
import type { Device, LightAction, Trigger } from "../types";
import { api } from "../lib/api";
import { Button, Card, Notice } from "../components/ui";
import ActionEditor, { validateAction } from "./ActionEditor";
import { errMsg } from "../lib/errors";

const newAction = (): LightAction => ({ id: `act_${Math.random().toString(36).slice(2, 8)}`, enabled: true, triggers: ["any_score"], team_scope: "any", entities: [], effect: "flash", duration: 5, speed: 5, colors: "team", restore: true });

export default function DevicesActions({ triggers }: { triggers: Trigger[] }) {
  const [devices, setDevices] = useState<Device[]>([]);
  const [actions, setActions] = useState<LightAction[] | null>(null);
  const [dirty, setDirty] = useState(false);
  const [problems, setProblems] = useState<Record<string, string[]>>({});
  const [msg, setMsg] = useState<{ k: "ok" | "err"; t: string } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api.devices().then(setDevices).catch((e: Error) => setMsg({ k: "err", t: `Devices: ${e.message}` }));
    api.actions().then(setActions).catch((e: Error) => { setActions([]); setMsg({ k: "err", t: `Actions: ${e.message}` }); });
  }, []);
  const list = actions ?? [];
  const edit = (next: LightAction[]) => { setActions(next); setDirty(true); setMsg(null); setProblems({}); };
  const save = async () => {
    const probs: Record<string, string[]> = {};
    list.forEach((a) => { const p = validateAction(a, devices); if (p.length) probs[a.id] = p; });
    setProblems(probs);
    if (Object.keys(probs).length) { setMsg({ k: "err", t: "Some actions are incomplete. Nothing was saved." }); return; }
    setBusy(true);
    try { await api.putActions(list); setDirty(false); setMsg({ k: "ok", t: "Actions saved." }); }
    catch (e) { setMsg({ k: "err", t: `Save failed: ${errMsg(e)}` }); } finally { setBusy(false); }
  };
  return (
    <Card title="Triggers & light actions" subtitle="Choose what triggers each action, which lights it drives, and how they react."
      actions={<div className="flex gap-2"><Button onClick={() => edit([...list, newAction()])}>Add action</Button><Button variant="primary" onClick={() => void save()} disabled={!dirty || busy}>Save actions</Button></div>}>
      {msg && <div className="mb-3"><Notice kind={msg.k}>{msg.t}</Notice></div>}
      <h3 className="mb-2 text-sm font-bold uppercase tracking-wider text-slate-400">Devices ({devices.length})</h3>
      {devices.length === 0 ? <p className="mb-5 text-sm text-slate-400">None yet. Install the integration in Home Assistant to sync lights.</p> : (
        <ul className="mb-5 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {devices.map((d) => (
            <li key={d.entity_id} className="rounded-lg bg-ink-900 px-3 py-2"><div className="font-semibold">{d.name}{d.supports_color === false && <span className="ml-2 rounded bg-amber-500/20 px-1.5 text-xs font-bold text-amber-300">white only</span>}</div>
              <div className="break-all text-xs text-slate-400">{d.entity_id} · {d.device_class}{d.capabilities?.effect_list?.length ? ` · ${d.capabilities.effect_list.length} effects` : ""}</div></li>
          ))}
        </ul>
      )}
      <h3 className="mb-2 text-sm font-bold uppercase tracking-wider text-slate-400">Actions ({list.length})</h3>
      {!actions && <p className="text-sm text-slate-400">Loading actions...</p>}
      {actions && list.length === 0 && <p className="text-sm text-slate-400">No actions. Add one to flash lights on a goal.</p>}
      <ul className="flex flex-col gap-3">
        {list.map((a, i) => <ActionEditor key={a.id} a={a} index={i} devices={devices} triggers={triggers} problems={problems[a.id] ?? []} onChange={(n) => edit(list.map((x, j) => (j === i ? n : x)))} onRemove={() => edit(list.filter((_, j) => j !== i))} />)}
      </ul>
    </Card>
  );
}
