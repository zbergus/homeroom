import type { Game, GameLite, SyncState } from "../types";
import { countdown, startMs, timeLabel } from "../lib/format";
import { TeamBadge } from "../components/Kiosk";

export const FINAL_MS = 10 * 60_000;
export const PRE_WINDOW_MS = 60 * 60_000;
/** Games that started > 4 hours ago cannot have just gone final within the last 10 minutes */
export const MAX_FINAL_START_AGE_MS = 4 * 3600_000;

const U = (n: number) => `calc(var(--u) * ${n})`;

export function trackFinalSeen(all: Iterable<Game>, finalSeen: Map<string, number>, now: number): void {
  for (const g of all) {
    if (g.status === "post" && !finalSeen.has(g.id)) {
      const started = startMs(g);
      if (started && now - started > MAX_FINAL_START_AGE_MS) {
        finalSeen.set(g.id, 0); // Stale/yesterday's game: mark as expired immediately
      } else {
        finalSeen.set(g.id, now);
      }
    }
  }
}

export function pick(
  games: Game[],
  want: string,
  sync: SyncState | null | undefined,
  finalSeen: Map<string, number>,
  now: number,
): Game | undefined {
  if (want !== "auto") return games.find((g) => g.id === want);
  const pool = !sync ? [] : games.filter((g) => (sync.effective ?? sync.games).includes(g.id));
  const rank = (g: Game) => {
    if (g.status === "in") return g.intermission ? 1 : 0;
    if (g.status === "pre") return 2;
    const started = startMs(g);
    if (started && now - started > MAX_FINAL_START_AGE_MS) return 9;
    const seenAt = finalSeen.get(g.id);
    if (seenAt === undefined || now - seenAt >= FINAL_MS) return 9;
    return 3;
  };
  return [...pool]
    .filter((g) => rank(g) < 9)
    .sort((a, b) => rank(a) - rank(b) || startMs(a) - startMs(b))[0];
}

/** `next` is decided by the caller: in auto mode only my games count, never another league's slate. */
export function IdleScreen({ next, now, loading }: { next: GameLite | null | undefined; now: number; loading?: boolean | undefined }) {
  return (
    <div className="fade-in absolute inset-0 flex flex-col items-center justify-center text-center text-white" style={{ background: "radial-gradient(80% 80% at 50% 40%, #16203a, #07090f)", gap: U(2.5) }}>
      <div className="font-black tracking-[.3em] opacity-50" style={{ fontSize: U(3) }}>HOMEROOM</div>
      {next ? (
        <>
          <div className="uppercase tracking-[.25em] opacity-70 font-bold" style={{ fontSize: U(2.2) }}>Next game</div>
          <div className="flex items-center" style={{ gap: U(3) }}>
            <TeamBadge team={next.away} size={U(11)} />
            <span className="font-black" style={{ fontSize: U(4.5) }}>{next.away.abbr} @ {next.home.abbr}</span>
            <TeamBadge team={next.home} size={U(11)} />
          </div>
          <div className="num font-black" style={{ fontSize: U(12) }}>{countdown(startMs(next) - now)}</div>
          <div className="opacity-70" style={{ fontSize: U(2.4) }}>{new Date(startMs(next)).toLocaleDateString([], { weekday: "long" })} {timeLabel(startMs(next))}</div>
        </>
      ) : (
        !loading && <div className="opacity-70" style={{ fontSize: U(4) }}>No upcoming games for your teams</div>
      )}
    </div>
  );
}
