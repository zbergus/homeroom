import { useEffect, useState } from "react";
import type { EventRecord, ProviderStatus, Status } from "../types";
import { api } from "../lib/api";
import { Button, Card, Notice } from "../components/ui";
import { usePoll, type Poll } from "./usePoll";
import { copyText } from "../lib/clipboard";

const sevOf = (w: string): "err" | "warn" | "info" =>
  /fail|cannot|not set|localhost|not connected|No Home Assistant/i.test(w) ? "err" : /disabled/i.test(w) ? "info" : "warn";
const SEV = {
  err: "border-red-500/40 bg-red-500/10 text-red-200",
  warn: "border-amber-500/40 bg-amber-500/10 text-amber-200",
  info: "border-sky-500/40 bg-sky-500/10 text-sky-200",
};

type Health = "ok" | "warn" | "err" | "unknown";
export function healthOf(p: Poll<Status>): Health {
  if (p.err && !p.data) return "err";
  if (!p.data) return "unknown";
  if (p.err) return "err";
  const sevs = p.data.warnings.map(sevOf);
  return sevs.includes("err") ? "err" : sevs.length ? "warn" : "ok";
}
export const HEALTH_CLS: Record<Health, string> = { ok: "bg-emerald-400", warn: "bg-amber-400", err: "bg-red-500", unknown: "bg-slate-500" };

const CHECKLIST = `Post-deploy checklist
1. Home Assistant > Settings > Devices > Homeroom: the integration link shows "events connected" in Status & diagnostics.
2. Celebrations > Test Goal Alert: lights flash, goal horn plays, then TTS (spoken line uses scorer name "Test Player").
3. Celebrations > Test TTS: speaks only (period start), no horn — confirm the toast "Will say" line matches the HomePod.
4. Run scripts/e2e_pysher.py against this server: it must pass (goal -> goal_horn, get_state -> execute -> restore).`;

function Badge({ ok, children }: { ok: boolean | null; children: React.ReactNode }) {
  const c = ok === null ? "bg-slate-500/20 text-slate-300" : ok ? "bg-emerald-500/20 text-emerald-300" : "bg-red-500/20 text-red-300";
  return <span className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-bold ${c}`}>{children}</span>;
}

const fmtUp = (s: number) => (s >= 3600 ? `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m` : s >= 60 ? `${Math.floor(s / 60)}m` : `${s}s`);

/** re-render every second so "last updated Ns ago" keeps counting while the server is unreachable */
function useNow(ms = 1000): number {
  const [n, setN] = useState(() => Date.now());
  useEffect(() => { const i = setInterval(() => setN(Date.now()), ms); return () => clearInterval(i); }, [ms]);
  return n;
}
const fmtAgo = (ms: number) => { const s = Math.max(0, Math.round(ms / 1000)); return s >= 3600 ? `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m` : s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`; };

const FEED_LABEL = (id: string) => id.startsWith("espn:") ? `ESPN ${id.slice(5).toUpperCase()}` : ({ nhl: "NHL official", summary: "ESPN game summary", insight: "ESPN team form", schedule: "ESPN schedule" } as Record<string, string>)[id] ?? id;
const FEED_BADGE: Record<ProviderStatus["state"], { ok: boolean | null; text: string }> = { ok: { ok: true, text: "ok" }, failing: { ok: false, text: "failing" }, stale: { ok: false, text: "no data" }, idle: { ok: null, text: "idle" } };

