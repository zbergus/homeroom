import { useCallback, useEffect, useRef, useState } from "react";

/** One transient message in a polite live region. Returns [node, show]. */
export function useToast(): [React.ReactNode, (text: string, kind?: "ok" | "err") => void] {
  const [t, setT] = useState<{ text: string; kind: "ok" | "err"; n: number } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const show = useCallback((text: string, kind: "ok" | "err" = "ok") => {
    clearTimeout(timer.current);
    setT({ text, kind, n: Date.now() });
    timer.current = setTimeout(() => setT(null), 4500);
  }, []);
  const node = (
    <div aria-live="polite" role="status" className="pointer-events-none fixed inset-x-0 bottom-4 z-30 flex justify-center px-4">
      {t && (
        <div key={t.n} className={`pointer-events-auto max-w-md rounded-xl border px-4 py-2.5 text-sm font-semibold shadow-xl ${t.kind === "ok" ? "border-emerald-500/50 bg-emerald-900/90 text-emerald-100" : "border-red-500/50 bg-red-900/90 text-red-100"}`}>{t.text}</div>
      )}
    </div>
  );
  return [node, show];
}
