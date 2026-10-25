import { useCallback, useEffect, useRef, useState } from "react";

export interface Poll<T> { data: T | null; err: string; loading: boolean; reload: () => void; /** epoch ms of the last successful call (null = never) */ at: number | null }

/**
 * Calls `fn` on mount and every `ms` while `enabled` and the page is visible.
 * Keeps the previous data while refreshing so the UI never blanks or jumps.
 */
export function usePoll<T>(fn: () => Promise<T>, ms: number, enabled = true): Poll<T> {
  const [data, setData] = useState<T | null>(null);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(true);
  const [at, setAt] = useState<number | null>(null);
  const f = useRef(fn); f.current = fn;
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const reload = useCallback(() => {
    f.current().then((d) => { if (alive.current) { setData(d); setErr(""); setAt(Date.now()); } })
      .catch((e: Error) => { if (alive.current) setErr(e.message); })
      .finally(() => { if (alive.current) setLoading(false); });
  }, []);
  useEffect(() => {
    if (!enabled) return;
    reload();
    const i = setInterval(() => { if (document.visibilityState === "visible") reload(); }, ms);
    return () => clearInterval(i);
  }, [enabled, ms, reload]);
  return { data, err, loading, reload, at };
}
