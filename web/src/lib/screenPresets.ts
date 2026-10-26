export type PaneViewName = "scoreboard" | "ticker" | "plate" | "player" | "grid" | "matchup" | "vs";

export type LayoutDirection = "row" | "col" | "grid";

export interface PaneConfig {
  /** View identifier ("scoreboard", "ticker", "plate", "player", "grid") or relative URL path */
  view?: PaneViewName | string | undefined;
  /** Relative split ratio (e.g. 50, 70, 30) */
  ratio?: number | undefined;
  /** Explicit query parameters for this pane */
  params?: Record<string, string> | undefined;
  /** Accessible title */
  title?: string | undefined;
  /** Nested sub-panes for composite layouts (like triple) */
  direction?: LayoutDirection | undefined;
  panes?: PaneConfig[] | undefined;
}

export interface ScreenPreset {
  name: string;
  label: string;
  desc: string;
  direction: LayoutDirection;
  panes: PaneConfig[];
  columns?: number | undefined;
}

export interface ResolvedPane {
  id: string;
  url: string;
  view: string;
  ratio: number;
  title: string;
  direction?: LayoutDirection | undefined;
  panes?: ResolvedPane[] | undefined;
}

export interface ResolvedScreenLayout {
  presetName: string;
  label: string;
  direction: LayoutDirection;
  panes: ResolvedPane[];
  columns: number;
  gap: number;
}

/** Standard named multi-pane presets for hockey kiosk displays */
export const SCREEN_PRESETS: Record<string, ScreenPreset> = {
  dual: {
    name: "dual",
    label: "Dual Display",
    desc: "50/50 split of live Scoreboard and Ticker",
    direction: "row",
    panes: [
      { view: "scoreboard", ratio: 50, title: "Main Scoreboard" },
      { view: "ticker", ratio: 50, title: "Live Ticker" },
    ],
  },
  "dual-vs": {
    name: "dual-vs",
    label: "Dual Matchup VS",
    desc: "Stadium duel with Away team on the left screen and Home team on the right",
    direction: "row",
    panes: [
      { view: "matchup", params: { side: "away" }, ratio: 50, title: "Away Team" },
      { view: "matchup", params: { side: "home" }, ratio: 50, title: "Home Team" },
    ],
  },
  "grid-ticker": {
    name: "grid-ticker",
    label: "Grid & Ticker Banner",
    desc: "Multi-game grid on top with live Ticker banner on bottom",
    direction: "col",
    panes: [
      { view: "grid", ratio: 85, title: "Multi-Game Grid" },
      { view: "ticker", ratio: 15, title: "Ticker Banner" },
    ],
  },
  "mancave-main": {
    name: "mancave-main",
    label: "Mancave Main Display",
    desc: "Primary live scoreboard (70%) with companion player tracker (30%)",
    direction: "row",
    panes: [
      { view: "scoreboard", ratio: 70, title: "Primary Scoreboard" },
      { view: "player", ratio: 30, title: "Companion Player Tracker" },
    ],
  },
  quad: {
    name: "quad",
    label: "Quad Companion 2x2",
    desc: "Four-way split companion display (Scoreboard, Player, Plate, Ticker)",
    direction: "grid",
    columns: 2,
    panes: [
      { view: "scoreboard", ratio: 1, title: "Scoreboard" },
      { view: "player", ratio: 1, title: "Player Tracker" },
      { view: "plate", ratio: 1, title: "Scoreboard Plate" },
      { view: "ticker", ratio: 1, title: "Ticker" },
    ],
  },
  triple: {
    name: "triple",
    label: "Triple Companion",
    desc: "Primary scoreboard with stacked companion player and ticker",
    direction: "row",
    panes: [
      { view: "scoreboard", ratio: 65, title: "Primary Scoreboard" },
      {
        direction: "col",
        ratio: 35,
        title: "Side Companion Stack",
        panes: [
          { view: "player", ratio: 50, title: "Player Tracker" },
          { view: "ticker", ratio: 50, title: "Live Ticker" },
        ],
      },
    ],
  },
  "scoreboard-plate": {
    name: "scoreboard-plate",
    label: "Scoreboard & Plate",
    desc: "60/40 split of main broadcast Scoreboard and compact Scoreboard Plate",
    direction: "row",
    panes: [
      { view: "scoreboard", ratio: 60, title: "Main Scoreboard" },
      { view: "plate", ratio: 40, title: "Scoreboard Plate" },
    ],
  },
  "scoreboard-ticker": {
    name: "scoreboard-ticker",
    label: "Scoreboard & Ticker Bar",
    desc: "Broadcast scoreboard on top with live scrolling ticker on bottom",
    direction: "col",
    panes: [
      { view: "scoreboard", ratio: 85, title: "Broadcast Scoreboard" },
      { view: "ticker", ratio: 15, title: "Live Ticker Strip" },
    ],
  },
  "plate-ticker": {
    name: "plate-ticker",
    label: "Plate & Ticker Bar",
    desc: "Compact plate view on top with live scrolling ticker on bottom",
    direction: "col",
    panes: [
      { view: "plate", ratio: 85, title: "Scoreboard Plate" },
      { view: "ticker", ratio: 15, title: "Live Ticker Strip" },
    ],
  },
};

