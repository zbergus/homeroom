import { useEffect, useRef, useState } from "react";

export function useNow(intervalMs = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const i = setInterval(() => setNow(Date.now()), intervalMs); return () => clearInterval(i); }, [intervalMs]);
  return now;
}

/** Kiosk chrome: lock scrolling, hide cursor (via .kiosk class on the root), request a Wake Lock. */
export function useKiosk() {
  useEffect(() => {
    document.documentElement.classList.add("kiosk-html");
    let lock: { release: () => Promise<void> } | null = null;
    let dead = false;
    const acquire = async () => {
      try {
        const nav = navigator as Navigator & { wakeLock?: { request: (t: "screen") => Promise<{ release: () => Promise<void> }> } };
        if (nav.wakeLock && document.visibilityState === "visible") lock = await nav.wakeLock.request("screen");
      } catch { /* denied or unsupported */ }
    };
    void acquire();
    const vis = () => { if (!dead && document.visibilityState === "visible") void acquire(); };
    document.addEventListener("visibilitychange", vis);
    return () => {
      dead = true;
      document.documentElement.classList.remove("kiosk-html");
      document.removeEventListener("visibilitychange", vis);
      void lock?.release();
    };
  }, []);
}

/** Debounced callback; always calls the latest fn. */
export function useDebouncedCallback<A extends unknown[]>(fn: (...a: A) => void, ms: number) {
  const f = useRef(fn); f.current = fn;
  const t = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => () => clearTimeout(t.current), []);
  return (...a: A) => { clearTimeout(t.current); t.current = setTimeout(() => f.current(...a), ms); };
}

export function useQueryParam(name: string): string | null {
  return new URLSearchParams(location.search).get(name);
}

type Orientation = "portrait" | "landscape";
export function useOrientation(): Orientation {
  const get = (): Orientation => (window.innerHeight > window.innerWidth ? "portrait" : "landscape");
  const [o, setO] = useState(get);
  useEffect(() => { const f = () => setO(get()); window.addEventListener("resize", f); return () => window.removeEventListener("resize", f); }, []);
  return o;
}

/** Calls `fn` every `ms` while mounted (latest fn); returns a counter that increments each time. */
export function useTicker(ms: number): number {
  const [n, setN] = useState(0);
  useEffect(() => { const i = setInterval(() => setN((x) => x + 1), ms); return () => clearInterval(i); }, [ms]);
  return n;
}
