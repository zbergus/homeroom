import { useRef } from "react";

interface TabDef<K extends string> { key: K; label: string }

const STORE = "homeroom.dash_tab";
export const loadTab = <K extends string>(keys: K[], fallback: K): K => {
  try { const v = localStorage.getItem(STORE); if (v && (keys as string[]).includes(v)) return v as K; } catch { /* ignore */ }
  return fallback;
};
export const saveTab = (k: string) => { try { localStorage.setItem(STORE, k); } catch { /* ignore */ } };

/** WAI-ARIA tabs with arrow/Home/End keys. Panels are rendered by the caller with id `panel-<key>`. */
export default function Tabs<K extends string>({ tabs, value, onChange }: { tabs: TabDef<K>[]; value: K; onChange: (k: K) => void }) {
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});
  const onKey = (e: React.KeyboardEvent, i: number) => {
    const next = e.key === "ArrowRight" ? (i + 1) % tabs.length : e.key === "ArrowLeft" ? (i + tabs.length - 1) % tabs.length : e.key === "Home" ? 0 : e.key === "End" ? tabs.length - 1 : -1;
    if (next < 0) return;
    e.preventDefault();
    const target = tabs[next];
    if (!target) return;
    onChange(target.key);
    refs.current[target.key]?.focus();
  };
  return (
    <div role="tablist" aria-label="Dashboard sections" className="mx-auto flex max-w-6xl gap-1 px-4 sm:px-6">
      {tabs.map((t, i) => {
        const on = t.key === value;
        return (
          <button key={t.key} ref={(el) => { refs.current[t.key] = el; }} role="tab" id={`tab-${t.key}`} aria-selected={on} aria-controls={`panel-${t.key}`} tabIndex={on ? 0 : -1}
            onClick={() => onChange(t.key)} onKeyDown={(e) => onKey(e, i)}
            className={`min-h-[44px] flex-1 border-b-2 px-4 text-sm font-bold transition focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent-soft sm:flex-none sm:px-6 ${on ? "border-accent text-white" : "border-transparent text-slate-400 hover:text-slate-200"}`}>
            {t.label}
          </button>
        );
      })}
    </div>
  );
}
