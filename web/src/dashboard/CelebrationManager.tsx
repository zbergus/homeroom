import { useCallback, useEffect, useRef, useState } from "react";
import type { CelebrationVideo, Game, TeamInfo } from "../types";
import { api } from "../lib/api";
import { knownScorers } from "../lib/celebrations";
import { errMsg } from "../lib/errors";
import { Button, Card, Field, inputCls, Notice } from "../components/ui";

const MAX_VIDEO_BYTES = 50 * 1024 * 1024;

export default function CelebrationManager({ leagues, games }: { leagues: string[]; games: Map<string, Game> }) {
  const [videos, setVideos] = useState<CelebrationVideo[]>([]);
  const [league, setLeague] = useState("");
  const [abbr, setAbbr] = useState("");
  const [playerId, setPlayerId] = useState("");
  const [teams, setTeams] = useState<TeamInfo[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<CelebrationVideo | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [notice, setNotice] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const load = useCallback(() => api.celebrations().then(setVideos), []);
  useEffect(() => { void load().catch((e) => setErr(errMsg(e))); }, [load]);
  useEffect(() => { if (!league && leagues[0]) setLeague(leagues[0]); }, [league, leagues]);
  useEffect(() => {
    setTeams([]);
    if (!league) return;
    let dead = false;
    api.teams(league).then((t) => { if (!dead) setTeams(t); }).catch((e) => { if (!dead) setErr(errMsg(e)); });
    return () => { dead = true; };
  }, [league]);
  const players = knownScorers(games.values(), league, abbr);
  const assignment = playerId.trim() || "default";
  const validPlayer = assignment === "default" || /^nhl:\d{1,12}$/.test(assignment);

  const upload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file || !league || !abbr || !validPlayer) return;
    setErr(""); setNotice("");
    if (!/\.mp4$/i.test(file.name) || file.size > MAX_VIDEO_BYTES) {
      setErr("Choose an MP4 file no larger than 50 MiB."); return;
    }
    setBusy(true);
    try {
      await api.uploadCelebration(league, abbr, assignment, file);
      setPreview(null); setFile(null);
      if (fileRef.current) fileRef.current.value = "";
      await load();
      setNotice("Video saved. Kiosk displays refresh their library automatically.");
    } catch (e) { setErr(`Upload failed: ${errMsg(e)}`); }
    finally { setBusy(false); }
  };

  const del = async (v: CelebrationVideo) => {
    if (!confirm(`Delete ${v.league.toUpperCase()} ${v.abbr} ${v.player_id === "default" ? "team celebration" : v.player_id}?`)) return;
    setBusy(true); setErr(""); setNotice("");
    try { await api.deleteCelebration(v); setPreview(null); await load(); }
    catch (e) { setErr(`Delete failed: ${errMsg(e)}`); }
    finally { setBusy(false); }
  };

  return (
    <Card title="Celebration videos" subtitle="Optional local MP4s for Scoreboard and Plate: player video → team video → built-in celebration.">
      <p className="text-sm text-slate-400">Clips play muted for up to 6 seconds, respecting your stream delay. Lights, horns and announcements are unchanged. Use H.264 MP4 for broad browser support; upload only videos you have permission to use.</p>
      {err && <Notice kind="err">{err}</Notice>}
      {notice && <p role="status" className="mt-2 text-sm text-emerald-300">{notice}</p>}
      <form onSubmit={upload} className="mt-4 grid gap-3 sm:grid-cols-2">
        <Field label="League" htmlFor="celebration-league">
          <select id="celebration-league" className={inputCls} value={league} disabled={busy} onChange={(e) => { setLeague(e.target.value); setAbbr(""); setPlayerId(""); }}>
            {leagues.map((l) => <option key={l} value={l}>{l.toUpperCase()}</option>)}
          </select>
        </Field>
        <Field label="Team" htmlFor="celebration-team">
          <select id="celebration-team" className={inputCls} value={abbr} disabled={busy} onChange={(e) => { setAbbr(e.target.value); setPlayerId(""); }}>
            <option value="">Choose team</option>
            {teams.map((t) => <option key={t.abbr} value={t.abbr}>{t.abbr} {t.name}</option>)}
          </select>
        </Field>
        <Field label="NHL player ID (optional)" htmlFor="celebration-player">
          <input id="celebration-player" className={inputCls} list="celebration-players" value={playerId} disabled={busy || league !== "nhl"} placeholder="Blank = team celebration" aria-describedby="celebration-player-help"
            onChange={(e) => setPlayerId(e.target.value)} />
          <datalist id="celebration-players">
            {players.map((p) => <option key={p.id} value={p.id}>{p.name}{p.number ? ` #${p.number}` : ""}</option>)}
          </datalist>
        </Field>
        <Field label="MP4 file (max 50 MiB)" htmlFor="celebration-file">
          <input id="celebration-file" ref={fileRef} type="file" accept="video/mp4,.mp4" disabled={busy} className={inputCls}
            onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </Field>
        <p id="celebration-player-help" className="text-xs text-slate-400 sm:col-span-2">
          NHL: choose a known scorer or enter nhl: followed by the numeric ID from the player’s NHL.com page (not their jersey number). Other leagues support team videos.
        </p>
        {!validPlayer && <p role="alert" className="text-sm text-amber-300">Use an NHL player ID such as nhl:8478402, or leave blank for the team fallback.</p>}
        <div><Button type="submit" variant="primary" disabled={busy || !file || !league || !abbr || !validPlayer}>{busy ? "Saving…" : "Upload / replace"}</Button></div>
      </form>
      <ul className="mt-5 flex flex-col gap-2">
        {!videos.length && <li className="text-sm text-slate-400">No videos uploaded. The built-in celebration remains active.</li>}
        {videos.map((v) => (
          <li key={`${v.league}/${v.abbr}/${v.player_id}`} className="flex flex-wrap items-center gap-3 rounded-xl bg-ink-900 px-3 py-2">
            <span className="min-w-0 flex-1 text-sm font-bold">{v.league.toUpperCase()} · {v.abbr} · {v.player_id === "default" ? "Team fallback" : v.player_id}</span>
            <Button disabled={busy} onClick={() => setPreview(v)}>Preview</Button>
            <Button disabled={busy} variant="danger" onClick={() => del(v)} aria-label={`Delete ${v.abbr} ${v.player_id} video`}>Delete</Button>
          </li>
        ))}
      </ul>
      {preview && (
        <div className="mt-4">
          <p className="mb-2 text-sm font-semibold">{preview.abbr} · {preview.player_id}</p>
          <video key={preview.url} src={preview.url} controls muted playsInline className="max-h-80 w-full rounded-xl bg-black" onError={() => setErr("This video could not be played. Kiosk displays will fall back automatically.")}>
            <track kind="captions" />
          </video>
          <Button onClick={() => setPreview(null)}>Close preview</Button>
        </div>
      )}
    </Card>
  );
}
