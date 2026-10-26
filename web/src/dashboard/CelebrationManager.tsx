import { useCallback, useEffect, useRef, useState } from "react";
import type { CelebrationVideo, Game, RosterPlayer, TeamInfo } from "../types";
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
  const [customId, setCustomId] = useState("");
  const [teams, setTeams] = useState<TeamInfo[]>([]);
  const [roster, setRoster] = useState<RosterPlayer[]>([]);
  const [playerNames, setPlayerNames] = useState<Record<string, string>>({});
  const [file, setFile] = useState<File | null>(null);
  const [url, setUrl] = useState("");
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
    setRoster([]);
    if (!league) return;
    let dead = false;
    api.teams(league).then((t) => { if (!dead) setTeams(t); }).catch((e) => { if (!dead) setErr(errMsg(e)); });
    return () => { dead = true; };
  }, [league]);

  useEffect(() => {
    setRoster([]);
    setPlayerId("");
    setCustomId("");
    if (!league || !abbr) return;
    let dead = false;
    api.roster(league, abbr).then((r) => { if (!dead) setRoster(r); }).catch(() => undefined);
    return () => { dead = true; };
  }, [league, abbr]);

  const scorers = knownScorers(games.values(), league, abbr);
  const players = [...roster];
  for (const s of scorers) {
    if (!players.some((p) => p.id === s.id)) {
      players.push(s);
    }
  }
  players.sort((a, b) => a.name.localeCompare(b.name));

  // Prefetch rosters for teams that already have uploaded celebration videos so their names display
  useEffect(() => {
    const teamsToFetch = new Set(videos.map((v) => `${v.league}:${v.abbr}`));
    for (const key of teamsToFetch) {
      const [l, a] = key.split(":");
      if (!l || !a) continue;
      void api.roster(l, a).then((r) => {
        const batch: Record<string, string> = {};
        for (const p of r) {
          batch[p.id] = p.name + (p.number ? ` #${p.number}` : "");
        }
        setPlayerNames((prev) => ({ ...prev, ...batch }));
      }).catch(() => undefined);
    }
  }, [videos]);

  // Keep playerNames updated with live game scorers
  useEffect(() => {
    const next: Record<string, string> = {};
    for (const p of players) {
      next[p.id] = p.name + (p.number ? ` #${p.number}` : "");
    }
    for (const g of games.values()) {
      for (const goal of g.goals) {
        if (goal.scorer_id && goal.scorer) {
          next[goal.scorer_id] = goal.scorer + (goal.scorer_number ? ` #${goal.scorer_number}` : "");
        }
      }
    }
    if (Object.keys(next).length > 0) {
      setPlayerNames((prev) => ({ ...prev, ...next }));
    }
  }, [players, games]);

  const isCustom = playerId === "custom";
  const selectedId = isCustom ? customId.trim() : playerId.trim();
  const assignment = selectedId || "default";
  const validPlayer = assignment === "default" || /^(?:nhl|espn|iihf|ahl):\d{1,12}$/.test(assignment);
  const selectedName = players.find((p) => p.id === selectedId);
  const knownName = selectedName ? selectedName.name + (selectedName.number ? ` #${selectedName.number}` : "") : undefined;

  const upload = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanUrl = url.trim();
    if ((!file && !cleanUrl) || !league || !abbr || !validPlayer) return;
    setErr(""); setNotice("");
    setBusy(true);
    try {
      if (cleanUrl) {
        await api.importCelebration(league, abbr, assignment, cleanUrl, knownName);
        setUrl("");
      } else if (file) {
        if (!/\.mp4$/i.test(file.name) || file.size > MAX_VIDEO_BYTES) {
          setErr("Choose an MP4 file no larger than 50 MiB."); setBusy(false); return;
        }
        await api.uploadCelebration(league, abbr, assignment, file, knownName);
        setFile(null);
        if (fileRef.current) fileRef.current.value = "";
      }
      setPreview(null);
      await load();
      setNotice("Video saved. Kiosk displays refresh their library automatically.");
    } catch (e) { setErr(`Save failed: ${errMsg(e)}`); }
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
    <Card title="Celebration videos" subtitle="Optional local MP4s for every TV view: player video → team video → built-in GOAL wall.">
      <p className="text-sm text-slate-400">Clips play muted for up to 6 seconds on Scoreboard, Plate, Grid and Ticker, respecting your stream delay. Lights, horns and announcements are unchanged. Use H.264 MP4 for broad browser support; upload only videos you have permission to use.</p>
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
        <Field label="Assignment (Team or Player)" htmlFor="celebration-player">
          <select id="celebration-player" className={inputCls} value={playerId} disabled={busy || !abbr}
            onChange={(e) => setPlayerId(e.target.value)}>
            <option value="">Team celebration (fallback for any scorer)</option>
            {players.length > 0 && (
              <optgroup label={`${abbr} Roster & Scorers`}>
                {players.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}{p.number ? ` #${p.number}` : ""}{p.position ? ` (${p.position})` : ""} · {p.id}
                  </option>
                ))}
              </optgroup>
            )}
            <option value="custom">Other / Custom player ID...</option>
          </select>
        </Field>
        {isCustom && (
          <Field label="Custom Player ID" htmlFor="celebration-custom-player">
            <input id="celebration-custom-player" className={inputCls} placeholder="e.g. nhl:8478402 or espn:5080172"
              value={customId} disabled={busy} onChange={(e) => setCustomId(e.target.value)} />
          </Field>
        )}
        <Field label="MP4 file (max 50 MiB)" htmlFor="celebration-file">
          <input id="celebration-file" ref={fileRef} type="file" accept="video/mp4,.mp4" disabled={busy} className={inputCls}
            onChange={(e) => { setFile(e.target.files?.[0] ?? null); if (e.target.files?.[0]) setUrl(""); }} />
        </Field>
        <div className="sm:col-span-2">
          <Field label="Or paste Giphy link / video URL" htmlFor="celebration-url">
            <input id="celebration-url" type="url" disabled={busy} className={inputCls} placeholder="https://giphy.com/gifs/... or direct .mp4 link"
              value={url} onChange={(e) => { setUrl(e.target.value); if (e.target.value) { setFile(null); if (fileRef.current) fileRef.current.value = ""; } }} />
          </Field>
        </div>
        <p id="celebration-player-help" className="text-xs text-slate-400 sm:col-span-2">
          Select a player from the team roster or leave blank for the team fallback. For Giphy, paste any <code className="text-slate-300">giphy.com/gifs/...</code> link.
        </p>
        {!validPlayer && <p role="alert" className="text-sm text-amber-300">Use an id such as nhl:8478402, espn:5080172 or ahl:6807, or choose from the roster above.</p>}
        <div><Button type="submit" variant="primary" disabled={busy || (!file && !url.trim()) || !league || !abbr || !validPlayer}>{busy ? "Saving…" : url.trim() ? "Import from URL" : "Upload / replace"}</Button></div>
      </form>
      <ul className="mt-5 flex flex-col gap-2">
        {!videos.length && <li className="text-sm text-slate-400">No videos uploaded. The built-in celebration remains active.</li>}
        {videos.map((v) => {
          const name = v.player_name ?? playerNames[v.player_id];
          const displayLabel = v.player_id === "default"
            ? "Team fallback"
            : name
            ? `${name} (${v.player_id})`
            : v.player_id;

          return (
            <li key={`${v.league}/${v.abbr}/${v.player_id}`} className="flex flex-wrap items-center gap-3 rounded-xl bg-ink-900 px-3 py-2">
              <span className="min-w-0 flex-1 text-sm font-bold">
                {v.league.toUpperCase()} · {v.abbr} · <span className="text-sky-300">{displayLabel}</span>
              </span>
              <Button disabled={busy} onClick={() => setPreview(v)}>Preview</Button>
              <Button disabled={busy} variant="danger" onClick={() => del(v)} aria-label={`Delete ${v.abbr} ${v.player_id} video`}>Delete</Button>
            </li>
          );
        })}
      </ul>
      {preview && (
        <div className="mt-4">
          <p className="mb-2 text-sm font-semibold">
            {preview.abbr} · {preview.player_name ?? playerNames[preview.player_id] ?? (preview.player_id === "default" ? "Team fallback" : preview.player_id)}
            {preview.player_id !== "default" && (preview.player_name || playerNames[preview.player_id]) ? ` (${preview.player_id})` : ""}
          </p>
          <video key={preview.url} src={preview.url} controls muted playsInline className="max-h-80 w-full rounded-xl bg-black" onError={() => setErr("This video could not be played. Kiosk displays will fall back automatically.")}>
            <track kind="captions" />
          </video>
          <Button onClick={() => setPreview(null)}>Close preview</Button>
        </div>
      )}
    </Card>
  );
}
