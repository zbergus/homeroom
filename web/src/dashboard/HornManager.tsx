import { useCallback, useEffect, useRef, useState } from "react";
import type { Horn, Settings, TeamInfo } from "../types";
import { api, hornUrl } from "../lib/api";
import { Button, Card, Field, inputCls, Notice } from "../components/ui";
import { errMsg } from "../lib/errors";

const fmtDur = (d: number) => (d >= 60 ? `${Math.floor(d / 60)}:${String(Math.round(d % 60)).padStart(2, "0")}` : `${d.toFixed(1)} s`);

/** Plays the served (trimmed) horn, so what you hear is what the speaker gets. */
function Preview({ h }: { h: Horn }) {
  const el = useRef<HTMLAudioElement | null>(null);
  const [on, setOn] = useState(false);
  useEffect(() => () => el.current?.pause(), []);
  const toggle = () => {
    if (on) { el.current?.pause(); setOn(false); return; }
    const a = new Audio(`${hornUrl(h)}?preview=${Date.now()}`);
    a.onended = () => setOn(false);
    a.onerror = () => setOn(false);
    el.current = a;
    setOn(true);
    void a.play().catch(() => setOn(false));
  };
  return <Button onClick={toggle} aria-label={`${on ? "Stop" : "Preview"} ${h.league} ${h.abbr} horn`}>{on ? "Stop" : "Preview"}</Button>;
}

export default function HornManager({ leagues, settings }: { leagues: string[]; settings?: Settings | null }) {
  const [horns, setHorns] = useState<Horn[]>([]);
  const [err, setErr] = useState("");
  const [league, setLeague] = useState("");
  const [abbr, setAbbr] = useState("");
  const [teams, setTeams] = useState<TeamInfo[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const load = useCallback(() => api.horns().then(setHorns).catch((e: Error) => setErr(e.message)), []);
  useEffect(() => { void load(); }, [load, settings?.horn_max_s, settings?.horn_fade_ms, settings?.horn_normalize]);
  useEffect(() => { if (!league) return; let dead = false; api.teams(league).then((t) => !dead && setTeams(t)).catch(() => !dead && setTeams([])); return () => { dead = true; }; }, [league]);
  useEffect(() => { if (!league && leagues[0]) setLeague(leagues[0]); }, [leagues, league]);

  const upload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file || !league) return;
    setBusy(true); setErr("");
    try {
      await api.uploadHorn(league, abbr || "default", file);
      setFile(null); setAbbr(""); if (fileRef.current) fileRef.current.value = "";
      await load();
    } catch (x) { setErr(`Upload failed: ${errMsg(x)}`); } finally { setBusy(false); }
  };
  const del = async (h: Horn) => {
    if (!confirm(`Delete horn ${h.league.toUpperCase()} ${h.abbr}?`)) return;
    try { await api.deleteHorn(h.league, h.abbr); await load(); } catch (x) { setErr(`Delete failed: ${errMsg(x)}`); }
  };

  return (
    <Card title="Goal horns" subtitle="MP3 per league or team. “League default” is the fallback for teams without their own horn.">
      {err && <Notice kind="err">{err}</Notice>}
      <form onSubmit={upload} className="mt-2 grid gap-3 sm:grid-cols-[140px_140px_1fr_auto] sm:items-end">
        <Field label="League" htmlFor="horn-league">
          <select id="horn-league" className={inputCls} value={league} onChange={(e) => { setLeague(e.target.value); setAbbr(""); }}>
            {leagues.map((l) => <option key={l} value={l}>{l.toUpperCase()}</option>)}
          </select>
        </Field>
        <Field label="Team abbr" htmlFor="horn-abbr">
          <select id="horn-abbr" className={inputCls} value={abbr} onChange={(e) => setAbbr(e.target.value)}>
            <option value="">League default</option>
            {teams.map((t) => <option key={t.abbr} value={t.abbr}>{t.abbr} {t.name}</option>)}
          </select>
        </Field>
        <Field label="MP3 file" htmlFor="horn-file">
          <input id="horn-file" ref={fileRef} type="file" accept="audio/mpeg,.mp3" onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className={`${inputCls} py-1.5 file:mr-3 file:rounded file:border-0 file:bg-ink-600 file:px-3 file:py-1 file:text-slate-100`} />
        </Field>
        <Button variant="primary" type="submit" disabled={!file || !league || busy}>Upload</Button>
      </form>
      <ul className="mt-5 flex flex-col gap-2">
        {horns.length === 0 && <li className="text-sm text-slate-400">No horns uploaded yet, so no horn will play (lights and TTS still work). Upload a team horn or a league default.</li>}
        {horns.map((h) => (
          <li key={`${h.league}/${h.abbr}`} className="flex flex-wrap items-center gap-3 rounded-xl bg-ink-900 px-3 py-2">
            <span className="w-28 text-sm font-bold">{h.league.toUpperCase()} · {h.abbr === "default" ? "Default" : h.abbr}</span>
            <span className="min-w-0 flex-1 text-sm text-slate-300">
              {h.duration_s != null && <span className="tabular-nums">{fmtDur(h.duration_s)}</span>}
              {h.trimmed && settings?.horn_max_s != null && <span className="ml-2 rounded-full bg-amber-400/15 px-2 py-0.5 text-xs font-semibold text-amber-300">will be trimmed to {settings.horn_max_s} s</span>}
              {h.processed && !h.trimmed && <span className="ml-2 rounded-full bg-sky-400/15 px-2 py-0.5 text-xs font-semibold text-sky-300">loudness adjusted</span>}
            </span>
            <Preview h={h} />
            <Button variant="danger" onClick={() => del(h)} aria-label={`Delete ${h.league} ${h.abbr} horn`}>Delete</Button>
          </li>
        ))}
      </ul>
    </Card>
  );
}
