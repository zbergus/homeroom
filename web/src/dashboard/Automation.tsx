import { useState } from "react";
import type { Settings, SettingsPatch } from "../types";
import { Card, Notice } from "../components/ui";
import SwitchRow from "./SwitchRow";
import { errMsg } from "../lib/errors";

export default function Automation({ settings, saveNow }: { settings: Settings; saveNow: (p: SettingsPatch) => Promise<void> }) {
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const set = async (p: SettingsPatch) => {
    setBusy(true); setErr("");
    try { await saveNow(p); } catch (e) { setErr(`Could not save: ${errMsg(e)}. The switch was put back.`); } finally { setBusy(false); }
  };
  return (
    <Card title="Automation" subtitle="Lights, horns and Home Assistant. Only Goal plays a horn; other events can still speak TTS.">
      {err && <div className="mb-3"><Notice kind="err">{err}</Notice></div>}
      <ul className="flex flex-col gap-2">
        <SwitchRow label="Speak announcements (TTS)" checked={settings.tts_enabled !== false} disabled={busy} onChange={(v) => void set({ tts_enabled: v })}
          help="When off, Homeroom clears the spoken line before pushing to Home Assistant (horns and lights still fire)." />
        <SwitchRow label="French announcements for Montreal Canadiens" checked={settings.team_languages?.MTL !== "en"} disabled={busy}
          onChange={(v) => void set({ team_languages: { ...(settings.team_languages ?? {}), MTL: v ? "fr" : "en" } })}
          help="Announce Montreal Canadiens goals, period ends, and game results in French (Bell Centre style). Other teams announce in English." />
        <SwitchRow label="My team only" checked={!!settings.my_team_only} disabled={busy} onChange={(v) => void set({ my_team_only: v })}
          help="Automation outputs fire only for goals by your favourite teams. The TV overlay still shows every goal." />
        <SwitchRow label="Disable automations" checked={settings.automations_enabled === false} disabled={busy} onChange={(v) => void set({ automations_enabled: !v })}
          help="Nothing fires on its own; only the manual buttons and hook URLs do. Handy for guests or movie night." />
        <SwitchRow label="Auto-sync favourite teams" checked={settings.auto_sync_favorites !== false} disabled={busy} onChange={(v) => void set({ auto_sync_favorites: v })}
          help="Games with a starred team are watched automatically. Switch one game off in the calendar to opt out of just that game." />
      </ul>
    </Card>
  );
}
