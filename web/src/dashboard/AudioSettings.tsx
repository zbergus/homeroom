import { useCallback, useEffect, useRef, useState } from "react";
import type { Device, Horn, Settings, SettingsPatch, Status, TeamInfo } from "../types";
import { api, hornUrl } from "../lib/api";
import { Button, Card, Field, inputCls, Notice, Switch } from "../components/ui";
import { errMsg } from "../lib/errors";

const fmtDur = (d: number) => (d >= 60 ? `${Math.floor(d / 60)}:${String(Math.round(d % 60)).padStart(2, "0")}` : `${d.toFixed(1)} s`);
const PLAYER_RE = /^media_player\.[a-z0-9_]+$/;
const parsePlayers = (t: string) => t.split(/[\s,]+/).map((x) => x.trim()).filter(Boolean);

const SCOPES: { id: NonNullable<Settings["horn_scope"]>; label: string }[] = [
  { id: "favorites", label: "My teams (falls back to both)" },
  { id: "home", label: "Home team only" },
  { id: "all", label: "Both teams" },
];

function Preview({ h }: { h: Horn }) {
  const el = useRef<HTMLAudioElement | null>(null);
  const [on, setOn] = useState(false);
  useEffect(() => () => el.current?.pause(), []);
  const toggle = () => {
    if (on) {
      el.current?.pause();
      setOn(false);
      return;
    }
    const a = new Audio(`${hornUrl(h)}?preview=${Date.now()}`);
    a.onended = () => setOn(false);
    a.onerror = () => setOn(false);
    el.current = a;
    setOn(true);
    void a.play().catch(() => setOn(false));
  };
  return (
    <Button onClick={toggle} aria-label={`${on ? "Stop" : "Preview"} ${h.league} ${h.abbr} horn`}>
      {on ? "Stop" : "Preview"}
    </Button>
  );
}

interface Props {
  leagues: string[];
  settings: Settings;
  saveNow: (p: SettingsPatch) => Promise<void>;
  audio?: Status["audio"] | undefined;
}

