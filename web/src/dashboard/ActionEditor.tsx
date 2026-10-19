import type { ActionEffect, Device, LightAction, RGB, TeamScope, Trigger } from "../types";
import { Button, Chip, inputCls, Switch } from "../components/ui";
import { groupTriggers } from "./triggerGroups";

const hex = (c: RGB | null) => (c ? `#${[c.r, c.g, c.b].map((n) => n.toString(16).padStart(2, "0")).join("")}` : "#000000");
const unhex = (h: string): RGB => ({ r: parseInt(h.slice(1, 3), 16), g: parseInt(h.slice(3, 5), 16), b: parseInt(h.slice(5, 7), 16) });
const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
const isWhite = (d: Device) => d.supports_color === false;

/** Effects every chosen entity offers (intersection of capabilities.effect_list). */
function commonEffects(sel: Device[]): string[] {
  if (sel.length === 0) return [];
  const lists = sel.map((d) => d.capabilities?.effect_list ?? []);
  return (lists[0] ?? []).filter((e) => lists.every((l) => l.includes(e)));
}

export function validateAction(a: LightAction, devices: Device[]): string[] {
  const p: string[] = [];
  if (a.triggers.length === 0) p.push("choose at least one trigger");
  if (a.entities.length === 0) p.push("choose at least one device");
  if (a.effect === "light_effect") {
    if (!a.light_effect) p.push("choose which built-in light effect to run");
    else if (!commonEffects(devices.filter((d) => a.entities.includes(d.entity_id))).includes(a.light_effect)) p.push(`"${a.light_effect}" is not offered by every chosen device`);
  }
  return p;
}

interface Props { a: LightAction; index: number; devices: Device[]; triggers: Trigger[]; problems: string[]; onChange: (a: LightAction) => void; onRemove: () => void }

