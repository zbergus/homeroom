import { useState } from "react";
import { Button, Card, Field, inputCls, Switch } from "../components/ui";
import { isMockUrl } from "../lib/live";
import { copyText } from "../lib/clipboard";

interface ScreenDef {
  id: "scoreboard" | "matchup" | "plate" | "tracker" | "grid" | "ticker" | "screen";
  basePath: string;
  name: string;
  tagline: string;
  desc: string;
  bestFor: string;
  aspect: string;
  category: "primary" | "companion" | "preset";
}

const SCREENS: ScreenDef[] = [
  {
    id: "scoreboard",
    basePath: "/scoreboard?game=auto",
    name: "Scoreboard",
    tagline: "Broadcast-style full-screen TV experience",
    desc: "Dynamic live scoreboard with team-colour split, live clock, SOG (Shots on Goal), powerplay badges, goal celebration strobe, and intermission break screens (game stats & period summary). Automatically tracks your synced game.",
    bestFor: "Living room TV, Man cave big screen, Wall display",
    aspect: "16:9 Landscape or Portrait",
    category: "primary",
  },
  {
    id: "grid",
    basePath: "/grid",
    name: "Multiview Grid",
    tagline: "Multi-game matrix slate with live goal pulses",
    desc: "Grid of diagonal team-colour cards showing live and upcoming games across your enabled leagues with live goal pulses and powerplay badges.",
    bestFor: "Sports bar wall, multi-game game days",
    aspect: "Landscape 1080p / 4K (4 columns)",
    category: "primary",
  },
  {
    id: "ticker",
    basePath: "/ticker",
    name: "Arena Ticker",
    tagline: "Arena-style scrolling ticker strip",
    desc: "Dual-banner horizontal scrolling score ticker with full team colors, live clocks, empty-net alerts, and power play situation badges.",
    bestFor: "LED ticker display, Ultrawide bar screen, Bottom TV strip",
    aspect: "Narrow ribbon / Ultrawide",
    category: "primary",
  },
  {
    id: "matchup",
    basePath: "/matchup?game=auto",
    name: "Matchup / VS Screen",
    tagline: "Dedicated pregame matchup face-off",
    desc: "Shows the upcoming puck drop countdown, starting goalie duel (probables & confirmed starters with season GAA, SV% and record), team crests, and season records. Supports ?team=BOS or ?game=auto.",
    bestFor: "Pregame anticipation display, bar header, companion display",
    aspect: "16:9 Landscape or Portrait",
    category: "companion",
  },
  {
    id: "plate",
    basePath: "/plate?game=auto",
    name: "Scoreboard Plate",
    tagline: "Compact live plate without takeovers",
    desc: "Centred clock with scores flanking it, period label, SOG and corner wedges. Supports single-team mode via ?team=BOS or ?team=auto dedicated to your followed team.",
    bestFor: "Secondary desk screen, Pi monitor, Stream overlay",
    aspect: "Any resolution, 16:9 or ultrawide",
    category: "companion",
  },
  {
    id: "tracker",
    basePath: "/tracker?game=auto",
    name: "Player Tracker",
    tagline: "Live on-ice skater & goalie companion display",
    desc: "Real-time on-ice skater stats (TOI, SOG, +/-, goals, assists), goalie duel performance (saves, shots against, SV%), and toggleable player-to-watch cards with recent game logs.",
    bestFor: "Secondary mancave tablet/monitor, companion desk display",
    aspect: "16:9 Landscape or Portrait",
    category: "companion",
  },
  {
    id: "screen",
    basePath: "/screen/mancave-main",
    name: "Multi-Pane Screen",
    tagline: "Composable companion multi-pane TV kiosk presets",
    desc: "Named split presets (mancave-main, dual, grid-ticker, quad, triple) with custom split ratios and embedded child views for whole-room multi-screen displays.",
    bestFor: "Mancave main TV, multi-view wall, multi-game companion setup",
    aspect: "16:9 Landscape, Portrait, or Ultrawide",
    category: "preset",
  },
];

