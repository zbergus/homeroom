import { useState } from "react";
import { Button, Card } from "../components/ui";
import { isMockUrl } from "../lib/live";
import { copyText } from "../lib/clipboard";

const VIEWS = [
  { path: "/scoreboard?game=auto", name: "Scoreboard", desc: "Full-screen scoreboard for your synced game" },
  { path: "/grid", name: "SportsGrid", desc: "Every game on one screen. Add ?only=mine to show only your teams and synced games." },
  { path: "/grid?only=mine", name: "SportsGrid (my teams)", desc: "Only games for your favourite teams and synced games; follows changes you make here" },
  { path: "/ticker", name: "Ticker", desc: "LED-style scrolling scores (add ?only=mine for your teams)" },
];

export default function KioskLinks({ base }: { base: string }) {
  const [copied, setCopied] = useState("");
  const origin = (base || location.origin).replace(/\/$/, "");
  const copy = async (url: string) => {
    await copyText(url);
    setCopied(url); setTimeout(() => setCopied(""), 1800);
  };
  return (
    <Card title="TV views" subtitle="Open on a TV browser or kiosk. Copy the URL for Fully Kiosk, a Chromecast tab, or a Pi.">
      <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {VIEWS.map((v) => {
          const url = origin + v.path;
          return (
            <li key={v.path} className="flex flex-col gap-2 rounded-xl bg-ink-900 p-4">
              <div className="font-bold">{v.name}</div>
              <p className="text-sm text-slate-400">{v.desc}</p>
              <code className="block break-all rounded bg-black/40 px-2 py-1.5 text-xs text-slate-300">{url}</code>
              <div className="mt-auto flex gap-2 pt-1">
                <a href={v.path + (isMockUrl() ? (v.path.includes("?") ? "&" : "?") + "mock=1" : "")} target="_blank" rel="noreferrer" className="inline-flex min-h-[40px] flex-1 items-center justify-center rounded-lg bg-accent px-4 text-sm font-semibold text-white hover:bg-accent-soft focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-soft">Open <span className="sr-only">{v.name} in new tab</span></a>
                <Button className="flex-1" onClick={() => copy(url)} aria-live="polite">{copied === url ? "Copied" : "Copy URL"}</Button>
              </div>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
