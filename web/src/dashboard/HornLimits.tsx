import { useEffect, useState } from "react";
import type { Settings, SettingsPatch, Status } from "../types";
import { Button, Card, Field, inputCls, Notice, Switch } from "../components/ui";

const SCOPES: { id: NonNullable<Settings["horn_scope"]>; label: string }[] = [
  { id: "home", label: "Home team only" },
  { id: "favorites", label: "My teams (falls back to both)" },
  { id: "all", label: "Both teams" },
];

/** Horn length, fade, loudness and whose goals play one. The server trims on demand; the original files are never changed. */
export default function HornLimits({ settings, saveNow, audio }: { settings: Settings; saveNow: (p: SettingsPatch) => Promise<void>; audio?: Status["audio"] }) {
  const [max, setMax] = useState(settings.horn_max_s == null ? "" : String(settings.horn_max_s));
  const [fade, setFade] = useState(String(settings.horn_fade_ms ?? 1500));
  const [norm, setNorm] = useState(!!settings.horn_normalize);
  const [scope, setScope] = useState<NonNullable<Settings["horn_scope"]>>(settings.horn_scope ?? "favorites");
  const [msg, setMsg] = useState<{ k: "ok" | "err"; t: string } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setMax(settings.horn_max_s == null ? "" : String(settings.horn_max_s));
    setFade(String(settings.horn_fade_ms ?? 1500));
    setNorm(!!settings.horn_normalize);
    setScope(settings.horn_scope ?? "favorites");
  }, [settings.horn_max_s, settings.horn_fade_ms, settings.horn_normalize, settings.horn_scope]);

  const full = audio?.mode === "ffmpeg";
  const save = async () => {
    setMsg(null);
    const m = max.trim() === "" ? null : Number(max);
    const f = Number(fade);
    if (m !== null && !(Number.isFinite(m) && m >= 2 && m <= 120)) return setMsg({ k: "err", t: "Maximum length must be between 2 and 120 seconds, or empty for no limit." });
    if (!(Number.isFinite(f) && f >= 0 && f <= 5000)) return setMsg({ k: "err", t: "Fade must be between 0 and 5000 ms." });
    setBusy(true);
    try { await saveNow({ horn_max_s: m, horn_fade_ms: Math.round(f), horn_normalize: norm, horn_scope: scope }); setMsg({ k: "ok", t: "Saved. The next horn uses these settings." }); }
    catch (e) { setMsg({ k: "err", t: (e as Error).message }); } finally { setBusy(false); }
  };

  return (
    <Card title="Horn length and loudness" subtitle="A long horn delays the spoken announcement: Home Assistant speaks only after the horn has finished.">
      <div className="flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Maximum length (seconds)" htmlFor="horn-max" hint="2 to 120. Empty means no limit. Longer horns are cut to this.">
            <input id="horn-max" className={inputCls} inputMode="numeric" value={max} onChange={(e) => setMax(e.target.value)} placeholder="No limit" />
          </Field>
          <Field label="Fade out (ms)" htmlFor="horn-fade" hint={full ? "Applied at the cut. 0 for a hard cut." : "Needs ffmpeg: this install cuts without a fade."}>
            <input id="horn-fade" className={inputCls} inputMode="numeric" value={fade} disabled={!full} onChange={(e) => setFade(e.target.value)} />
          </Field>
          <Field label="Play horn for" htmlFor="horn-scope">
            <select id="horn-scope" className={inputCls} value={scope} onChange={(e) => setScope(e.target.value as typeof scope)}>
              {SCOPES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
          </Field>
        </div>
        <div className={`flex items-center gap-3 ${full ? "" : "opacity-50"}`}>
          <Switch checked={norm && full} onChange={setNorm} label="Even out horn loudness" disabled={!full} />
          <div><div className="text-sm font-medium">Even out horn loudness</div><div className="text-xs text-slate-400">Brings every horn to a similar level so a loud rip does not blast the room.</div></div>
        </div>
        {audio && (full
          ? <Notice kind="ok">Fade and loudness available (ffmpeg found).</Notice>
          : <Notice kind="info">Cut only: use the Docker image (ffmpeg) for fade and loudness. Long horns still stop at the limit, just abruptly.</Notice>)}
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="primary" onClick={() => void save()} disabled={busy}>Save</Button>
          {msg && <Notice kind={msg.k}>{msg.t}</Notice>}
        </div>
      </div>
    </Card>
  );
}
