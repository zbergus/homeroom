import { useState } from "react";
import type { Team } from "../types";
import type { ConnState } from "../lib/live";
import { teamColors } from "../lib/format";

/**
 * Round team badge. `plain` draws the logo with no disc behind it (hero / banners) and falls back
 * to an initials disc; `ring` is the fallback disc colour (defaults to the team's solo colour).
 */
export function TeamBadge({ team, size, className = "", plain = false, ring }: { team: Team; size: string; className?: string | undefined; plain?: boolean | undefined; ring?: string | undefined }) {
  const [bad, setBad] = useState(false);
  const { primary } = teamColors(team);
  const logo = team.logo && !bad ? team.logo : undefined;
  if (plain && logo) {
    return (
      <span className={`inline-flex shrink-0 items-center justify-center ${className}`} style={{ width: size, height: size }} aria-hidden>
        <img src={logo} alt="" className="h-full w-full object-contain" style={{ filter: "drop-shadow(0 .04em .12em rgba(0,0,0,.45))" }} onError={() => setBad(true)} />
      </span>
    );
  }
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full font-extrabold text-white ${className}`}
      style={{ width: size, height: size, background: logo ? "rgba(255,255,255,.92)" : ring ?? primary, fontSize: `calc(${size} * .34)`, boxShadow: "inset 0 0 0 .06em rgba(255,255,255,.4)" }}
      aria-hidden
    >
      {logo ? <img src={logo} alt="" className="h-[78%] w-[78%] object-contain" onError={() => setBad(true)} /> : team.abbr.slice(0, 3)}
    </span>
  );
}

/** Tiny, unobtrusive connection indicator for kiosk views. */
export function ConnDot({ conn }: { conn: ConnState }) {
  const color = conn === "open" ? "#22c55e" : conn === "mock" ? "#a78bfa" : conn === "connecting" ? "#f59e0b" : "#ef4444";
  return (
    <span
      role="status"
      aria-label={`connection ${conn}`}
      title={conn}
      className="fixed bottom-[0.6vmin] right-[0.6vmin] z-50 block rounded-full"
      style={{ width: "0.9vmin", height: "0.9vmin", minWidth: 5, minHeight: 5, background: color, opacity: conn === "open" ? 0.35 : 0.9 }}
    />
  );
}
