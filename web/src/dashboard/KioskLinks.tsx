import { useState } from "react";
import { Button, Card } from "../components/ui";
import { isMockUrl } from "../lib/live";
import { copyText } from "../lib/clipboard";

interface KioskLinkItem {
  path: string;
  name: string;
  desc: string;
  category: "primary" | "companion" | "preset";
}

const VIEWS: KioskLinkItem[] = [
  // Primary TV Views
  { path: "/scoreboard?game=auto", name: "Scoreboard", desc: "Full-screen broadcast scoreboard for your synced game", category: "primary" },
  { path: "/grid", name: "Multiview Grid", desc: "Every game on one screen with live goal pulses and powerplay badges", category: "primary" },
  { path: "/grid?only=mine", name: "Multiview Grid (my teams)", desc: "Only games for your favourite teams and synced games", category: "primary" },
  { path: "/ticker", name: "Dual-Banner Ticker", desc: "Full-colour dual-banner LED scrolling score ticker", category: "primary" },

  // Companion Screens
  { path: "/matchup?game=auto", name: "Matchup / VS Screen", desc: "Dedicated pregame matchup with puck drop countdown, starting goalie duel, team crests, and records", category: "companion" },
  { path: "/plate?game=auto", name: "Scoreboard Plate", desc: "Compact scoreboard plate for secondary screens without break-screen takeovers", category: "companion" },
  { path: "/plate?team=auto", name: "Single-Team Score Plate", desc: "Score plate dedicated to your followed team with team colors, opponent context, and power play alerts", category: "companion" },
  { path: "/tracker?game=auto", name: "Player Tracker", desc: "Live on-ice skater stats (TOI, SOG, +/-, goals, assists) and goalie performance companion screen", category: "companion" },

  // Multi-Pane Presets
  { path: "/screen/mancave-main", name: "Mancave Main Display", desc: "Multi-pane preset: 70/30 split of primary live scoreboard + side player tracker", category: "preset" },
  { path: "/screen/dual", name: "Dual Display (50/50)", desc: "Multi-pane preset: 50/50 horizontal split of scoreboard and live ticker", category: "preset" },
  { path: "/screen/grid-ticker", name: "Grid + Ticker Banner", desc: "Multi-pane preset: multi-game grid on top with live ticker banner on bottom", category: "preset" },
  { path: "/screen/quad", name: "Quad Companion 2x2", desc: "Multi-pane preset: 4-way split of Scoreboard, Player Tracker, Plate, and Ticker", category: "preset" },
];

const CATEGORIES: { key: KioskLinkItem["category"]; label: string }[] = [
  { key: "primary", label: "Primary TV Views" },
  { key: "companion", label: "Companion Screens & Score Plates" },
  { key: "preset", label: "Multi-Pane Presets" },
];

export default function KioskLinks({ base }: { base: string }) {
  const [copied, setCopied] = useState("");
  const origin = (base || location.origin).replace(/\/$/, "");
  const copy = async (url: string) => {
    await copyText(url);
    setCopied(url);
    setTimeout(() => setCopied(""), 1800);
  };

  return (
    <Card title="TV Views & Kiosk Quick Links" subtitle="Open on any TV browser or kiosk. Copy the URL for Fully Kiosk, Chromecast, or Raspberry Pi.">
      <div className="flex flex-col gap-6">
        {CATEGORIES.map((cat) => {
          const links = VIEWS.filter((v) => v.category === cat.key);
          return (
            <div key={cat.key}>
              <h3 className="mb-2 text-sm font-bold uppercase tracking-wider text-slate-300">{cat.label}</h3>
              <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                {links.map((v) => {
                  const url = origin + v.path;
                  return (
                    <li key={v.path} className="flex flex-col gap-2 rounded-xl bg-ink-900 p-4 border border-white/5">
                      <div className="font-bold text-white">{v.name}</div>
                      <p className="text-xs text-slate-400">{v.desc}</p>
                      <code className="block break-all rounded bg-black/40 px-2 py-1.5 text-[11px] text-slate-300 font-mono mt-auto">{url}</code>
                      <div className="mt-2 flex gap-2 pt-1 border-t border-white/5">
                        <a
                          href={v.path + (isMockUrl() ? (v.path.includes("?") ? "&" : "?") + "mock=1" : "")}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex min-h-[38px] flex-1 items-center justify-center rounded-lg bg-accent px-3 text-xs font-bold text-white hover:bg-accent-soft focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-soft"
                        >
                          Open <span className="sr-only">{v.name} in new tab</span> ↗
                        </a>
                        <Button className="min-h-[38px] flex-1 text-xs" onClick={() => copy(url)} aria-live="polite">
                          {copied === url ? "Copied" : "Copy URL"}
                        </Button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