/** Keys used to control screen layouts that should not be forwarded to child views */
const SCREEN_CONTROL_KEYS = new Set([
  "split",
  "ratios",
  "panes",
  "p1",
  "p2",
  "p3",
  "p4",
  "pane1",
  "pane2",
  "pane3",
  "pane4",
  "dir",
  "direction",
  "layout",
  "cols",
  "columns",
  "gap",
  "border",
  "hud",
]);

/** Parse split ratios from string like "70,30", "60/40", "50:50", "80 20" */
export function parseSplitRatios(splitStr?: string | null | undefined, expectedCount?: number): number[] {
  if (!splitStr) return [];
  const parts = splitStr
    .split(/[,/: -]+/)
    .map((s) => parseFloat(s.trim()))
    .filter((n) => Number.isFinite(n) && n > 0);

  if (parts.length === 0) return [];
  if (expectedCount && parts.length < expectedCount) {
    const last = parts[parts.length - 1] ?? 1;
    while (parts.length < expectedCount) {
      parts.push(last);
    }
  }
  return parts;
}

/** Normalize view identifier to a relative path e.g. "scoreboard" -> "/scoreboard" */
export function normalizeViewPath(view: string): string {
  const trimmed = view.trim();
  if (trimmed.startsWith("/") || trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    return trimmed;
  }
  return `/${trimmed}`;
}

/** Construct child URL by merging global URL params and per-pane overrides */
export function buildChildUrl(
  baseView: string,
  searchParams: URLSearchParams,
  paneIndex: number,
  paneParams?: Record<string, string> | undefined,
): string {
  const fullPath = normalizeViewPath(baseView);
  const [pathname = fullPath, existingQuery = ""] = fullPath.split("?");
  const outParams = new URLSearchParams(existingQuery);

  // 1. Forward all non-control global params (e.g. mock=1, game=nhl:m1, league=nhl)
  for (const [key, value] of searchParams.entries()) {
    if (SCREEN_CONTROL_KEYS.has(key.toLowerCase())) continue;

    // Check for pane-specific overrides: e.g. p1_game=... or pane1_game=...
    const p1Prefix = `p${paneIndex + 1}_`;
    const pane1Prefix = `pane${paneIndex + 1}_`;

    if (key.startsWith("p") && key.includes("_")) {
      if (key.startsWith(p1Prefix)) {
        outParams.set(key.slice(p1Prefix.length), value);
      } else if (key.startsWith(pane1Prefix)) {
        outParams.set(key.slice(pane1Prefix.length), value);
      }
      // Skip p2_... when resolving pane 1
      continue;
    }

    // Default global param
    if (!outParams.has(key)) {
      outParams.set(key, value);
    }
  }

  // 2. Apply explicit pane params
  if (paneParams) {
    for (const [k, v] of Object.entries(paneParams)) {
      outParams.set(k, v);
    }
  }

  const qs = outParams.toString();
  return qs ? `${pathname}?${qs}` : pathname;
}

