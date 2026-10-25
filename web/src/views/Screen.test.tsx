import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import Screen from "./Screen";
import Player from "./Player";

describe("Screen View Component", () => {
  it("defaults to mancave-main when loaded without a preset name", () => {
    const html = renderToString(
      <MemoryRouter initialEntries={["/screen?mock=1"]}>
        <Routes>
          <Route path="/screen" element={<Screen />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(html).toContain("data-pane-view=\"scoreboard\"");
    expect(html).toContain("data-pane-view=\"player\"");
    expect(html).toContain("data-pane-ratio=\"70\"");
    expect(html).toContain("data-pane-ratio=\"30\"");
  });

  it("renders dual preset with Scoreboard and Ticker iframes", () => {
    const html = renderToString(
      <MemoryRouter initialEntries={["/screen/dual?mock=1"]}>
        <Routes>
          <Route path="/screen/:name" element={<Screen />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(html).toContain("data-pane-view=\"scoreboard\"");
    expect(html).toContain("data-pane-view=\"ticker\"");
    expect(html).toContain("src=\"/scoreboard?mock=1\"");
    expect(html).toContain("src=\"/ticker?mock=1\"");
    expect(html).toContain("flex-row");
  });

  it("renders grid-ticker preset with vertical split", () => {
    const html = renderToString(
      <MemoryRouter initialEntries={["/screen/grid-ticker?mock=1"]}>
        <Routes>
          <Route path="/screen/:name" element={<Screen />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(html).toContain("data-pane-view=\"grid\"");
    expect(html).toContain("data-pane-view=\"ticker\"");
    expect(html).toContain("src=\"/grid?mock=1\"");
    expect(html).toContain("src=\"/ticker?mock=1\"");
    expect(html).toContain("flex-col");
    expect(html).toContain("data-pane-ratio=\"85\"");
    expect(html).toContain("data-pane-ratio=\"15\"");
  });

  it("renders mancave-main preset with 70/30 scoreboard and player tracker", () => {
    const html = renderToString(
      <MemoryRouter initialEntries={["/screen/mancave-main?mock=1&game=nhl:m1"]}>
        <Routes>
          <Route path="/screen/:name" element={<Screen />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(html).toContain("data-pane-view=\"scoreboard\"");
    expect(html).toContain("data-pane-view=\"player\"");
    expect(html).toContain("src=\"/scoreboard?mock=1&amp;game=nhl%3Am1\"");
    expect(html).toContain("src=\"/player?mock=1&amp;game=nhl%3Am1\"");
    expect(html).toContain("data-pane-ratio=\"70\"");
    expect(html).toContain("data-pane-ratio=\"30\"");
  });

  it("renders quad preset with 4 panes in a grid", () => {
    const html = renderToString(
      <MemoryRouter initialEntries={["/screen/quad?mock=1"]}>
        <Routes>
          <Route path="/screen/:name" element={<Screen />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(html).toContain("data-pane-view=\"scoreboard\"");
    expect(html).toContain("data-pane-view=\"player\"");
    expect(html).toContain("data-pane-view=\"plate\"");
    expect(html).toContain("data-pane-view=\"ticker\"");
    expect(html).toContain("grid-template-columns:repeat(2, minmax(0, 1fr))");
  });

  it("renders triple composite preset with nested panes", () => {
    const html = renderToString(
      <MemoryRouter initialEntries={["/screen/triple?mock=1"]}>
        <Routes>
          <Route path="/screen/:name" element={<Screen />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(html).toContain("data-pane-view=\"scoreboard\"");
    expect(html).toContain("data-pane-view=\"player\"");
    expect(html).toContain("data-pane-view=\"ticker\"");
  });

  it("renders scoreboard-plate and plate-ticker presets", () => {
    const htmlSbPlate = renderToString(
      <MemoryRouter initialEntries={["/screen/scoreboard-plate?mock=1"]}>
        <Routes>
          <Route path="/screen/:name" element={<Screen />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(htmlSbPlate).toContain("data-pane-view=\"scoreboard\"");
    expect(htmlSbPlate).toContain("data-pane-view=\"plate\"");

    const htmlPlTicker = renderToString(
      <MemoryRouter initialEntries={["/screen/plate-ticker?mock=1"]}>
        <Routes>
          <Route path="/screen/:name" element={<Screen />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(htmlPlTicker).toContain("data-pane-view=\"plate\"");
    expect(htmlPlTicker).toContain("data-pane-view=\"ticker\"");
    expect(htmlPlTicker).toContain("flex-col");
  });

  it("supports URL-addressable pane and split ratio overrides", () => {
    const html = renderToString(
      <MemoryRouter initialEntries={["/screen/custom?panes=plate,ticker&split=60,40&dir=col&mock=1"]}>
        <Routes>
          <Route path="/screen/:name" element={<Screen />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(html).toContain("data-pane-view=\"plate\"");
    expect(html).toContain("data-pane-view=\"ticker\"");
    expect(html).toContain("data-pane-ratio=\"60\"");
    expect(html).toContain("data-pane-ratio=\"40\"");
    expect(html).toContain("flex-col");
    expect(html).toContain("src=\"/plate?mock=1\"");
    expect(html).toContain("src=\"/ticker?mock=1\"");
  });

  it("applies per-pane game overrides (p1_game, p2_game)", () => {
    const html = renderToString(
      <MemoryRouter initialEntries={["/screen/dual?mock=1&p1_game=nhl:m1&p2_game=nhl:m2"]}>
        <Routes>
          <Route path="/screen/:name" element={<Screen />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(html).toContain("src=\"/scoreboard?mock=1&amp;game=nhl%3Am1\"");
    expect(html).toContain("src=\"/ticker?mock=1&amp;game=nhl%3Am2\"");
  });

  it("renders preset HUD overlay when ?hud=1 is passed", () => {
    const html = renderToString(
      <MemoryRouter initialEntries={["/screen/dual?hud=1"]}>
        <Routes>
          <Route path="/screen/:name" element={<Screen />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(html).toContain("Screen Preset Selector");
    expect(html).toContain("Multi-Pane Screen Presets");
    expect(html).toContain("Dual Display");
  });
});

describe("Player View Component", () => {
  it("renders idle state gracefully when no game is active", () => {
    const html = renderToString(
      <MemoryRouter initialEntries={["/player"]}>
        <Routes>
          <Route path="/player" element={<Player />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(html).toContain("kiosk");
  });
});