const CATEGORIES: { key: ScreenDef["category"]; title: string; subtitle: string }[] = [
  { key: "primary", title: "Primary TV Views", subtitle: "Full-screen displays designed for main living room and sports bar TVs" },
  { key: "companion", title: "Companion Screens & Plates", subtitle: "Focused secondary displays for tablets, Pi monitors, pregame face-offs, and stats" },
  { key: "preset", title: "Multi-Pane Presets", subtitle: "Split-screen composite layouts embedding multiple simultaneous views" },
];

export default function Displays({ base }: { base: string }) {
  const [copied, setCopied] = useState("");
  const origin = (base || location.origin).replace(/\/$/, "");

  // Interactive URL Customizers
  const [leagueFilter, setLeagueFilter] = useState<string>("");
  const [onlyMine, setOnlyMine] = useState<boolean>(false);
  const [sbMode, setSbMode] = useState<"default" | "hero_only" | "no_rotate">("default");

  const copy = async (url: string) => {
    await copyText(url);
    setCopied(url);
    setTimeout(() => setCopied(""), 1800);
  };

  const buildUrl = (screen: ScreenDef): string => {
    const parts: string[] = [];
    if (screen.id === "scoreboard") {
      parts.push("game=auto");
      if (leagueFilter) parts.push(`league=${leagueFilter}`);
      if (onlyMine) parts.push("only=mine");
      if (sbMode === "hero_only") parts.push("hero_only=1");
      if (sbMode === "no_rotate") parts.push("break_rotate=0");
    } else if (screen.id === "matchup") {
      parts.push("game=auto");
      if (leagueFilter) parts.push(`league=${leagueFilter}`);
      if (onlyMine) parts.push("only=mine");
    } else if (screen.id === "plate") {
      parts.push("game=auto");
      if (leagueFilter) parts.push(`league=${leagueFilter}`);
      if (onlyMine) parts.push("only=mine");
    } else if (screen.id === "tracker") {
      parts.push("game=auto");
      if (leagueFilter) parts.push(`league=${leagueFilter}`);
      if (onlyMine) parts.push("only=mine");
    } else if (screen.id === "grid" || screen.id === "ticker") {
      if (leagueFilter) parts.push(`league=${leagueFilter}`);
      if (onlyMine) parts.push("only=mine");
    } else if (screen.id === "screen") {
      if (leagueFilter) parts.push(`league=${leagueFilter}`);
      if (onlyMine) parts.push("only=mine");
      return `${origin}/screen/mancave-main${parts.length ? `?${parts.join("&")}` : ""}`;
    }

    const path = `/${screen.id}${parts.length ? `?${parts.join("&")}` : ""}`;
    return `${origin}${path}`;
  };

  const getFullUrl = (screen: ScreenDef): string => {
    const url = buildUrl(screen);
    if (!isMockUrl()) return url;
    return `${url}${url.includes("?") ? "&" : "?"}mock=1`;
  };

  return (
    <div className="flex flex-col gap-6">
      {/* 1. URL Customizer Controls */}
      <Card
        title="Display Controls & Preset Builder"
        subtitle="Customize URL parameters below to configure which games or modes appear on your kiosks."
      >
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="League Filter" hint="Filter to NHL, AHL, or IIHF tournaments">
            <select
              className={inputCls}
              value={leagueFilter}
              onChange={(e) => setLeagueFilter(e.target.value)}
            >
              <option value="">All Active Leagues</option>
              <option value="nhl">NHL only</option>
              <option value="iihf">IIHF Tournaments only</option>
              <option value="ahl">AHL only</option>
            </select>
          </Field>

          <Field label="Scoreboard Intermission Mode" hint="Applies to /scoreboard view">
            <select
              className={inputCls}
              value={sbMode}
              onChange={(e) => setSbMode(e.target.value as "default" | "hero_only" | "no_rotate")}
            >
              <option value="default">Default (Scoreboard + Break Screens)</option>
              <option value="hero_only">Hero Only (Never show side panel)</option>
              <option value="no_rotate">Lock Live (Never rotate to intermission screens)</option>
            </select>
          </Field>

          <div className="flex items-center gap-3 self-end pb-2">
            <Switch checked={onlyMine} onChange={setOnlyMine} label="Only My Teams" />
            <div>
              <div className="text-sm font-medium">Followed Teams Only</div>
              <div className="text-xs text-slate-400">Restricts screens to your starred teams.</div>
            </div>
          </div>
        </div>
      </Card>

      {/* 2. Screen Cards Grouped by Category */}
      {CATEGORIES.map((cat) => {
        const screens = SCREENS.filter((s) => s.category === cat.key);
        return (
          <Card key={cat.key} title={cat.title} subtitle={cat.subtitle}>
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {screens.map((s) => {
                const displayUrl = buildUrl(s);
                const fullUrl = getFullUrl(s);
                return (
                  <div
                    key={s.id}
                    className="flex flex-col justify-between rounded-xl border border-white/10 bg-ink-900 p-4 transition hover:border-white/20"
                  >
                    <div>
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <h3 className="font-bold text-white text-base">{s.name}</h3>
                        <span className="rounded bg-accent/15 px-2 py-0.5 text-xs font-semibold text-accent-soft">
                          {s.aspect}
                        </span>
                      </div>
                      <div className="text-xs font-medium text-slate-400 mt-0.5">{s.tagline}</div>
                      <p className="mt-2 text-xs leading-relaxed text-slate-300">{s.desc}</p>
                      <div className="mt-2 text-[11px] text-slate-400">
                        <span className="font-semibold text-slate-300">Best for: </span>
                        {s.bestFor}
                      </div>
                    </div>

                    <div className="mt-4 flex flex-col gap-2 pt-2 border-t border-white/5">
                      <code className="block break-all rounded bg-black/40 px-2 py-1 text-[11px] text-slate-400 font-mono">
                        {displayUrl}
                      </code>
                      <div className="flex gap-2">
                        <a
                          href={fullUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex min-h-[38px] flex-1 items-center justify-center rounded-lg bg-accent px-3 text-xs font-bold text-white hover:bg-accent-soft focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent-soft"
                        >
                          Open Screen ↗
                        </a>
                        <Button
                          className="min-h-[38px] flex-1 text-xs"
                          onClick={() => void copy(displayUrl)}
                          aria-live="polite"
                        >
                          {copied === displayUrl ? "Copied!" : "Copy URL"}
                        </Button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>
        );
      })}

      {/* 3. Kiosk Setup Guide */}
      <Card
        title="Display Tips & Multi-Screen Setups"
        subtitle="How to run Homeroom screens in full-screen on your devices without address bars or sleep timeouts."
      >
        <div className="grid gap-3 sm:grid-cols-3 text-xs leading-relaxed text-slate-300">
          <div className="rounded-xl bg-ink-900 p-3.5 border border-white/5">
            <h4 className="font-bold text-white mb-1">Fire TV / Android TV</h4>
            <p className="text-slate-400 mb-2">
              Install <strong>Fully Kiosk Browser</strong> or open Amazon Silk. Set the URL as startup page and enable Fullscreen Mode and Keep Screen On.
            </p>
          </div>
          <div className="rounded-xl bg-ink-900 p-3.5 border border-white/5">
            <h4 className="font-bold text-white mb-1">Raspberry Pi Kiosk</h4>
            <p className="text-slate-400 mb-2">
              Launch Chromium in kiosk mode on boot:
            </p>
            <code className="block rounded bg-black/50 p-1.5 text-[10px] text-slate-300 font-mono break-all">
              chromium-browser --kiosk --noerrdialogs --disable-infobars [URL]
            </code>
          </div>
          <div className="rounded-xl bg-ink-900 p-3.5 border border-white/5">
            <h4 className="font-bold text-white mb-1">Multi-Screen Man Caves</h4>
            <p className="text-slate-400 mb-2">
              Run Scoreboard on your main TV, Multiview Grid on a side monitor, Arena Ticker on an ultrawide bar strip, and multi-pane presets on secondary TVs!
            </p>
          </div>
        </div>
      </Card>
    </div>
  );
}