/** Resolve the complete layout config for a given preset name and URL query parameters */
export function resolveScreenLayout(
  name?: string | null | undefined,
  searchParams?: URLSearchParams | undefined,
  isPortrait = false,
): ResolvedScreenLayout {
  const params = searchParams ?? new URLSearchParams();
  const presetKey = (name || "").toLowerCase().trim();
  const basePreset = SCREEN_PRESETS[presetKey] ?? SCREEN_PRESETS["mancave-main"]!;

  // 1. Resolve Direction
  let direction: LayoutDirection = basePreset.direction;
  const dirParam = params.get("dir") || params.get("direction") || params.get("layout");
  if (dirParam) {
    const d = dirParam.toLowerCase().trim();
    if (d === "row" || d === "horizontal" || d === "h") direction = "row";
    else if (d === "col" || d === "column" || d === "vertical" || d === "v") direction = "col";
    else if (d === "grid") direction = "grid";
  } else if (isPortrait && direction === "row") {
    // In portrait orientation without explicit override, row splits naturally stack as columns
    direction = "col";
  }

  // 2. Resolve Panes
  let paneConfigs: PaneConfig[] = [];
  const panesParam = params.get("panes");

  if (panesParam) {
    const list = panesParam
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    paneConfigs = list.map((v, i) => ({
      view: v,
      title: `Pane ${i + 1}`,
    }));
  } else {
    // Clone preset panes
    paneConfigs = basePreset.panes.map((p) => ({ ...p }));
  }

  // Check individual pane overrides (?p1=..., ?p2=..., ?pane1=...)
  paneConfigs = paneConfigs.map((p, i) => {
    const override = params.get(`p${i + 1}`) || params.get(`pane${i + 1}`);
    return override ? { ...p, view: override } : p;
  });

  // 3. Resolve Split Ratios
  const splitParam = params.get("split") || params.get("ratios");
  const parsedRatios = parseSplitRatios(splitParam, paneConfigs.length);

  // 4. Resolve Columns
  let columns = basePreset.columns ?? (direction === "grid" ? 2 : 1);
  const colsParam = params.get("cols") || params.get("columns");
  if (colsParam) {
    const c = parseInt(colsParam, 10);
    if (Number.isFinite(c) && c > 0) columns = c;
  }

  // 5. Resolve Gap
  let gap = 0;
  const gapParam = params.get("gap");
  if (gapParam) {
    const g = parseFloat(gapParam);
    if (Number.isFinite(g) && g >= 0) gap = g;
  }

  // 6. Build Resolved Panes
  let globalPaneCounter = 0;
  const buildResolvedPane = (p: PaneConfig, idx: number, parentRatio?: number): ResolvedPane => {
    const currentPaneIdx = globalPaneCounter++;
    const ratio = parsedRatios[idx] ?? p.ratio ?? parentRatio ?? 1;
    const view = p.view ?? "scoreboard";

    if (p.panes && p.panes.length > 0) {
      // Nested container pane
      const nestedRatios = parseSplitRatios(splitParam, p.panes.length);
      const subPanes = p.panes.map((sub, sIdx) =>
        buildResolvedPane({ ...sub, ratio: nestedRatios[sIdx] ?? sub.ratio ?? 1 }, sIdx),
      );
      return {
        id: `pane-nested-${idx}`,
        url: "",
        view: "container",
        ratio,
        title: p.title ?? `Pane ${idx + 1}`,
        direction: p.direction ?? "col",
        panes: subPanes,
      };
    }

    return {
      id: `pane-${currentPaneIdx}-${view}`,
      url: buildChildUrl(view, params, currentPaneIdx, p.params),
      view,
      ratio,
      title: p.title ?? `Pane ${idx + 1}: ${view}`,
    };
  };

  const resolvedPanes = paneConfigs.map((p, i) => buildResolvedPane(p, i));

  return {
    presetName: basePreset.name,
    label: basePreset.label,
    direction,
    panes: resolvedPanes,
    columns,
    gap,
  };
}
