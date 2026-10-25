import { useId } from "react";

export function Card({ title, subtitle, children, actions, id }: { title: string; subtitle?: string | undefined; children: React.ReactNode; actions?: React.ReactNode | undefined; id?: string | undefined }) {
  const hid = useId();
  return (
    <section id={id} aria-labelledby={hid} className="rounded-2xl border border-white/10 bg-ink-800 p-4 sm:p-6">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id={hid} className="text-lg font-bold tracking-tight text-white">{title}</h2>
          {subtitle && <p className="mt-0.5 text-sm text-slate-400">{subtitle}</p>}
        </div>
        {actions}
      </div>
      {children}
    </section>
  );
}

const btn = "inline-flex min-h-[40px] items-center justify-center gap-2 rounded-lg px-4 text-sm font-semibold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-soft disabled:cursor-not-allowed disabled:opacity-50";
export function Button({ variant = "secondary", className = "", ...p }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "danger" | "ghost" | undefined }) {
  const v = {
    primary: "bg-accent text-white hover:bg-accent-soft",
    secondary: "bg-ink-600 text-slate-100 hover:bg-[#2f3a56]",
    danger: "bg-red-600/90 text-white hover:bg-red-500",
    ghost: "text-slate-300 hover:bg-white/10",
  }[variant];
  return <button type="button" {...p} className={`${btn} ${v} ${className}`} />;
}

export const inputCls = "min-h-[40px] w-full rounded-lg border border-white/15 bg-ink-900 px-3 text-sm text-white placeholder:text-slate-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent-soft";

export function Field({ label, hint, children, htmlFor }: { label: string; hint?: string | undefined; children: React.ReactNode; htmlFor?: string | undefined }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={htmlFor} className="text-sm font-medium text-slate-200">{label}</label>
      {children}
      {hint && <p className="text-xs text-slate-400">{hint}</p>}
    </div>
  );
}

export function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean | undefined }) {
  return (
    <button
      type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative h-7 w-12 shrink-0 rounded-full transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-soft disabled:opacity-50 ${checked ? "bg-accent" : "bg-ink-600"}`}
    >
      <span className={`absolute top-0.5 h-6 w-6 rounded-full bg-white transition-all ${checked ? "left-[22px]" : "left-0.5"}`} />
    </button>
  );
}

export function Chip({ active, onClick, children, className = "" }: { active?: boolean | undefined; onClick?: () => void; children: React.ReactNode; className?: string | undefined }) {
  return (
    <button type="button" aria-pressed={active} onClick={onClick}
      className={`min-h-[36px] rounded-full border px-3.5 text-sm font-semibold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent-soft ${active ? "border-accent bg-accent/20 text-white" : "border-white/15 text-slate-300 hover:bg-white/5"} ${className}`}>
      {children}
    </button>
  );
}

export function Notice({ kind, children }: { kind: "ok" | "err" | "info"; children: React.ReactNode }) {
  const c = kind === "ok" ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-200" : kind === "err" ? "border-red-500/40 bg-red-500/10 text-red-200" : "border-white/15 bg-white/5 text-slate-300";
  return <div role={kind === "err" ? "alert" : "status"} className={`rounded-lg border px-3 py-2 text-sm ${c}`}>{children}</div>;
}
