import { Switch } from "../components/ui";

export default function SwitchRow({ checked, onChange, label, help, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; help: string; disabled?: boolean | undefined }) {
  return (
    <li className="flex items-start gap-4 rounded-xl bg-ink-900 px-4 py-3">
      <Switch checked={checked} onChange={onChange} label={label} disabled={disabled} />
      <div className="min-w-0"><div className="font-semibold">{label}</div><p className="text-sm text-slate-400">{help}</p></div>
    </li>
  );
}
