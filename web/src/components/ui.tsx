import { useId } from "react";

export function Card({
  title,
  subtitle,
  children,
  actions,
  id,
}: {
  title: string;
  subtitle?: string | undefined;
  children: React.ReactNode;
  actions?: React.ReactNode | undefined;
  id?: string | undefined;
}) {
  const hid = useId();
  return (
    <section
      id={id}
      aria-labelledby={hid}
      className="panel-tactical overflow-hidden p-5 sm:p-6"
    >
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-white/5 pb-3.5">
        <div>
          <h2 id={hid} className="text-base font-bold tracking-tight text-white sm:text-lg">
            {title}
          </h2>
          {subtitle && (
            <p className="mt-0.5 font-mono text-xs uppercase tracking-wider text-slate-400">
              {subtitle}
            </p>
          )}
        </div>
        {actions && <div className="flex items-center gap-2">{actions}</div>}
      </div>
      <div>{children}</div>
    </section>
  );
}

const btn =
  "inline-flex min-h-[38px] items-center justify-center gap-2 rounded-lg px-3.5 text-xs font-semibold tracking-wide transition-all active:translate-y-px focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-50";

export function Button({
  variant = "secondary",
  className = "",
  ...p
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "danger" | "ghost" | undefined;
}) {
  const v = {
    primary:
      "bg-accent text-slate-950 font-bold hover:bg-accent-soft border border-cyan-400/40 shadow-[0_0_14px_rgba(0,212,255,0.25)]",
    secondary:
      "bg-ink-800 text-slate-200 border border-white/10 hover:bg-ink-700 hover:border-white/20 shadow-tactical-sm",
    danger:
      "bg-red-950/80 text-red-200 border border-red-500/40 hover:bg-red-900/90 shadow-[0_0_12px_rgba(230,57,70,0.25)]",
    ghost: "text-slate-300 hover:bg-white/5 hover:text-white",
  }[variant];
  return <button type="button" {...p} className={`${btn} ${v} ${className}`} />;
}

export const inputCls =
  "min-h-[38px] w-full rounded-lg border border-white/15 bg-ink-950/90 px-3 font-mono text-xs text-white placeholder:text-slate-500 transition-colors focus-visible:border-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent";

export function Field({
  label,
  hint,
  children,
  htmlFor,
}: {
  label: string;
  hint?: string | undefined;
  children: React.ReactNode;
  htmlFor?: string | undefined;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={htmlFor} className="font-mono text-xs uppercase tracking-wider text-slate-300">
        {label}
      </label>
      {children}
      {hint && <p className="text-xs text-slate-400">{hint}</p>}
    </div>
  );
}

export function Switch({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  disabled?: boolean | undefined;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-md border transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-50 ${
        checked
          ? "border-goal/60 bg-goal/20 shadow-[0_0_10px_rgba(255,159,28,0.2)]"
          : "border-white/10 bg-ink-950"
      }`}
    >
      <span
        className={`inline-flex h-4 w-4 transform items-center justify-center rounded-sm transition-transform ${
          checked
            ? "translate-x-6 bg-goal text-slate-950 shadow-sm"
            : "translate-x-1 bg-slate-400"
        }`}
      >
        <span
          className={`h-1.5 w-1.5 rounded-full ${
            checked ? "bg-amber-100 shadow-[0_0_4px_#fff]" : "bg-slate-700"
          }`}
        />
      </span>
    </button>
  );
}

export function Chip({
  active,
  onClick,
  children,
  className = "",
}: {
  active?: boolean | undefined;
  onClick?: () => void;
  children: React.ReactNode;
  className?: string | undefined;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`min-h-[32px] rounded-md border px-3 font-mono text-xs font-semibold tracking-wider transition-all focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent ${
        active
          ? "border-accent/60 bg-accent/15 text-accent shadow-[0_0_10px_rgba(0,212,255,0.2)]"
          : "border-white/10 bg-ink-950/60 text-slate-300 hover:border-white/20 hover:bg-white/5"
      } ${className}`}
    >
      {children}
    </button>
  );
}

export function Notice({
  kind,
  children,
}: {
  kind: "ok" | "err" | "info";
  children: React.ReactNode;
}) {
  const c =
    kind === "ok"
      ? "border-emerald-500/40 bg-emerald-950/40 text-emerald-200"
      : kind === "err"
        ? "border-red-500/40 bg-red-950/40 text-red-200"
        : "border-cyan-500/30 bg-ink-900 text-slate-200";

  const prefix = kind === "ok" ? "OK:" : kind === "err" ? "ERR:" : "SYS:";
  return (
    <div
      role={kind === "err" ? "alert" : "status"}
      className={`flex items-start gap-2.5 rounded-lg border px-3.5 py-2.5 text-xs ${c}`}
    >
      <span className="font-mono font-bold tracking-wider opacity-70">{prefix}</span>
      <div className="flex-1">{children}</div>
    </div>
  );
}
