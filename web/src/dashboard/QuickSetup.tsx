import { useState } from "react";
import type { Settings, SyncState } from "../types";
import { Button } from "../components/ui";

const DISMISSED_KEY = "homeroom.quick_setup_dismissed";

interface Props {
  settings: Settings | null;
  sync: SyncState;
  onNavigate: (tab: "games" | "celebrations" | "displays" | "settings") => void;
  onOpenTeamPicker?: () => void;
}

export default function QuickSetup({ settings, sync, onNavigate }: Props) {
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem(DISMISSED_KEY) === "1";
    } catch {
      return false;
    }
  });

  const dismiss = () => {
    try {
      localStorage.setItem(DISMISSED_KEY, "1");
    } catch {
      /* ignore */
    }
    setDismissed(true);
  };

  const resetDismiss = () => {
    try {
      localStorage.removeItem(DISMISSED_KEY);
    } catch {
      /* ignore */
    }
    setDismissed(false);
  };

  const haConnected = !!settings?.ha.url && !!settings?.ha.token_set;
  const hasFavorites = sync.favorites.length > 0;

  // If already dismissed, don't show the full card, but show a tiny reopen pill if not configured
  if (dismissed) {
    if (!haConnected && !hasFavorites) {
      return (
        <div className="flex items-center justify-between rounded-xl border border-accent/20 bg-accent/5 px-4 py-2.5 text-xs text-slate-300">
          <span>First time here? Follow the setup checklist to connect Home Assistant and pick your teams.</span>
          <button type="button" onClick={resetDismiss} className="font-semibold text-accent hover:underline">
            Open Setup Checklist
          </button>
        </div>
      );
    }
    return null;
  }

  const steps = [
    {
      num: 1,
      title: "Connect Home Assistant",
      desc: haConnected ? "Connected (REST events & volume ready)" : "Add your HA URL & long-lived token for lights and horn volume.",
      done: haConnected,
      actionText: haConnected ? "Edit" : "Connect",
      action: () => onNavigate("settings"),
    },
    {
      num: 2,
      title: "Choose Your Teams",
      desc: hasFavorites
        ? `${sync.favorites.length} team${sync.favorites.length === 1 ? "" : "s"} followed`
        : "Follow your teams so games are watched automatically without manual scheduling.",
      done: hasFavorites,
      actionText: hasFavorites ? "Manage" : "Pick Teams",
      action: () => onNavigate("settings"),
    },
    {
      num: 3,
      title: "Goal Horns & Lights",
      desc: "Customize light flashes and goal horn audio to play when your team scores.",
      done: false,
      actionText: "Customize",
      action: () => onNavigate("celebrations"),
    },
    {
      num: 4,
      title: "Launch TV Scoreboard",
      desc: "Open full-screen live scoreboards, game grid, or LED ticker on your TV or tablet.",
      done: false,
      actionText: "View Screens",
      action: () => onNavigate("displays"),
    },
  ];

  const completedCount = (haConnected ? 1 : 0) + (hasFavorites ? 1 : 0);

  return (
    <div className="relative overflow-hidden rounded-2xl border border-accent/30 bg-gradient-to-br from-ink-800 to-ink-900 p-5 shadow-lg">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 pb-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="grid h-6 w-6 place-items-center rounded-full bg-accent text-xs font-black text-white">✓</span>
            <h2 className="text-base font-black tracking-tight text-white sm:text-lg">Quick Setup Checklist</h2>
            <span className="rounded-full bg-accent/20 px-2 py-0.5 text-xs font-bold text-accent-soft">
              {completedCount} of 4 complete
            </span>
          </div>
          <p className="mt-1 text-xs text-slate-400 sm:text-sm">
            Get your room ready for game day in four quick steps.
          </p>
        </div>
        <Button onClick={dismiss} variant="secondary" className="text-xs">
          Dismiss
        </Button>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {steps.map((s) => (
          <div
            key={s.num}
            className={`flex flex-col justify-between rounded-xl border p-3.5 transition ${
              s.done
                ? "border-emerald-500/30 bg-emerald-500/5 text-slate-200"
                : "border-white/10 bg-black/20 hover:border-accent/40"
            }`}
          >
            <div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-400">Step {s.num}</span>
                {s.done && (
                  <span className="inline-flex items-center gap-1 rounded bg-emerald-500/20 px-1.5 py-0.5 text-[11px] font-bold text-emerald-300">
                    Done
                  </span>
                )}
              </div>
              <h3 className="mt-1 text-sm font-bold text-white">{s.title}</h3>
              <p className="mt-1 text-xs leading-relaxed text-slate-400">{s.desc}</p>
            </div>
            <div className="mt-3 pt-2">
              <Button
                variant={s.done ? "secondary" : "primary"}
                onClick={s.action}
                className="w-full text-xs"
              >
                {s.actionText}
              </Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