export default function AudioSettings({ leagues, settings, saveNow, audio }: Props) {
  const [subTab, setSubTab] = useState<"horns" | "volume" | "limits">("horns");

  // --- 1. Horn files & upload ---
  const [horns, setHorns] = useState<Horn[]>([]);
  const [err, setErr] = useState("");
  const [uploadLeague, setUploadLeague] = useState(leagues[0] ?? "nhl");
  const [abbr, setAbbr] = useState("");
  const [teams, setTeams] = useState<TeamInfo[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const loadHorns = useCallback(() => api.horns().then(setHorns).catch((e: Error) => setErr(e.message)), []);
  useEffect(() => {
    void loadHorns();
  }, [loadHorns, settings.horn_max_s, settings.horn_fade_ms, settings.horn_normalize]);

  useEffect(() => {
    if (!uploadLeague) return;
    let cancelled = false;
    api.teams(uploadLeague)
      .then((t) => !cancelled && setTeams(t))
      .catch(() => !cancelled && setTeams([]));
    return () => {
      cancelled = true;
    };
  }, [uploadLeague]);

  useEffect(() => {
    if (!uploadLeague && leagues[0]) setUploadLeague(leagues[0]);
  }, [leagues, uploadLeague]);

  const uploadHorn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file || !uploadLeague) return;
    setBusy(true);
    setErr("");
    try {
      await api.uploadHorn(uploadLeague, abbr || "default", file);
      setFile(null);
      setAbbr("");
      if (fileRef.current) fileRef.current.value = "";
      await loadHorns();
    } catch (x) {
      setErr(`Upload failed: ${errMsg(x)}`);
    } finally {
      setBusy(false);
    }
  };

  const deleteHorn = async (h: Horn) => {
    if (!confirm(`Delete horn ${h.league.toUpperCase()} ${h.abbr}?`)) return;
    try {
      await api.deleteHorn(h.league, h.abbr);
      await loadHorns();
    } catch (x) {
      setErr(`Delete failed: ${errMsg(x)}`);
    }
  };

  // --- 2. Volume control ---
  const volOn = settings.horn_volume != null;
  const [volEnabled, setVolEnabled] = useState(volOn);
  const [pct, setPct] = useState(Math.round((settings.horn_volume ?? 0.7) * 100));
  const [playersText, setPlayersText] = useState((settings.horn_players ?? []).join("\n"));
  const [ttsPlayer, setTtsPlayer] = useState(settings.tts_player ?? "");
  const [ttsEngine, setTtsEngine] = useState(settings.tts_engine ?? "");
  const [discovered, setDiscovered] = useState<{ media_players: Device[]; tts_engines: Device[] }>({ media_players: [], tts_engines: [] });
  const [volMsg, setVolMsg] = useState<{ k: "ok" | "err"; t: string } | null>(null);

  useEffect(() => {
    api.entities().then((e) => setDiscovered(e)).catch(() => {});
  }, []);

  useEffect(() => {
    setVolEnabled(settings.horn_volume != null);
    if (settings.horn_volume != null) setPct(Math.round(settings.horn_volume * 100));
    setPlayersText((settings.horn_players ?? []).join("\n"));
    setTtsPlayer(settings.tts_player ?? "");
    setTtsEngine(settings.tts_engine ?? "");
  }, [settings.horn_volume, settings.horn_players, settings.tts_player, settings.tts_engine]);

  const saveVolume = async () => {
    setVolMsg(null);
    const list = parsePlayers(playersText);
    const bad = list.filter((e) => !PLAYER_RE.test(e));
    if (volEnabled && bad.length) {
      return setVolMsg({ k: "err", t: `Not a media player entity id: ${bad[0]} (e.g. media_player.living_room)` });
    }
    setBusy(true);
    try {
      await saveNow({
        horn_volume: volEnabled ? pct / 100 : null,
        horn_players: list,
        tts_player: ttsPlayer || null,
        tts_engine: ttsEngine || null,
      });
      setVolMsg({ k: "ok", t: "Audio and speaker settings saved." });
    } catch (e) {
      setVolMsg({ k: "err", t: errMsg(e) });
    } finally {
      setBusy(false);
    }
  };

  // --- 3. Trimming and limits ---
  const full = audio?.mode === "ffmpeg";
  const [maxS, setMaxS] = useState(settings.horn_max_s == null ? "" : String(settings.horn_max_s));
  const [fadeMs, setFadeMs] = useState(String(settings.horn_fade_ms ?? 1500));
  const [norm, setNorm] = useState(!!settings.horn_normalize);
  const [scope, setScope] = useState<NonNullable<Settings["horn_scope"]>>(settings.horn_scope ?? "favorites");
  const [limitsMsg, setLimitsMsg] = useState<{ k: "ok" | "err"; t: string } | null>(null);

  useEffect(() => {
    setMaxS(settings.horn_max_s == null ? "" : String(settings.horn_max_s));
    setFadeMs(String(settings.horn_fade_ms ?? 1500));
    setNorm(!!settings.horn_normalize);
    setScope(settings.horn_scope ?? "favorites");
  }, [settings.horn_max_s, settings.horn_fade_ms, settings.horn_normalize, settings.horn_scope]);

  const saveLimits = async () => {
    setLimitsMsg(null);
    const m = maxS.trim() === "" ? null : Number(maxS);
    const f = Number(fadeMs);
    if (m !== null && !(Number.isFinite(m) && m >= 2 && m <= 120)) {
      return setLimitsMsg({ k: "err", t: "Maximum length must be between 2 and 120 seconds, or empty for no limit." });
    }
    if (!(Number.isFinite(f) && f >= 0 && f <= 5000)) {
      return setLimitsMsg({ k: "err", t: "Fade must be between 0 and 5000 ms." });
    }
    setBusy(true);
    try {
      await saveNow({ horn_max_s: m, horn_fade_ms: Math.round(f), horn_normalize: norm, horn_scope: scope });
      setLimitsMsg({ k: "ok", t: "Saved. The next horn uses these length and loudness settings." });
    } catch (e) {
      setLimitsMsg({ k: "err", t: errMsg(e) });
    } finally {
      setBusy(false);
    }
  };

  const haReady = !!settings.ha.url && !!settings.ha.token_set;

  return (
    <Card
      title="Goal Horns & Audio"
      subtitle="Play real team goal horns on your speakers when a goal is scored."
      actions={
        <div className="flex gap-1 rounded-lg bg-ink-900 p-1">
          <button
            type="button"
            onClick={() => setSubTab("horns")}
            className={`rounded-md px-3 py-1 text-xs font-bold transition ${
              subTab === "horns" ? "bg-accent text-white" : "text-slate-400 hover:text-white"
            }`}
          >
            Horns ({horns.length})
          </button>
          <button
            type="button"
            onClick={() => setSubTab("volume")}
            className={`rounded-md px-3 py-1 text-xs font-bold transition ${
              subTab === "volume" ? "bg-accent text-white" : "text-slate-400 hover:text-white"
            }`}
          >
            Speaker Volume
          </button>
          <button
            type="button"
            onClick={() => setSubTab("limits")}
            className={`rounded-md px-3 py-1 text-xs font-bold transition ${
              subTab === "limits" ? "bg-accent text-white" : "text-slate-400 hover:text-white"
            }`}
          >
            Trimming & Scope
          </button>
        </div>
      }
    >
      {/* Tab 1: Horn files & uploads */}
      {subTab === "horns" && (
        <div className="flex flex-col gap-4">
          {err && <Notice kind="err">{err}</Notice>}
          <form onSubmit={uploadHorn} className="grid gap-3 sm:grid-cols-[140px_160px_1fr_auto] sm:items-end">
            <Field label="League" htmlFor="horn-league">
              <select
                id="horn-league"
                className={inputCls}
                value={uploadLeague}
                onChange={(e) => {
                  setUploadLeague(e.target.value);
                  setAbbr("");
                }}
              >
                {leagues.map((l) => (
                  <option key={l} value={l}>
                    {l.toUpperCase()}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Team" htmlFor="horn-abbr">
              <select id="horn-abbr" className={inputCls} value={abbr} onChange={(e) => setAbbr(e.target.value)}>
                <option value="">League default</option>
                {teams.map((t) => (
                  <option key={t.abbr} value={t.abbr}>
                    {t.abbr} - {t.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="MP3 File" htmlFor="horn-file">
              <input
                id="horn-file"
                ref={fileRef}
                type="file"
                accept="audio/mpeg,.mp3"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                className={`${inputCls} py-1.5 file:mr-3 file:rounded file:border-0 file:bg-ink-600 file:px-3 file:py-1 file:text-slate-100`}
              />
            </Field>
            <Button variant="primary" type="submit" disabled={!file || !uploadLeague || busy}>
              Upload
            </Button>
          </form>

          <div className="mt-2 flex flex-col gap-2">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-400">
              Installed Horns ({horns.length})
            </span>
            {horns.length === 0 ? (
              <p className="rounded-xl border border-dashed border-white/10 p-4 text-center text-sm text-slate-400">
                No horns uploaded yet. Upload a team horn or a league default (e.g. NHL default) to hear sirens on goal.
              </p>
            ) : (
              <ul className="flex flex-col gap-2">
                {horns.map((h) => (
                  <li
                    key={`${h.league}/${h.abbr}`}
                    className="flex flex-wrap items-center gap-3 rounded-xl bg-ink-900 px-3 py-2 text-sm"
                  >
                    <span className="w-28 font-bold text-white">
                      {h.league.toUpperCase()} · {h.abbr === "default" ? "Default" : h.abbr}
                    </span>
                    <span className="min-w-0 flex-1 text-xs text-slate-300">
                      {h.duration_s != null && <span className="tabular-nums">{fmtDur(h.duration_s)}</span>}
                      {h.trimmed && settings.horn_max_s != null && (
                        <span className="ml-2 rounded-full bg-amber-400/15 px-2 py-0.5 font-semibold text-amber-300">
                          trimmed to {settings.horn_max_s} s
                        </span>
                      )}
                      {h.processed && !h.trimmed && (
                        <span className="ml-2 rounded-full bg-sky-400/15 px-2 py-0.5 font-semibold text-sky-300">
                          loudness adjusted
                        </span>
                      )}
                    </span>
                    <div className="flex items-center gap-2">
                      <Preview h={h} />
                      <Button
                        variant="danger"
                        onClick={() => void deleteHorn(h)}
                        aria-label={`Delete ${h.league} ${h.abbr} horn`}
                      >
                        Delete
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      {/* Tab 2: Volume & Speaker entity management */}
      {subTab === "volume" && (
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-3">
            <Switch checked={volEnabled} onChange={setVolEnabled} label="Control horn volume" />
            <div>
              <div className="text-sm font-medium">Automatic Horn Volume Boost</div>
              <div className="text-xs text-slate-400">
                Temporarily sets speakers to a designated volume during the goal horn, then restores previous volume.
              </div>
            </div>
          </div>

          <div className={`grid gap-4 sm:grid-cols-2 ${volEnabled ? "" : "opacity-50"}`}>
            <Field
              label={`Horn volume level: ${pct}%`}
              htmlFor="horn-vol"
              hint="Applied just before the horn audio starts."
            >
              <input
                id="horn-vol"
                type="range"
                min={0}
                max={100}
                step={5}
                value={pct}
                disabled={!volEnabled}
                onChange={(e) => setPct(Number(e.target.value))}
                className="w-full accent-accent"
              />
            </Field>

            <Field
              label="Home Assistant Media Players"
              htmlFor="horn-players"
              hint="Speakers that play the goal horn (one media_player.* per line, or click discovered speakers)."
            >
              {discovered.media_players.length > 0 && (
                <div className="mb-2 flex flex-wrap gap-1.5">
                  {discovered.media_players.map((mp) => {
                    const active = parsePlayers(playersText).includes(mp.entity_id);
                    return (
                      <button
                        key={mp.entity_id}
                        type="button"
                        onClick={() => {
                          const current = parsePlayers(playersText);
                          const next = current.includes(mp.entity_id) ? current.filter((x) => x !== mp.entity_id) : [...current, mp.entity_id];
                          setPlayersText(next.join("\n"));
                        }}
                        className={`rounded px-2 py-0.5 text-xs font-semibold transition ${
                          active ? "bg-accent text-white" : "bg-ink-800 text-slate-300 hover:bg-ink-700"
                        }`}
                      >
                        {mp.name}
                      </button>
                    );
                  })}
                </div>
              )}
              <textarea
                id="horn-players"
                rows={3}
                className={`${inputCls} py-2 font-mono text-xs`}
                value={playersText}
                onChange={(e) => setPlayersText(e.target.value)}
                placeholder={"media_player.living_room\nmedia_player.den"}
                spellCheck={false}
              />
            </Field>

            <Field label="TTS Speaker" htmlFor="tts-speaker" hint="Speaker for spoken goal announcements.">
              <select
                id="tts-speaker"
                className={inputCls}
                value={ttsPlayer}
                onChange={(e) => setTtsPlayer(e.target.value)}
              >
                <option value="">Default (First horn speaker)</option>
                {discovered.media_players.map((mp) => (
                  <option key={mp.entity_id} value={mp.entity_id}>
                    {mp.name} ({mp.entity_id})
                  </option>
                ))}
              </select>
            </Field>

            <Field label="TTS Engine" htmlFor="tts-engine" hint="Text-to-speech service in Home Assistant.">
              <select
                id="tts-engine"
                className={inputCls}
                value={ttsEngine}
                onChange={(e) => setTtsEngine(e.target.value)}
              >
                <option value="">Default (tts.speak)</option>
                {discovered.tts_engines.map((t) => (
                  <option key={t.entity_id} value={t.entity_id}>
                    {t.name} ({t.entity_id})
                  </option>
                ))}
              </select>
            </Field>
          </div>

          {volEnabled && !haReady && (
            <Notice kind="err">
              Home Assistant URL or token is not saved yet in Settings. Volume control requires HA REST access.
            </Notice>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <Button variant="primary" onClick={() => void saveVolume()} disabled={busy}>
              Save Volume Settings
            </Button>
            {volMsg && <Notice kind={volMsg.k}>{volMsg.t}</Notice>}
          </div>
        </div>
      )}

      {/* Tab 3: Trimming, Normalization & Scope */}
      {subTab === "limits" && (
        <div className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <Field
              label="Max Horn Duration (seconds)"
              htmlFor="horn-max"
              hint="Long horns delay spoken TTS announcements. 2–120s or empty for full length."
            >
              <input
                id="horn-max"
                className={inputCls}
                inputMode="numeric"
                value={maxS}
                onChange={(e) => setMaxS(e.target.value)}
                placeholder="No limit"
              />
            </Field>

            <Field
              label="Fade out (ms)"
              htmlFor="horn-fade"
              hint={full ? "Applied smoothly at the cut." : "Cuts cleanly without fade (ffmpeg not detected)."}
            >
              <input
                id="horn-fade"
                className={inputCls}
                inputMode="numeric"
                value={fadeMs}
                disabled={!full}
                onChange={(e) => setFadeMs(e.target.value)}
              />
            </Field>

            <Field label="Whose Goals Play a Horn" htmlFor="horn-scope">
              <select
                id="horn-scope"
                className={inputCls}
                value={scope}
                onChange={(e) => setScope(e.target.value as typeof scope)}
              >
                {SCOPES.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <div className={`flex items-center gap-3 ${full ? "" : "opacity-50"}`}>
            <Switch checked={norm && full} onChange={setNorm} label="Even out horn loudness" disabled={!full} />
            <div>
              <div className="text-sm font-medium">Loudness Normalization</div>
              <div className="text-xs text-slate-400">
                Evens out volume between different horn clips so quiet ones aren&apos;t lost and loud ones don&apos;t blast the room.
              </div>
            </div>
          </div>

          {audio && (
            <Notice kind={full ? "ok" : "info"}>
              {full
                ? "ffmpeg detected: Smooth audio fading and loudness normalization are enabled."
                : "ffmpeg not installed: Audio cutting is functional; loudness normalization is disabled."}
            </Notice>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <Button variant="primary" onClick={() => void saveLimits()} disabled={busy}>
              Save Audio Limits
            </Button>
            {limitsMsg && <Notice kind={limitsMsg.k}>{limitsMsg.t}</Notice>}
          </div>
        </div>
      )}
    </Card>
  );
}
