import { useEffect, useMemo, useRef, useState } from "react";
import type { Calibration, Game, Settings } from "../types";
import { api, ApiError } from "../lib/api";
import { useGameClock } from "../lib/clock";
import { scanTvClock } from "../lib/ocr";
import { Button, Field, inputCls, Notice } from "../components/ui";
import { fmtDelay, snapDelay } from "./DelayControl";
import { usePoll } from "./usePoll";
import { errMsg } from "../lib/errors";

const gameName = (g: Game) => `${g.away.abbr} @ ${g.home.abbr} (${g.league.toUpperCase()})`;

function friendly(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.status === 409) return e.message;
    if (e.status === 404) return "The server no longer knows that game. Refresh the list and pick another.";
    if (e.status === 400) return "Enter the TV period as a number (1, 2, 3...) and the clock as minutes:seconds, like 12:34.";
  }
  return `Calibration failed: ${errMsg(e)}`;
}

/** Match the TV reading against timestamped observations, including stoppages. */
export default function Calibrate({ settings, update, live, active }: { settings: Settings; update: (p: Partial<Settings>) => void; live: Map<string, Game>; active: boolean }) {
  const raw = usePoll(api.gamesRaw, 3000, active);
  const candidates = useMemo(() => (raw.data ?? []).filter((g) => g.status === "in" && typeof g.clock_s === "number"), [raw.data]);
  const [gid, setGid] = useState("");
  const [period, setPeriod] = useState("");
  const [clock, setClock] = useState("");
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<Calibration | null>(null);
  const [err, setErr] = useState("");
  const [applied, setApplied] = useState("");

  // Optical scanning states (shutter-anchored to cancel processing latency)
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [snapAnchor, setSnapAnchor] = useState<number | null>(null);
  const [scanning, setScanning] = useState(false);
  const [scanStatus, setScanStatus] = useState("");
  const [scanNotice, setScanNotice] = useState<{ kind: "info" | "err"; msg: string } | null>(null);

  useEffect(() => { const first = candidates[0]; if (first && !candidates.some((g) => g.id === gid)) setGid(first.id); }, [candidates, gid]);
  const game = candidates.find((g) => g.id === gid);
  const shown = live.get(gid);
  const tick = useGameClock(shown);

  const handleScanClick = () => {
    setScanNotice(null);
    setErr("");
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    // Anchor timestamp at shutter capture to subtract OCR & review duration
    const t0 = performance.now();
    setSnapAnchor(t0);
    setScanning(true);
    setScanStatus("Scanning TV score bug...");
    setScanNotice(null);
    try {
      const scan = await scanTvClock(file, t0, (pct) => {
        setScanStatus(`Reading TV score bug (${pct}%)...`);
      });
      if (scan.period) setPeriod(String(scan.period));
      if (scan.clock) setClock(scan.clock);
      if (scan.period && scan.clock) {
        setScanNotice({
          kind: "info",
          msg: `Detected Period ${scan.period}, Clock ${scan.clock} (${(scan.elapsedMs / 1000).toFixed(1)}s elapsed). Review and tap Suggest Delay.`,
        });
      } else if (scan.clock) {
        setScanNotice({
          kind: "info",
          msg: `Detected Clock ${scan.clock}. Please verify or enter the Period, then tap Suggest Delay.`,
        });
      } else {
        setScanNotice({
          kind: "err",
          msg: "Could not clearly read the score bug. Please type the period and clock manually.",
        });
      }
    } catch (x) {
      setScanNotice({ kind: "err", msg: `Scan failed: ${errMsg(x)}` });
    } finally {
      setScanning(false);
      setScanStatus("");
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const run = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!game) return;
    setBusy(true); setErr(""); setRes(null); setApplied("");
    // Discount OCR + review duration so 0 ms delay is introduced
    const elapsed_ms = snapAnchor ? Math.max(0, Math.round(performance.now() - snapAnchor)) : undefined;
    try {
      setRes(await api.calibrate({
        game_id: game.id,
        tv_period: Number(period),
        tv_clock: clock.trim(),
        ...(elapsed_ms !== undefined ? { elapsed_ms } : {}),
      }));
    } catch (x) {
      setErr(friendly(x));
    } finally {
      setBusy(false);
      setSnapAnchor(null);
    }
  };

  const apply = (scope: "game" | "league" | "global") => {
    if (!res || !game) return;
    const v = snapDelay(res.delay_s);
    if (scope === "game") update({ delay_by_game: { ...settings.delay_by_game, [game.id]: v } });
    else if (scope === "league") update({ delay_by_league: { ...(settings.delay_by_league ?? {}), [game.league]: v } });
    else update({ delay_global_s: v });
    setApplied(`Applied ${fmtDelay(v)} s to ${scope === "game" ? gameName(game) : scope === "league" ? game.league.toUpperCase() : "everyone (global delay)"}.`);
  };

  return (
    <div className="rounded-xl border border-white/10 bg-ink-900 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-bold uppercase tracking-wider text-slate-400">Calibrate</h3>
        {candidates.length > 0 && (
          <div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={handleFileChange}
            />
            <Button
              variant="secondary"
              className="text-xs"
              onClick={handleScanClick}
              disabled={scanning || busy}
            >
              <svg className="h-4 w-4 shrink-0 text-accent-soft" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              {scanning ? (scanStatus || "Scanning...") : "Scan TV with Camera"}
            </Button>
          </div>
        )}
      </div>
      <p className="mt-1 text-sm text-slate-300">
        While the TV clock is ticking, enter its period and clock (or tap <strong>Scan TV</strong> with your phone camera) and submit promptly. We match it against recent feed history, including stoppages, to estimate your delay.
      </p>
      {raw.err && <div className="mt-3"><Notice kind="err">Could not load live games: {raw.err}</Notice></div>}
      {raw.loading && !raw.data && <p className="mt-3 text-sm text-slate-400">Loading live games...</p>}
      {raw.data && candidates.length === 0 && (
        <div className="mt-3"><Notice kind="info">No game is live with a running clock right now. Come back during a game to calibrate.</Notice></div>
      )}
      {scanNotice && (
        <div className="mt-3">
          <Notice kind={scanNotice.kind}>{scanNotice.msg}</Notice>
        </div>
      )}
      {candidates.length > 0 && (
        <form onSubmit={run} className="mt-4 grid gap-4 md:grid-cols-[1fr_auto]">
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Live game" htmlFor="cal-game">
              <select id="cal-game" className={inputCls} value={gid} onChange={(e) => { setGid(e.target.value); setRes(null); setErr(""); }}>
                {candidates.map((g) => <option key={g.id} value={g.id}>{gameName(g)}</option>)}
              </select>
            </Field>
            <Field label="TV period" htmlFor="cal-period" hint="1, 2, 3 ... (OT is 4 in hockey)">
              <input id="cal-period" className={`${inputCls} num`} type="number" inputMode="numeric" min={1} step={1} value={period} onChange={(e) => setPeriod(e.target.value)} required />
            </Field>
            <Field label="TV clock (M:SS)" htmlFor="cal-clock" hint="As shown on screen, e.g. 12:34">
              <input id="cal-clock" className={`${inputCls} num`} inputMode="text" placeholder="12:34" pattern="\d{1,3}:\d{2}(\.\d)?" value={clock} onChange={(e) => setClock(e.target.value)} required />
            </Field>
          </div>
          <div className="flex flex-col justify-between gap-3 rounded-lg bg-black/30 px-4 py-3 text-center md:w-52">
            <div>
              <div className="text-xs uppercase tracking-wider text-slate-400">Delayed on-screen clock</div>
              <div className="num mt-1 text-3xl font-black" aria-label="Delayed game clock">{tick.text || "--:--"}</div>
              <div className="text-xs text-slate-400">{shown?.period_label ?? "waiting for state"}</div>
            </div>
            <Button variant="primary" type="submit" disabled={busy || scanning || !game}>{busy ? "Measuring..." : "Suggest delay"}</Button>
          </div>
        </form>
      )}
      {err && <div className="mt-3"><Notice kind="err">{err}</Notice></div>}
      {res && game && (
        <div className="mt-4 rounded-lg bg-ink-800 p-4" aria-live="polite">
          <p className="text-base">Suggested delay <strong className="num text-2xl text-white">{fmtDelay(snapDelay(res.delay_s))} s</strong> <span className="num text-slate-400">&plusmn; {fmtDelay(res.uncertainty_s)} s</span></p>
          {res.warning && <div className="mt-2"><Notice kind="info">{res.warning}</Notice></div>}
          <div className="mt-3 flex flex-wrap gap-2">
            <Button variant="primary" onClick={() => apply("game")}>Apply to this game</Button>
            <Button onClick={() => apply("league")}>Apply to {game.league.toUpperCase()}</Button>
            <Button onClick={() => apply("global")}>Apply to everyone</Button>
          </div>
          {applied && <p className="mt-2 text-sm text-emerald-300">{applied}</p>}
        </div>
      )}
    </div>
  );
}
