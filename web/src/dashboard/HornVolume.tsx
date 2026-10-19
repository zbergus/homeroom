import { useEffect, useState } from "react";
import type { Settings, SettingsPatch } from "../types";
import { Button, Card, Field, inputCls, Notice, Switch } from "../components/ui";
import { errMsg } from "../lib/errors";

const PLAYER_RE = /^media_player\.[a-z0-9_]+$/;
const parse = (t: string) => t.split(/[\s,]+/).map((x) => x.trim()).filter(Boolean);

/** Optional: Homeroom sets the horn players' volume through Home Assistant's REST API around each horn. Off by default. */
export default function HornVolume({ settings, saveNow }: { settings: Settings; saveNow: (p: SettingsPatch) => Promise<void> }) {
  const on = settings.horn_volume != null;
  const [enabled, setEnabled] = useState(on);
  const [pct, setPct] = useState(Math.round((settings.horn_volume ?? 0.7) * 100));
  const [players, setPlayers] = useState((settings.horn_players ?? []).join("\n"));
  const [msg, setMsg] = useState<{ k: "ok" | "err"; t: string } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setEnabled(settings.horn_volume != null);
    if (settings.horn_volume != null) setPct(Math.round(settings.horn_volume * 100));
    setPlayers((settings.horn_players ?? []).join("\n"));
  }, [settings.horn_volume, settings.horn_players]);

  const list = parse(players);
  const bad = list.filter((e) => !PLAYER_RE.test(e));
  const haReady = !!settings.ha.url && !!settings.ha.token_set;
  const save = async () => {
    setMsg(null);
    if (enabled && bad.length) return setMsg({ k: "err", t: `Not a media player entity id: ${bad[0]} (expected something like media_player.living_room)` });
    if (enabled && !list.length) return setMsg({ k: "err", t: "Add at least one media player, or turn this off." });
    setBusy(true);
    try { await saveNow({ horn_volume: enabled ? pct / 100 : null, horn_players: list }); setMsg({ k: "ok", t: enabled ? "Saved. The volume is set just before each goal horn." : "Saved. Horn volume is off." }); }
    catch (e) { setMsg({ k: "err", t: errMsg(e) }); } finally { setBusy(false); }
  };

  return (
    <Card title="Goal horn volume" subtitle="Optional. Home Assistant plays the horn at the player's current volume; this sets a level just for the horn.">
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-3">
          <Switch checked={enabled} onChange={setEnabled} label="Control horn volume" />
          <div><div className="text-sm font-medium">Control horn volume</div><div className="text-xs text-slate-400">Off: Homeroom never touches your players' volume.</div></div>
        </div>
        <div className={`grid gap-4 sm:grid-cols-2 ${enabled ? "" : "opacity-50"}`}>
          <Field label={`Horn volume: ${pct}%`} htmlFor="horn-vol" hint="Set on each player just before the horn, then the previous volume is put back.">
            <input id="horn-vol" type="range" min={0} max={100} step={5} value={pct} disabled={!enabled} onChange={(e) => setPct(Number(e.target.value))} className="w-full accent-[#3b82f6]" />
          </Field>
          <Field label="Media players" htmlFor="horn-players" hint="One media_player.* entity id per line (the speakers that play the horn).">
            <textarea id="horn-players" rows={3} className={`${inputCls} py-2 font-mono`} value={players} disabled={!enabled} onChange={(e) => setPlayers(e.target.value)} placeholder={"media_player.living_room\nmedia_player.den"} spellCheck={false} />
          </Field>
        </div>
        <p className="rounded-lg bg-ink-900 px-3 py-2 text-sm text-slate-300">
          This uses Home Assistant's REST API, so Home Assistant must be reachable from this server and the URL and a long-lived token must be saved in the Home Assistant card above. If it is not reachable, the horn still plays, at whatever volume the player already has.
        </p>
        {enabled && !haReady && <Notice kind="err">Home Assistant URL or token is not saved yet, so nothing will change the volume.</Notice>}
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="primary" onClick={() => void save()} disabled={busy}>Save</Button>
          {msg && <Notice kind={msg.k}>{msg.t}</Notice>}
        </div>
      </div>
    </Card>
  );
}
