import { useState } from "react";
import { inputCls } from "../components/ui";

export const snapDelay = (v: number) => Math.min(120, Math.max(0, Math.round(v * 2) / 2));
export const fmtDelay = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

/** Slider + number input for a 0..120 s delay in 0.5 s steps. */
export default function DelayControl({ id, label, value, onChange }: { id: string; label: string; value: number; onChange: (v: number) => void }) {
  const [text, setText] = useState<string | null>(null);
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
      <input id={`${id}-range`} type="range" min={0} max={120} step={0.5} value={value} aria-label={`${label} (slider)`}
        onChange={(e) => onChange(snapDelay(Number(e.target.value)))} className="h-2 w-full flex-1 cursor-pointer accent-[#1f7bff]" />
      <div className="flex items-center gap-2">
        <input id={`${id}-num`} type="number" inputMode="decimal" min={0} max={120} step={0.5} aria-label={`${label} (seconds)`}
          className={`${inputCls} num w-24 text-right`} value={text ?? fmtDelay(value)}
          onChange={(e) => { setText(e.target.value); const n = parseFloat(e.target.value); if (!Number.isNaN(n)) onChange(snapDelay(n)); }}
          onBlur={() => setText(null)} />
        <span className="text-sm text-slate-400">s</span>
      </div>
    </div>
  );
}