export default function ActionEditor({ a, index, devices, triggers, problems, onChange, onRemove }: Props) {
  const uid = a.id;
  const set = <K extends keyof LightAction>(k: K, v: LightAction[K]) => onChange({ ...a, [k]: v });
  const custom = Array.isArray(a.colors);
  const cols = (Array.isArray(a.colors) ? a.colors : [{ r: 255, g: 255, b: 255 }, { r: 255, g: 0, b: 0 }]) as (RGB | null)[];
  const sel = devices.filter((d) => a.entities.includes(d.entity_id));
  const allWhite = sel.length > 0 && sel.every(isWhite);
  const someWhite = sel.some(isWhite);
  const effects = commonEffects(sel);
  const durOk = sel.length === 0 || sel.some((d) => d.supports_flash_duration || d.supports_alternate_duration);
  const spdOk = sel.length === 0 || sel.some((d) => d.supports_flash_speed || d.supports_alternate_speed);

  const pickEntity = (id: string) => {
    const entities = toggle(a.entities, id);
    const next = devices.filter((d) => entities.includes(d.entity_id));
    let n: LightAction = { ...a, entities };
    // white-only lights cannot do colour: default to a plain flash
    if (next.length > 0 && next.every(isWhite) && (a.effect === "alternate" || a.effect === "set_color")) n = { ...n, effect: "flash" };
    if (a.effect === "light_effect" && a.light_effect && !commonEffects(next).includes(a.light_effect)) n = { ...n, light_effect: "" };
    onChange(n);
  };

  return (
    <li className="rounded-xl border border-white/10 bg-ink-900 p-4" aria-label={`Action ${index + 1}`}>
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3"><Switch checked={a.enabled} onChange={(v) => set("enabled", v)} label={`Enable action ${index + 1}`} /><span className="font-semibold">Action {index + 1}</span></div>
        <Button variant="ghost" onClick={onRemove} aria-label={`Remove action ${index + 1}`}>Remove</Button>
      </div>
      {problems.length > 0 && <div role="alert" className="mb-3 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">Fix before saving: {problems.join("; ")}.</div>}
      <div className="grid gap-4 md:grid-cols-2">
        <fieldset className="md:col-span-2"><legend className="mb-1.5 text-sm font-medium">When (pick any)</legend>
          {triggers.length === 0 && <p className="text-sm text-slate-400">No triggers loaded.</p>}
          <div className="flex flex-col gap-2">
            {groupTriggers(triggers).map((g) => (
              <div key={g.key} className="flex flex-wrap items-center gap-2">
                <span className="w-28 shrink-0 text-xs font-bold uppercase tracking-wider text-slate-500">{g.label}</span>
                {g.items.map((t) => <Chip key={t.id} active={a.triggers.includes(t.id)} onClick={() => set("triggers", toggle(a.triggers, t.id))}>{t.label}</Chip>)}
              </div>
            ))}
          </div>
        </fieldset>
        <div className="flex flex-col gap-1.5"><label htmlFor={`${uid}-scope`} className="text-sm font-medium">Teams</label>
          <select id={`${uid}-scope`} className={inputCls} value={a.team_scope} onChange={(e) => set("team_scope", e.target.value as TeamScope)}>
            <option value="any">Any team</option><option value="favorites">Followed teams only</option><option value="scoring_team">Scoring team only</option>
          </select></div>
        <fieldset className="md:col-span-2"><legend className="mb-1.5 text-sm font-medium">Devices</legend>
          {devices.length === 0 ? <p className="text-sm text-slate-400">No devices synced from Home Assistant yet.</p> :
            <div className="flex flex-wrap gap-2">{devices.map((d) => (
              <Chip key={d.entity_id} active={a.entities.includes(d.entity_id)} onClick={() => pickEntity(d.entity_id)}>
                {d.name} <span className="text-xs opacity-60">{d.device_class}</span>
                {isWhite(d) && <span className="ml-1.5 rounded bg-amber-500/20 px-1.5 text-xs font-bold text-amber-300">white only</span>}
              </Chip>))}</div>}
          {someWhite && <p className="mt-2 text-xs text-amber-300">White-only lights cannot show colours, so colour effects flash on them instead.</p>}
        </fieldset>
        <div className="flex flex-col gap-1.5"><label htmlFor={`${uid}-eff`} className="text-sm font-medium">Effect</label>
          <select id={`${uid}-eff`} className={inputCls} value={a.effect} aria-describedby={`${uid}-eff-h`} onChange={(e) => set("effect", e.target.value as ActionEffect)}>
            <option value="flash">Flash</option>
            <option value="alternate" disabled={allWhite}>Alternate team colours</option>
            <option value="set_color" disabled={allWhite}>Set colour</option>
            <option value="light_effect" disabled={effects.length === 0}>Built-in light effect</option>
          </select>
          <span id={`${uid}-eff-h`} className="text-xs text-slate-400">
            {allWhite ? "All chosen lights are white-only: they flash." : effects.length === 0 ? "Built-in effects need devices that all offer the same effect." : ""}
          </span></div>
        {a.effect === "light_effect" && (
          <div className="flex flex-col gap-1.5"><label htmlFor={`${uid}-le`} className="text-sm font-medium">Light effect</label>
            <select id={`${uid}-le`} className={inputCls} value={a.light_effect ?? ""} onChange={(e) => set("light_effect", e.target.value)}>
              <option value="">Choose an effect...</option>
              {effects.map((e) => <option key={e} value={e}>{e}</option>)}
            </select></div>
        )}
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5"><label htmlFor={`${uid}-dur`} className="text-sm font-medium">Duration (s)</label>
            <input id={`${uid}-dur`} type="number" min={1} max={300} className={`${inputCls} num`} value={a.duration} onChange={(e) => set("duration", Math.min(300, Math.max(1, Number(e.target.value) || 1)))} aria-describedby={durOk ? undefined : `${uid}-dur-w`} />
            {!durOk && <span id={`${uid}-dur-w`} className="text-xs text-amber-300">Selected devices ignore duration.</span>}</div>
          <div className="flex flex-col gap-1.5"><label htmlFor={`${uid}-spd`} className="text-sm font-medium">Speed (1-10)</label>
            <input id={`${uid}-spd`} type="number" min={1} max={10} className={`${inputCls} num`} value={a.speed} onChange={(e) => set("speed", Math.min(10, Math.max(1, Number(e.target.value) || 1)))} aria-describedby={spdOk ? undefined : `${uid}-spd-w`} />
            {!spdOk && <span id={`${uid}-spd-w`} className="text-xs text-amber-300">Selected devices ignore speed.</span>}</div>
        </div>
        {(a.effect === "alternate" || a.effect === "set_color") && !allWhite && (
          <fieldset className="md:col-span-2"><legend className="mb-1.5 text-sm font-medium">Colours</legend>
            <div className="flex flex-wrap items-center gap-3">
              <Chip active={!custom} onClick={() => set("colors", "team")}>Team colours</Chip>
              <Chip active={custom} onClick={() => set("colors", cols)}>Custom</Chip>
              {custom && cols.map((c, i) => (
                <input key={i} type="color" aria-label={`Colour ${i + 1}`} value={hex(c)} className="h-10 w-12 cursor-pointer rounded border border-white/20 bg-transparent"
                  onChange={(e) => set("colors", cols.map((x, j) => (j === i ? unhex(e.target.value) : x)))} />
              ))}
            </div>
          </fieldset>
        )}
        <div className="flex items-center gap-3 md:col-span-2"><Switch checked={a.restore} onChange={(v) => set("restore", v)} label="Restore previous light state afterwards" /><span className="text-sm">Restore previous light state afterwards</span></div>
      </div>
    </li>
  );
}
