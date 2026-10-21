import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { GameLite, League, Settings, SettingsPatch, SyncState, Trigger } from "../types";
import { api, getAdminToken, setAdminToken } from "../lib/api";
import { isMockUrl, useLive } from "../lib/live";
import { useDebouncedCallback } from "../lib/hooks";
import { Notice, inputCls } from "../components/ui";
import Automation from "../dashboard/Automation";
import Calendar from "../dashboard/Calendar";
import CelebrationManager from "../dashboard/CelebrationManager";
import DelayPanel from "../dashboard/DelayPanel";
import DevicesActions from "../dashboard/DevicesActions";
import HASettings from "../dashboard/HASettings";
import HornLimits from "../dashboard/HornLimits";
import HornManager from "../dashboard/HornManager";
import HornVolume from "../dashboard/HornVolume";
import KioskLinks from "../dashboard/KioskLinks";
import Leagues from "../dashboard/Leagues";
import ManualTriggers from "../dashboard/ManualTriggers";
import Next24h from "../dashboard/Next24h";
import SimulationPanel, { type SimStatus } from "../dashboard/SimulationPanel";
import StatusPanel, { HEALTH_CLS, healthOf } from "../dashboard/StatusPanel";
import Tabs, { loadTab, saveTab } from "../dashboard/Tabs";
import { usePoll } from "../dashboard/usePoll";

const DEFAULT_SETTINGS: Settings = {
  delay_global_s: 0, delay_by_game: {}, delay_by_league: {}, public_base_url: "",
  ha: { url: "", token: "", token_set: false, fire_rest_events: false },
  my_team_only: false, automations_enabled: true, auto_sync_favorites: true, sync_excluded: [],
};
const normalise = (s: Settings): Settings => ({
  ...DEFAULT_SETTINGS, ...s,
  ha: { ...DEFAULT_SETTINGS.ha, ...s.ha, token: "" },
  delay_by_game: s.delay_by_game ?? {}, delay_by_league: s.delay_by_league ?? {}, sync_excluded: s.sync_excluded ?? [],
});

const TABS = [{ key: "today", label: "Today" }, { key: "alerts", label: "Alerts" }, { key: "setup", label: "Setup" }] as const;
type TabKey = (typeof TABS)[number]["key"];
const TAB_KEYS = TABS.map((t) => t.key) as TabKey[];
const HEALTH_TEXT = { ok: "Healthy", warn: "Warnings", err: "Problems", unknown: "Checking" } as const;