function Feeds({ rows, ageOf }: { rows: ProviderStatus[]; ageOf: (t: number | null) => string }) {
  if (!rows.length) return <p className="text-sm text-slate-400">No feed has been polled yet.</p>;
  return (
    <div className="overflow-x-auto rounded-xl bg-ink-900 -mx-1 sm:mx-0" tabIndex={0} role="region" aria-label="Data feeds">
      <table className="w-full min-w-[500px] text-left text-xs sm:text-sm">
        <thead className="text-[11px] uppercase tracking-wider text-slate-400 border-b border-white/5">
          <tr>
            <th className="px-3 py-2">Feed</th>
            <th className="px-2">State</th>
            <th className="px-2">Last success</th>
            <th className="px-2">Failures</th>
            <th className="px-2">Last error</th>
          </tr>
        </thead>
        <tbody>{rows.map((p) => (
          <tr key={p.id} className="border-t border-white/5 align-top">
            <td className="px-3 py-2 font-semibold">{FEED_LABEL(p.id)}{p.live_relevant ? <span className="ml-1.5 rounded bg-emerald-500/15 px-1.5 text-xs font-bold text-emerald-300">live</span> : null}</td>
            <td className="px-2 py-2"><Badge ok={FEED_BADGE[p.state].ok}>{FEED_BADGE[p.state].text}</Badge></td>
            <td className="num px-2 py-2 text-slate-300">{p.last_success_at ? `${ageOf(p.last_success_at)} ago` : "never"}</td>
            <td className="num px-2 py-2 text-slate-300">{p.consecutive_failures || ""}</td>
            <td className="break-words px-2 py-2 text-slate-400">{p.last_error ? `${p.last_error}${p.last_error_at ? ` (${ageOf(p.last_error_at)} ago)` : ""}` : ""}</td>
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return <div className="rounded-xl bg-ink-900 px-3 py-2"><div className="text-xs uppercase tracking-wider text-slate-400">{label}</div><div className="num text-xl font-black">{value}</div></div>;
}

function Events({ rows }: { rows: EventRecord[] }) {
  return (
    <div className="h-72 overflow-x-auto rounded-xl bg-ink-900 -mx-1 sm:mx-0" tabIndex={0} role="region" aria-label="Recent events">
      <table className="w-full min-w-[560px] table-fixed text-left text-xs sm:text-sm">
        <thead className="sticky top-0 bg-ink-900 text-[11px] uppercase tracking-wider text-slate-400 border-b border-white/5">
          <tr>
            <th className="w-[84px] px-3 py-2">Time</th>
            <th className="w-[26%] px-2">Event</th>
            <th className="w-[16%] px-2">Game</th>
            <th className="w-[96px] px-2">Outcome</th>
            <th className="px-2">Reason</th>
            <th className="w-[22%] px-2">Sent</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && <tr><td colSpan={6} className="px-3 py-8 text-center text-slate-400">No events yet. Fire a manual trigger to see one here.</td></tr>}
          {rows.map((r) => (
            <tr key={`${r.event_id}-${r.at}`} className="border-t border-white/5 align-top">
              <td className="num whitespace-nowrap px-3 py-2 text-slate-300">{new Date(r.at).toLocaleTimeString([], { hour12: false })}</td>
              <td className="truncate px-2 py-2"><span className="font-semibold">{r.type}</span>{r.label ? <span className="text-slate-400"> {r.label}</span> : null}{r.manual ? <span className="ml-1 rounded bg-violet-500/20 px-1.5 text-xs font-bold text-violet-300">manual</span> : null}</td>
              <td className="truncate px-2 py-2 text-slate-300">{r.league.toUpperCase()}{r.team ? ` ${r.team}` : ""}</td>
              <td className="px-2 py-2"><Badge ok={r.outcome === "delivered"}>{r.outcome}</Badge></td>
              <td className="px-2 py-2 text-slate-400">{r.reason ?? ""}</td>
              <td className="num px-2 py-2 text-slate-300">{r.sent.pusher_clients} HA · {r.sent.rest ? "REST" : "no REST"} · {r.sent.lights} lights</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function StatusPanel({ status, active, forceExpand }: { status: Poll<Status>; active: boolean; forceExpand?: boolean | undefined }) {
  const [expanded, setExpanded] = useState(false);
  const events = usePoll(() => api.recentEvents(50), 5000, active && expanded);
  const [copied, setCopied] = useState(false);
  const s = status.data;
  const now = useNow();

  useEffect(() => {
    if (forceExpand) setExpanded(true);
  }, [forceExpand]);

  const stale = !!status.err && !!s;
  const sinceOk = status.at ? now - status.at : 0;
  const ageOf = (t: number | null) => (t === null ? "" : fmtAgo((s?.server_time ?? status.at ?? now) - t + sinceOk));
  const copy = async () => {
    await copyText(CHECKLIST);
    setCopied(true); setTimeout(() => setCopied(false), 1800);
  };

  const health = healthOf(status);

  return (
    <Card
      id="status"
      title="System Status & Diagnostics"
      subtitle="Operational health, score provider feeds, and automated event delivery logs."
      actions={
        <div className="flex items-center gap-2">
          {s && <span className="hidden text-xs text-slate-400 sm:inline">v{s.version} · up {fmtUp(s.uptime_s)}</span>}
          <Button
            onClick={() => setExpanded(!expanded)}
            variant={expanded ? "secondary" : "primary"}
            className="text-xs"
          >
            {expanded ? "Hide Details" : "Inspect Diagnostics"}
          </Button>
        </div>
      }
    >
      {status.err && (
        <div className="mb-3">
          <Notice kind="err">
            {s
              ? `Cannot reach the server (${status.err}). Showing cached numbers from ${status.at ? `${fmtAgo(sinceOk)} ago` : "earlier"}.`
              : `Could not load status: ${status.err}`}
          </Notice>
        </div>
      )}

      {/* Summary Row: Always Visible */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-ink-900 p-3">
        <div className="flex items-center gap-2">
          <span className={`h-3 w-3 rounded-full ${HEALTH_CLS[health]}`} />
          <span className="font-bold text-sm text-white">
            {health === "ok" ? "All Systems Operational" : health === "warn" ? "System Warnings Active" : "System Error"}
          </span>
        </div>
        {s && (
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-300">
            <span className="rounded bg-black/40 px-2 py-1">
              <strong>{s.games.live}</strong> live / <strong>{s.games.tracked}</strong> tracked
            </span>
            <span className="rounded bg-black/40 px-2 py-1">
              HA integration: <strong>{s.outputs.pusher_connected ? "connected" : "standby"}</strong>
            </span>
            <span className="rounded bg-black/40 px-2 py-1">
              Horns: <strong>{s.horns.files}</strong> installed
            </span>
          </div>
        )}
      </div>

      {/* Expanded Technical View */}
      {expanded && s && (
        <div className={`mt-5 flex flex-col gap-5 border-t border-white/10 pt-5 transition-opacity ${stale ? "opacity-40 grayscale" : ""}`} aria-busy={stale} data-stale={stale ? "true" : "false"}>
          {stale && <p className="text-sm font-semibold text-slate-300" role="status">Last updated {status.at ? `${fmtAgo(sinceOk)} ago` : "earlier"}</p>}
          <div className="flex flex-col gap-2" aria-label="Warnings">
            {s.warnings.length === 0 ? <Notice kind="ok">All health checks pass. No active warnings.</Notice> : s.warnings.map((w) => (
              <div key={w} role="status" className={`rounded-lg border px-3 py-2 text-sm ${SEV[sevOf(w)]}`}>{w}</div>
            ))}
          </div>

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat label="Games tracked" value={s.games.tracked} />
            <Stat label="Live" value={s.games.live} />
            <Stat label="Synced" value={s.games.synced} />
            <Stat label="HA Devices" value={s.integration.devices} />
          </div>

          <div>
            <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-400">Score Data Feeds</h3>
            <p className="mb-2 text-xs text-slate-400">Unofficial ESPN and NHL data feeds polled by Homeroom:</p>
            <Feeds rows={s.providers ?? []} ageOf={ageOf} />
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            <div className="rounded-xl bg-ink-900 p-3">
              <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-400">Integration Links</h3>
              {s.integration.links.length === 0 && <p className="text-xs text-slate-400">No HA integration connected yet.</p>}
              <ul className="flex flex-col gap-2">{s.integration.links.map((l) => (
                <li key={l.id} className="text-xs">
                  <div className="truncate font-mono text-slate-400" title={l.id}>{l.id}</div>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    <Badge ok={l.events_connected}>events {l.events_connected ? "connected" : "offline"}</Badge>
                    <Badge ok={l.devices_connected}>devices {l.devices_connected ? "connected" : "offline"}</Badge>
                  </div>
                </li>
              ))}</ul>
            </div>
            <div className="rounded-xl bg-ink-900 p-3">
              <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-400">Audio Server</h3>
              <div className="flex flex-wrap gap-1.5">
                <Badge ok={s.horns.files > 0}>{s.horns.files} file{s.horns.files === 1 ? "" : "s"}</Badge>
                <Badge ok={s.horns.url_check.ok}>{s.horns.url_check.ok === null ? "URL not checked" : s.horns.url_check.ok ? "Reachable" : "Unreachable"}</Badge>
              </div>
              <p className="mt-2 break-words text-xs text-slate-400">{s.horns.url_check.detail}</p>
            </div>
            <div className="rounded-xl bg-ink-900 p-3">
              <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-400">Automation Flags</h3>
              <div className="flex flex-wrap gap-1.5">
                <Badge ok={s.outputs.pusher_connected}>HA Pusher {s.outputs.pusher_connected ? "active" : "standby"}</Badge>
                <Badge ok={s.outputs.rest_events ? true : null}>REST {s.outputs.rest_events ? "enabled" : "disabled"}</Badge>
              </div>
              <p className="mt-2 text-xs text-slate-400">
                My team only: <strong>{s.flags.my_team_only ? "yes" : "no"}</strong> · Automations: <strong>{s.flags.automations_enabled ? "enabled" : "disabled"}</strong>
              </p>
            </div>
          </div>

          <div>
            <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-400">Recent Automated Events (Last 50)</h3>
            {events.err && <div className="mb-2"><Notice kind="err">Could not load events: {events.err}</Notice></div>}
            <Events rows={events.data ?? []} />
          </div>

          <div className="rounded-xl bg-ink-900 p-3">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400">Post-deploy verification checklist</h3>
              <Button onClick={() => void copy()} aria-live="polite" className="text-xs">
                {copied ? "Copied" : "Copy Checklist"}
              </Button>
            </div>
            <pre className="whitespace-pre-wrap break-words text-xs text-slate-300 font-mono">{CHECKLIST}</pre>
          </div>
        </div>
      )}
    </Card>
  );
}
