import { useEffect, useState } from "react";
import type { League, TeamInfo, Trigger } from "../types";
import { api } from "../lib/api";
import { Button, Card, Field, inputCls, Notice } from "../components/ui";
import { groupTriggers } from "./triggerGroups";
import { useToast } from "./Toast";
import { errMsg } from "../lib/errors";
import { copyText } from "../lib/clipboard";

interface Props { triggers: Trigger[]; triggersErr: string; leagues: League[]; hasToken: boolean }

export default function ManualTriggers({ triggers, triggersErr, leagues, hasToken }: Props) {
  const [league, setLeague] = useState("");
  const [team, setTeam] = useState("");
  const [teams, setTeams] = useState<TeamInfo[]>([]);
  const [delay, setDelay] = useState(false);
  const [busy, setBusy] = useState("");
  const [copied, setCopied] = useState("");
  const [toast, show] = useToast();

  useEffect(() => {
    setTeam(""); setTeams([]);
    if (!league) return;
    let dead = false;
    api.teams(league).then((t) => !dead && setTeams(t)).catch(() => !dead && setTeams([]));
    return () => { dead = true; };
  }, [league]);

  const fire = async (t: Trigger) => {
    setBusy(t.id);
    try {
      const r = await api.trigger({ trigger: t.id, ...(league ? { league } : {}), ...(team ? { team_abbr: team } : {}), apply_delay: delay });
      const say = r.event?.natural_text ? ` Will say: “${r.event.natural_text}”` : "";
      show(`Fired ${t.label}${r.event?.type ? ` (event: ${r.event.type})` : ""}${delay ? ", with stream delay" : ", immediately"}.${say}`);
    } catch (e) { show(`${t.label} failed: ${errMsg(e)}`, "err"); } finally { setBusy(""); }
  };
  const hook = (t: Trigger) => {
    const q = new URLSearchParams();
    if (league) q.set("league", league);
    if (team) q.set("team", team);
    if (delay) q.set("delay", "1");
    const s = q.toString();
    return `${location.origin}/api/hook/${t.id}${s ? `?${s}` : ""}`;
  };
  const copy = async (t: Trigger) => {
    await copyText(hook(t));
    setCopied(t.id); setTimeout(() => setCopied(""), 1800);
  };

  const groups = groupTriggers(triggers);
  return (
    <Card title="Manual buttons" subtitle="Fire an event yourself (immediately unless you tick delay). Toast shows the TTS line. Only Goal plays a horn; cards and power plays speak when the HA integration supports them.">
      {triggersErr && <Notice kind="err">Could not load triggers: {triggersErr}</Notice>}
      <div className="mb-4 grid gap-3 sm:grid-cols-3 sm:items-end">
        <Field label="League (optional)" htmlFor="mt-league">
          <select id="mt-league" className={inputCls} value={league} onChange={(e) => setLeague(e.target.value)}>
            <option value="">Default for the button</option>
            {leagues.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </Field>
        <Field label="Team (optional)" htmlFor="mt-team">
          <select id="mt-team" className={inputCls} value={team} onChange={(e) => setTeam(e.target.value)} disabled={!league}>
            <option value="">{league ? "Any team" : "Choose a league first"}</option>
            {teams.map((t) => <option key={t.abbr} value={t.abbr}>{t.abbr} {t.name}</option>)}
          </select>
        </Field>
        <label className="flex min-h-[40px] items-center gap-2 text-sm">
          <input type="checkbox" className="h-5 w-5 accent-[#1f7bff]" checked={delay} onChange={(e) => setDelay(e.target.checked)} /> Apply stream delay
        </label>
      </div>
      {triggers.length === 0 && !triggersErr && <p className="text-sm text-slate-400">Loading triggers...</p>}
      <div className="flex flex-col gap-4">
        {groups.map((g) => (
          <div key={g.key}>
            <h3 className="mb-2 text-sm font-bold uppercase tracking-wider text-slate-400">{g.label}</h3>
            <ul className="grid grid-cols-2 gap-2 md:grid-cols-4">
              {g.items.map((t) => (
                <li key={t.id} className="flex flex-col gap-1 rounded-xl bg-ink-900 p-2">
                  <Button variant="primary" onClick={() => void fire(t)} disabled={busy === t.id} aria-label={`Fire ${t.label}`}>{t.label}</Button>
                  <Button variant="ghost" className="!min-h-[32px] !text-xs" onClick={() => void copy(t)} aria-label={`Copy hook URL for ${t.label}`} aria-live="polite">{copied === t.id ? "Copied" : "Copy hook URL"}</Button>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <p className="mt-4 text-xs text-slate-400">
        Hook URLs work for Stream Deck, Home Assistant rest_command and physical buttons.
        {hasToken ? " You have an admin token set: append ?token=YOUR_TOKEN (or &token=...) to each URL." : " If the server has ADMIN_TOKEN set, append ?token=YOUR_TOKEN to each URL."}
      </p>
      {toast}
    </Card>
  );
}