export default function Dashboard() {
  const { conn, games: liveGames } = useLive("control");
  const [tab, setTabState] = useState<TabKey>(() => loadTab(TAB_KEYS, "today"));
  const [settings, setSettings] = useState<Settings | null>(null);
  const [sync, setSync] = useState<SyncState>({ games: [], favorites: [] });
  const [leagues, setLeagues] = useState<League[]>([]);
  const [triggers, setTriggers] = useState<Trigger[]>([]);
  const [triggersErr, setTriggersErr] = useState("");
  const [err, setErr] = useState("");
  const [saveErr, setSaveErr] = useState("");
  const [token, setToken] = useState(getAdminToken());
  const [sim, setSim] = useState<SimStatus>({ active: false });
  const latest = useRef<Settings | null>(null);
  const pending = useRef<Partial<Settings>>({});

  const schedule = usePoll(() => api.schedule(7), 60_000);
  const status = usePoll(api.status, tab === "setup" || sim.active ? 5000 : 20_000);
  const health = healthOf(status);

  useEffect(() => {
    const active = status.data?.simulation?.active;
    if (typeof active === "boolean") setSim((prev) => (prev.active === active && prev.game_id === status.data?.simulation?.game_id ? prev : { ...status.data!.simulation! }));
  }, [status.data?.simulation]);

  const setTab = useCallback((k: TabKey) => { setTabState(k); saveTab(k); window.scrollTo({ top: 0 }); }, []);
  const gotoStatus = () => { setTab("setup"); setTimeout(() => document.getElementById("status")?.scrollIntoView({ behavior: "smooth", block: "start" }), 50); };

  useEffect(() => {
    api.settings().then((s) => { const m = normalise(s); latest.current = m; setSettings(m); }).catch((e: Error) => setErr(`Settings: ${e.message}`));
    api.sync().then((s) => setSync({ games: s.games ?? [], favorites: s.favorites ?? [] })).catch((e: Error) => setErr(`Sync: ${e.message}`));
    api.leagues().then(setLeagues).catch(() => undefined);
    api.triggers().then(setTriggers).catch((e: Error) => setTriggersErr(e.message));
  }, []);

  const persist = useDebouncedCallback(() => {
    const patch = pending.current; pending.current = {};
    if (!Object.keys(patch).length) return;
    api.putSettings(patch).then(() => setSaveErr("")).catch((e: Error) => setSaveErr(`Could not save settings: ${e.message}`));
  }, 450);

  /** Debounced save for sliders and number inputs (optimistic; failures surface in the banner). */
  const update = useCallback((p: Partial<Settings>) => {
    if (!latest.current) return;
    latest.current = { ...latest.current, ...p }; pending.current = { ...pending.current, ...p }; setSettings(latest.current); persist();
  }, [persist]);

  /** Immediate save for switches and forms: optimistic, reverts and throws on failure. Never keeps the HA token locally. */
  const saveNow = useCallback(async (p: SettingsPatch) => {
    const prev = latest.current;
    if (!prev) return;
    const { ha, ...rest } = p;
    const optimistic: Settings = { ...prev, ...(rest as Partial<Settings>), ...(ha ? { ha: { ...prev.ha, ...(ha.url !== undefined ? { url: ha.url } : {}), ...(ha.fire_rest_events !== undefined ? { fire_rest_events: ha.fire_rest_events } : {}) } } : {}) };
    latest.current = optimistic; setSettings(optimistic);
    try {
      const r = await api.putSettings(p);
      if (ha && r?.ha) { const m = { ...latest.current!, ha: { ...r.ha, token: "" } }; latest.current = m; setSettings(m); }
      setSaveErr("");
    } catch (e) {
      latest.current = prev; setSettings(prev);
      throw e;
    }
  }, []);

  const scheduled: GameLite[] = useMemo(() => (schedule.data?.days ?? []).flatMap((d) => d.games), [schedule.data]);
  const leagueIds = useMemo(() => leagues.map((l) => l.id), [leagues]);
  const enabledLeagueIds = useMemo(() => (settings?.enabled_leagues ?? leagueIds).filter((l) => leagueIds.length === 0 || leagueIds.includes(l)), [settings?.enabled_leagues, leagueIds]);
  const hasToken = token.trim() !== "";

  const panel = (k: TabKey, children: React.ReactNode) => (
    <div role="tabpanel" id={`panel-${k}`} aria-labelledby={`tab-${k}`} hidden={tab !== k} className={tab === k ? "flex flex-col gap-5" : "hidden"}>{children}</div>
  );

  return (
    <div className="min-h-full bg-ink-900">
      <header className="sticky top-0 z-10 border-b border-white/10 bg-ink-900/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-3 gap-y-2 px-4 pt-3 sm:px-6">
          <div className="flex items-center gap-3">
            <span className="grid h-9 w-9 place-items-center rounded-lg bg-accent text-lg font-black">H</span>
            <h1 className="text-xl font-black tracking-tight">Homeroom</h1>
            {isMockUrl() && <span className="rounded bg-violet-500/20 px-2 py-0.5 text-xs font-bold text-violet-300">MOCK DATA</span>}
            {sim.active && <span className="rounded bg-amber-500/25 px-2 py-0.5 text-xs font-bold uppercase tracking-wide text-amber-200" role="status">Simulation — not live</span>}
          </div>
          <div className="flex items-center gap-3 text-sm text-slate-400">
            <button type="button" onClick={gotoStatus} aria-label={`System health: ${HEALTH_TEXT[health]}. Open status and diagnostics`} title={`${HEALTH_TEXT[health]}. Open status and diagnostics`}
              className="flex min-h-[34px] items-center gap-1.5 rounded-lg px-2 hover:bg-white/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent-soft">
              <span className={`h-2.5 w-2.5 rounded-full ${HEALTH_CLS[health]}`} /><span className="hidden sm:inline">{HEALTH_TEXT[health]}</span>
            </button>
            <span className="flex items-center gap-1.5" role="status"><span className={`h-2 w-2 rounded-full ${conn === "open" || conn === "mock" ? "bg-emerald-400" : "bg-amber-400"}`} />{conn === "open" ? "Live" : conn === "mock" ? "Mock" : conn}</span>
            <label className="sr-only" htmlFor="admin-token">Admin token</label>
            <input id="admin-token" type="password" placeholder="Admin token (optional)" title="Only needed if the server was started with an ADMIN_TOKEN. Leave empty otherwise. Saved in this browser only; sent as a Bearer header on changes (saving settings, firing buttons)." className={`${inputCls} !min-h-[34px] w-36 sm:w-44`} value={token} onChange={(e) => { setToken(e.target.value); setAdminToken(e.target.value); }} autoComplete="off" />
          </div>
        </div>
        <Tabs tabs={[...TABS]} value={tab} onChange={setTab} />
      </header>
      <main className="mx-auto flex max-w-6xl flex-col gap-5 px-4 py-5 sm:px-6">
        {err && <Notice kind="err">{err}</Notice>}
        {saveErr && <Notice kind="err">{saveErr}</Notice>}
        {panel("today", <>
          <Next24h schedule={schedule} settings={settings} sync={sync} />
          <Calendar schedule={schedule} settings={settings} sync={sync} setSync={setSync} saveNow={saveNow} />
        </>)}
        {panel("alerts", settings ? <>
          <DelayPanel settings={settings} update={update} games={scheduled} sync={sync} leagues={enabledLeagueIds} live={liveGames} active={tab === "alerts"} />
          <SimulationPanel onChange={setSim} />
          <Automation settings={settings} saveNow={saveNow} />
          <ManualTriggers triggers={triggers} triggersErr={triggersErr} leagues={leagues} hasToken={hasToken} />
          <DevicesActions triggers={triggers} />
        </> : <p className="text-slate-400">Loading settings...</p>)}
        {panel("setup", <>
          <StatusPanel status={status} active={tab === "setup"} />
          {settings && <HASettings settings={settings} saveNow={saveNow} />}
          <HornManager leagues={leagueIds.length ? leagueIds : enabledLeagueIds} settings={settings} />
          <CelebrationManager leagues={leagueIds.length ? leagueIds : enabledLeagueIds} games={liveGames} />
          {settings && <HornLimits settings={settings} saveNow={saveNow} audio={status.data?.audio} />}
          {settings && <HornVolume settings={settings} saveNow={saveNow} />}
          {settings && <Leagues leagues={leagues} settings={settings} saveNow={saveNow} />}
          <KioskLinks base={settings?.public_base_url ?? ""} />
        </>)}
      </main>
    </div>
  );
}
