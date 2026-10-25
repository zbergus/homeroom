import { useEffect, useState } from "react";
import type { Settings, SettingsPatch } from "../types";
import { api } from "../lib/api";
import { Button, Card, Field, inputCls, Notice, Switch } from "../components/ui";
import { errMsg } from "../lib/errors";

export default function HASettings({ settings, saveNow }: { settings: Settings; saveNow: (p: SettingsPatch) => Promise<void> }) {
  const [url, setUrl] = useState(settings.ha.url);
  const [token, setToken] = useState(""); // write-only: only ever holds what the user just typed
  const [replacing, setReplacing] = useState(false);
  const [rest, setRest] = useState(settings.ha.fire_rest_events);
  const [base, setBase] = useState(settings.public_base_url);
  const [msg, setMsg] = useState<{ k: "ok" | "err"; t: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const tokenSet = !!settings.ha.token_set;
  useEffect(() => { setUrl(settings.ha.url); setRest(settings.ha.fire_rest_events); setBase(settings.public_base_url); }, [settings.ha.url, settings.ha.fire_rest_events, settings.public_base_url]);

  const typing = !tokenSet || replacing;
  const patch = (): SettingsPatch => ({ ha: { url: url.trim(), fire_rest_events: rest, ...(typing && token ? { token } : {}) }, public_base_url: base.trim() });
  const run = async (fn: () => Promise<string> | Promise<void>) => {
    setBusy(true); setMsg(null);
    try { const t = await fn(); setMsg({ k: "ok", t: t || "Saved." }); } catch (e) { setMsg({ k: "err", t: errMsg(e) }); } finally { setBusy(false); }
  };
  const save = () => run(async () => { await saveNow(patch()); setToken(""); setReplacing(false); });
  const test = () => run(async () => {
    await saveNow(patch()); setToken(""); setReplacing(false);
    const r = await api.haTest();
    const ok = r?.ok ?? r?.success ?? true;
    if (!ok) throw new Error(r?.error ?? r?.message ?? "Test failed.");
    return r?.message ?? "Home Assistant accepted the test event.";
  });
  const remove = () => { if (!confirm("Remove the saved Home Assistant token?")) return; void run(async () => { await saveNow({ ha: { clear_token: true } }); return "Token removed."; }); };

  return (
    <Card title="Home Assistant" subtitle="Optional direct REST events. The drop-in integration needs no config here.">
      <form className="grid gap-4 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); void save(); }}>
        <Field label="Home Assistant URL" htmlFor="ha-url" hint="e.g. http://homeassistant.local:8123">
          <input id="ha-url" className={inputCls} value={url} onChange={(e) => setUrl(e.target.value)} placeholder="http://homeassistant.local:8123" inputMode="url" autoComplete="off" />
        </Field>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="ha-token" className="text-sm font-medium text-slate-200">Long-lived access token</label>
          {typing ? (
            <div className="flex gap-2">
              <input id="ha-token" className={inputCls} type="password" value={token} onChange={(e) => setToken(e.target.value)} autoComplete="new-password" placeholder={tokenSet ? "Paste the new token" : "Paste a token"} />
              {replacing && <Button onClick={() => { setReplacing(false); setToken(""); }}>Cancel</Button>}
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <span id="ha-token" className="inline-flex min-h-[40px] items-center gap-2 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 text-sm font-semibold text-emerald-200">Token saved</span>
              <Button onClick={() => setReplacing(true)}>Replace</Button>
              <Button variant="danger" onClick={remove} disabled={busy}>Remove</Button>
            </div>
          )}
          <p className="text-xs text-slate-400">Write-only: once saved it is never shown again.</p>
        </div>
        <Field label="Public base URL" htmlFor="ha-base" hint="Must be reachable by your speakers; used in horn URLs.">
          <input id="ha-base" className={inputCls} value={base} onChange={(e) => setBase(e.target.value)} placeholder="http://192.168.1.10:8080" inputMode="url" />
        </Field>
        <div className="flex items-center gap-3 self-end pb-2">
          <Switch checked={rest} onChange={setRest} label="Fire REST events" />
          <div><div className="text-sm font-medium">Fire REST events</div><div className="text-xs text-slate-400">Posts homeroom_* events to HA.</div></div>
        </div>
        <p className="rounded-lg bg-ink-900 px-3 py-2 text-sm text-slate-300 sm:col-span-2">
          Pick one path for lights: the HA integration or REST events. Using both fires every automation twice.
        </p>
        <div className="flex flex-wrap items-center gap-2 sm:col-span-2">
          <Button variant="primary" type="submit" disabled={busy}>Save</Button>
          <Button onClick={() => void test()} disabled={busy || !url}>Test connection</Button>
          {msg && <Notice kind={msg.k}>{msg.t}</Notice>}
        </div>
      </form>
    </Card>
  );
}
