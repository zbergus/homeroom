import { useMemo, useState } from "react";
import { useLocation, useParams } from "react-router-dom";
import { useKiosk, useOrientation } from "../lib/hooks";
import {
  type LayoutDirection,
  type ResolvedPane,
  resolveScreenLayout,
  SCREEN_PRESETS,
} from "../lib/screenPresets";

interface PaneViewProps {
  pane: ResolvedPane;
  parentDir: LayoutDirection;
}

function RenderPane({ pane, parentDir }: PaneViewProps) {
  if (pane.panes && pane.panes.length > 0) {
    const dir = pane.direction ?? "col";
    const flexClass = dir === "row" ? "flex-row" : "flex-col";
    return (
      <div
        className={`flex ${flexClass} min-h-0 min-w-0 overflow-hidden`}
        style={{
          flex: `${pane.ratio} 1 0%`,
        }}
      >
        {pane.panes.map((sub) => (
          <RenderPane key={sub.id} pane={sub} parentDir={dir} />
        ))}
      </div>
    );
  }

  // Calculate style based on parent layout direction
  const style: React.CSSProperties = {
    flex: `${pane.ratio} 1 0%`,
    minWidth: 0,
    minHeight: 0,
    ...(parentDir === "row" ? { width: 0, height: "100%" } : {}),
    ...(parentDir === "col" ? { height: 0, width: "100%" } : {}),
  };

  return (
    <div
      className="relative min-h-0 min-w-0 overflow-hidden bg-ink-950"
      style={style}
      data-pane-id={pane.id}
      data-pane-view={pane.view}
      data-pane-ratio={pane.ratio}
    >
      <iframe
        src={pane.url}
        title={pane.title}
        className="block h-full w-full border-0"
        allow="autoplay; fullscreen"
        loading="eager"
      />
    </div>
  );
}

export default function Screen() {
  useKiosk();
  const { name } = useParams<{ name?: string }>();
  const location = useLocation();
  const orientation = useOrientation();
  const [hudOpen, setHudOpen] = useState(false);

  const searchParams = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const isPortrait = orientation === "portrait";

  const layout = useMemo(
    () => resolveScreenLayout(name, searchParams, isPortrait),
    [name, searchParams, isPortrait],
  );

  const showHud = hudOpen || searchParams.get("hud") === "1";

  // Base container class based on direction
  let layoutContainerClass = "flex h-full w-full min-h-0 min-w-0";
  let containerStyle: React.CSSProperties = {};

  if (layout.direction === "row") {
    layoutContainerClass = "flex flex-row h-full w-full min-h-0 min-w-0 divide-x divide-white/10";
  } else if (layout.direction === "col") {
    layoutContainerClass = "flex flex-col h-full w-full min-h-0 min-w-0 divide-y divide-white/10";
  } else if (layout.direction === "grid") {
    layoutContainerClass = "grid h-full w-full min-h-0 min-w-0 gap-1 bg-ink-900";
    containerStyle = {
      gridTemplateColumns: `repeat(${layout.columns}, minmax(0, 1fr))`,
    };
  }

  if (layout.gap > 0) {
    containerStyle.gap = `${layout.gap}px`;
  }

  return (
    <div className="kiosk fixed inset-0 overflow-hidden bg-black select-none">
      <main className={layoutContainerClass} style={containerStyle}>
        {layout.panes.map((pane) => (
          <RenderPane key={pane.id} pane={pane} parentDir={layout.direction} />
        ))}
      </main>

      {/* Preset HUD Toggle Button (discrete in corner) */}
      <button
        type="button"
        onClick={() => setHudOpen((o) => !o)}
        className="pointer-events-auto absolute bottom-2 right-2 z-50 rounded bg-black/60 px-2 py-1 text-[10px] font-mono uppercase text-slate-400 opacity-20 hover:opacity-100 transition-opacity"
        aria-label="Toggle Screen Preset HUD"
      >
        {layout.presetName}
      </button>

      {/* Preset Switcher HUD Modal */}
      {showHud && (
        <aside
          role="dialog"
          aria-label="Screen Preset Selector"
          className="pointer-events-auto absolute inset-0 z-50 flex items-center justify-center bg-black/80 p-6 backdrop-blur-md"
        >
          <div className="flex max-w-2xl flex-col gap-4 rounded-2xl border border-white/15 bg-ink-900 p-6 text-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-white/10 pb-3">
              <div>
                <h2 className="text-xl font-black uppercase tracking-wide">Multi-Pane Screen Presets</h2>
                <p className="text-sm text-slate-400">Current layout: <span className="text-amber-400 font-bold">{layout.label}</span></p>
              </div>
              <button
                type="button"
                onClick={() => setHudOpen(false)}
                className="rounded-lg bg-white/10 px-3 py-1.5 text-xs font-semibold hover:bg-white/20"
              >
                Close (ESC)
              </button>
            </div>

            <div className="grid gap-2 sm:grid-cols-2">
              {Object.values(SCREEN_PRESETS).map((p) => {
                const isActive = p.name === layout.presetName;
                const qs = location.search;
                const href = `/screen/${p.name}${qs}`;
                return (
                  <a
                    key={p.name}
                    href={href}
                    className={`flex flex-col gap-1 rounded-xl p-3 transition-colors ${
                      isActive
                        ? "bg-amber-400/20 border border-amber-400/60 text-amber-200"
                        : "bg-ink-950/70 border border-white/10 hover:bg-ink-950"
                    }`}
                  >
                    <span className="font-bold text-sm text-white">{p.label}</span>
                    <span className="text-xs text-slate-400">{p.desc}</span>
                  </a>
                );
              })}
            </div>

            <div className="mt-2 rounded-lg bg-black/40 p-3 text-xs text-slate-400">
              <span className="font-semibold text-slate-300">URL Addressable:</span> Load{" "}
              <code className="text-amber-300">/screen/dual?split=60,40</code> or customize panes with{" "}
              <code className="text-amber-300">?panes=scoreboard,player&mock=1</code>.
            </div>
          </div>
        </aside>
      )}
    </div>
  );
}
