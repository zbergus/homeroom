import { describe, expect, it } from "vitest";
import {
  buildChildUrl,
  normalizeViewPath,
  parseSplitRatios,
  resolveScreenLayout,
} from "./screenPresets";

describe("screenPresets", () => {
  describe("parseSplitRatios", () => {
    it("parses comma, slash, colon, and hyphen separated ratios", () => {
      expect(parseSplitRatios("70,30")).toEqual([70, 30]);
      expect(parseSplitRatios("60/40")).toEqual([60, 40]);
      expect(parseSplitRatios("50:50")).toEqual([50, 50]);
      expect(parseSplitRatios("25 25 25 25")).toEqual([25, 25, 25, 25]);
      expect(parseSplitRatios("85-15")).toEqual([85, 15]);
    });

    it("handles null, empty or invalid strings gracefully", () => {
      expect(parseSplitRatios(null)).toEqual([]);
      expect(parseSplitRatios("")).toEqual([]);
      expect(parseSplitRatios("invalid")).toEqual([]);
      expect(parseSplitRatios("abc,def")).toEqual([]);
    });

    it("fills expected count when fewer ratios are given", () => {
      expect(parseSplitRatios("70", 2)).toEqual([70, 70]);
      expect(parseSplitRatios("60,20", 3)).toEqual([60, 20, 20]);
    });
  });

  describe("normalizeViewPath", () => {
    it("prepends slash to bare view names", () => {
      expect(normalizeViewPath("scoreboard")).toBe("/scoreboard");
      expect(normalizeViewPath("ticker")).toBe("/ticker");
      expect(normalizeViewPath("plate")).toBe("/plate");
      expect(normalizeViewPath("player")).toBe("/player");
      expect(normalizeViewPath("grid")).toBe("/grid");
    });

    it("preserves already rooted paths or URLs", () => {
      expect(normalizeViewPath("/scoreboard?game=nhl:m1")).toBe("/scoreboard?game=nhl:m1");
      expect(normalizeViewPath("http://example.com/view")).toBe("http://example.com/view");
    });
  });

  describe("buildChildUrl", () => {
    it("forwards global query parameters like mock and game", () => {
      const params = new URLSearchParams("mock=1&game=nhl:m1&league=nhl");
      const url = buildChildUrl("scoreboard", params, 0);
      expect(url).toContain("/scoreboard?");
      expect(url).toContain("mock=1");
      expect(url).toContain("game=nhl%3Am1");
      expect(url).toContain("league=nhl");
    });

    it("strips screen layout control keys from child views", () => {
      const params = new URLSearchParams("mock=1&split=70,30&panes=scoreboard,ticker&dir=col&gap=2");
      const url = buildChildUrl("scoreboard", params, 0);
      expect(url).toBe("/scoreboard?mock=1");
      expect(url).not.toContain("split=");
      expect(url).not.toContain("panes=");
      expect(url).not.toContain("dir=");
      expect(url).not.toContain("gap=");
    });

    it("applies pane-specific overrides (p1_game, p2_game)", () => {
      const params = new URLSearchParams("mock=1&game=nhl:global&p1_game=nhl:p1&p2_game=nhl:p2");
      const p1Url = buildChildUrl("scoreboard", params, 0);
      const p2Url = buildChildUrl("ticker", params, 1);

      expect(p1Url).toContain("game=nhl%3Ap1");
      expect(p1Url).not.toContain("nhl%3Ap2");
      expect(p2Url).toContain("game=nhl%3Ap2");
      expect(p2Url).not.toContain("nhl%3Ap1");
    });

    it("merges explicit pane params", () => {
      const params = new URLSearchParams("mock=1");
      const url = buildChildUrl("scoreboard", params, 0, { screen: "stats" });
      expect(url).toContain("screen=stats");
      expect(url).toContain("mock=1");
    });
  });

  describe("resolveScreenLayout", () => {
    it("resolves dual preset with 50/50 split", () => {
      const layout = resolveScreenLayout("dual");
      expect(layout.presetName).toBe("dual");
      expect(layout.direction).toBe("row");
      expect(layout.panes).toHaveLength(2);
      expect(layout.panes[0]?.view).toBe("scoreboard");
      expect(layout.panes[0]?.ratio).toBe(50);
      expect(layout.panes[1]?.view).toBe("ticker");
      expect(layout.panes[1]?.ratio).toBe(50);
    });

    it("resolves grid-ticker preset with 85/15 vertical split", () => {
      const layout = resolveScreenLayout("grid-ticker");
      expect(layout.presetName).toBe("grid-ticker");
      expect(layout.direction).toBe("col");
      expect(layout.panes).toHaveLength(2);
      expect(layout.panes[0]?.view).toBe("grid");
      expect(layout.panes[0]?.ratio).toBe(85);
      expect(layout.panes[1]?.view).toBe("ticker");
      expect(layout.panes[1]?.ratio).toBe(15);
    });

    it("resolves mancave-main preset with 70/30 split", () => {
      const layout = resolveScreenLayout("mancave-main");
      expect(layout.presetName).toBe("mancave-main");
      expect(layout.direction).toBe("row");
      expect(layout.panes).toHaveLength(2);
      expect(layout.panes[0]?.view).toBe("scoreboard");
      expect(layout.panes[0]?.ratio).toBe(70);
      expect(layout.panes[1]?.view).toBe("player");
      expect(layout.panes[1]?.ratio).toBe(30);
    });

    it("resolves quad preset as a 2x2 grid", () => {
      const layout = resolveScreenLayout("quad");
      expect(layout.presetName).toBe("quad");
      expect(layout.direction).toBe("grid");
      expect(layout.columns).toBe(2);
      expect(layout.panes).toHaveLength(4);
    });

    it("resolves triple composite preset with nested panes", () => {
      const layout = resolveScreenLayout("triple");
      expect(layout.presetName).toBe("triple");
      expect(layout.panes).toHaveLength(2);
      expect(layout.panes[0]?.view).toBe("scoreboard");
      expect(layout.panes[1]?.view).toBe("container");
      expect(layout.panes[1]?.panes).toHaveLength(2);
    });

    it("overrides split ratios from ?split= query parameter", () => {
      const params = new URLSearchParams("split=80,20");
      const layout = resolveScreenLayout("dual", params);
      expect(layout.panes[0]?.ratio).toBe(80);
      expect(layout.panes[1]?.ratio).toBe(20);
    });

    it("overrides child views with ?panes= parameter", () => {
      const params = new URLSearchParams("panes=plate,ticker,player&split=40,30,30");
      const layout = resolveScreenLayout("dual", params);
      expect(layout.panes).toHaveLength(3);
      expect(layout.panes[0]?.view).toBe("plate");
      expect(layout.panes[1]?.view).toBe("ticker");
      expect(layout.panes[2]?.view).toBe("player");
      expect(layout.panes[0]?.ratio).toBe(40);
      expect(layout.panes[1]?.ratio).toBe(30);
      expect(layout.panes[2]?.ratio).toBe(30);
    });

    it("overrides individual panes with ?p1= and ?p2=", () => {
      const params = new URLSearchParams("p2=plate");
      const layout = resolveScreenLayout("dual", params);
      expect(layout.panes[0]?.view).toBe("scoreboard");
      expect(layout.panes[1]?.view).toBe("plate");
    });

    it("auto-flips row presets to column in portrait orientation if not overridden", () => {
      const landscape = resolveScreenLayout("mancave-main", undefined, false);
      expect(landscape.direction).toBe("row");

      const portrait = resolveScreenLayout("mancave-main", undefined, true);
      expect(portrait.direction).toBe("col");

      // But explicit dir=row takes precedence
      const forced = resolveScreenLayout("mancave-main", new URLSearchParams("dir=row"), true);
      expect(forced.direction).toBe("row");
    });

    it("falls back gracefully for unknown preset name", () => {
      const layout = resolveScreenLayout("nonexistent");
      expect(layout.presetName).toBe("mancave-main");
      expect(layout.panes).toHaveLength(2);
    });
  });
});
