import type { GameLite, Settings, SyncState } from "../types";
import { Button, Card } from "../components/ui";
import Next24h from "./Next24h";
import AdminUnlock from "./AdminUnlock";
import { SCREENS, screenHref, type ScreenDef } from "./Displays";
import type { Poll } from "./usePoll";

type Tab = "games" | "celebrations" | "displays" | "settings";

interface Props {
  settings: Settings | null;
  sync: SyncState;
  schedule: Poll<{ days: { date: string; games: GameLite[] }[] }>;
  base: string;
  locked: boolean;
  onNavigate: (tab: Tab) => void;
  onUnlock: (token: string) => void;
}

const QUICK_SCREENS = SCREENS.filter(
  (s) => s.id === "scoreboard" || s.id === "grid" || s.id === "ticker" || s.id === "matchup" || s.id === "plate" || s.id === "tracker" || s.basePath === "/screen/mancave-main",
);

function DisplayCard({ screen, base }: { screen: ScreenDef; base: string }) {
  const href = screenHref(screen, base);
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="flex min-h-[104px] flex-col justify-between rounded-xl border border-white/10 bg-ink-900 p-3.5 transition hover:border-accent/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent-soft"
    >
      <div>
        <div className="font-bold text-white">{screen.name}</div>
        <div className="mt-0.5 text-xs text-slate-400">{screen.tagline}</div>
      </div>
      <div className="mt-2 text-xs font-bold text-accent-soft">Open screen ↗</div>
    </a>
  );
}

/** Landing view: who you follow, what's on next, and one click to any display. Never writes on its own. */
export default function Home({ settings, sync, schedule, base, locked, onNavigate, onUnlock }: Props) {
  return (
    <div className="flex flex-col gap-5">
      {locked && <AdminUnlock onUnlocked={onUnlock} />}

      <Card
        title="Following"
        subtitle="Their games are watched automatically"
        actions={
          !locked && (
            <Button className="text-xs" onClick={() => onNavigate("settings")}>
              Manage teams
            </Button>
          )
        }
      >
        {sync.favorites.length === 0 ? (
          <p className="text-sm text-slate-400">
            {locked
              ? "No teams followed yet. Unlock the control room above to pick your teams."
              : "No teams followed yet. Open Settings → My Teams to follow your teams."}
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {sync.favorites.map((f) => (
              <span
                key={`${f.league}-${f.abbr}`}
                className="inline-flex items-center gap-2 rounded-lg border border-accent/40 bg-accent/15 px-3 py-1.5 text-sm font-bold text-white"
              >
                <span className="text-amber-400">★</span>
                {f.abbr}
                <span className="rounded bg-black/30 px-1 py-0.5 font-mono text-[10px] font-semibold uppercase text-slate-300">{f.league}</span>
              </span>
            ))}
          </div>
        )}
      </Card>

      <Next24h schedule={schedule} settings={settings} sync={sync} />

      <Card
        title="Open a display"
        subtitle="Launch a full-screen view on any TV or tablet"
        actions={
          !locked && (
            <Button variant="ghost" className="text-xs" onClick={() => onNavigate("displays")}>
              All display options →
            </Button>
          )
        }
      >
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {QUICK_SCREENS.map((s) => (
            <DisplayCard key={`${s.id}-${s.basePath}`} screen={s} base={base} />
          ))}
        </div>
      </Card>

      {!locked && (
        <Card title="Control room" subtitle="Everything else lives in the tabs above">
          <div className="flex flex-wrap gap-2">
            <Button className="text-xs" onClick={() => onNavigate("games")}>Schedule & delay</Button>
            <Button className="text-xs" onClick={() => onNavigate("celebrations")}>Celebrations</Button>
            <Button className="text-xs" onClick={() => onNavigate("settings")}>Settings & diagnostics</Button>
          </div>
        </Card>
      )}
    </div>
  );
}
