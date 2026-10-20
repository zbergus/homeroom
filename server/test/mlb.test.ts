import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { Engine } from "../src/engine/engine.js";
import { Poller } from "../src/engine/poller.js";
import { naturalText, scoringLabel } from "../src/engine/text.js";
import { matchesAny, triggersFor } from "../src/engine/triggers.js";
import { matchMlb, normalizeMlb, parseMlbLive, type MlbGame } from "../src/providers/mlb.js";
import { Store } from "../src/store.js";
import type { EventPayload, Game, Team } from "../src/types.js";

const fx = (name: string) => JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", name), "utf8"));

const dummyColors = {
  primary_color_rgb: { r: 12, g: 35, b: 64 },
  secondary_color_rgb: { r: 142, g: 199, b: 243 },
  alternate_color_rgb: { r: 255, g: 255, b: 255 },
};

const makeTeam = (id: string, abbr: string, name: string, displayName: string, score: number): Team => ({
  id,
  abbr,
  name,
  display_name: displayName,
  logo: "",
  score,
  options: dummyColors,
});

describe("MLB Stats API Provider & Home Run vs Run Triggers", () => {
  const schedRaw = fx("mlb-schedule-20261019.json");
  const liveRaw = fx("mlb-feed-849815.json");

  it("normalizes real MLB schedule payload with linescore and scoring plays", () => {
    const games: MlbGame[] = (schedRaw.dates?.[0]?.games ?? []).map(normalizeMlb);
    expect(games.length).toBe(1);
    const g = games[0]!;

    expect(g.id).toBe(849815);
    expect(g.homeAbbr).toBe("TB");
    expect(g.awayAbbr).toBe("CLE");
    expect(g.homeNick).toBe("rays");
    expect(g.awayNick).toBe("guardians");
    expect(g.homeName).toBe("Tampa Bay Rays");
    expect(g.awayName).toBe("Cleveland Guardians");
    expect(g.homeScore).toBe(7);
    expect(g.awayScore).toBe(3);
    expect(g.state).toBe("post");
    expect(g.inning).toBe(9);
    expect(g.situation).toBeDefined();
    expect(g.situation?.outs).toBe(3);

    expect(g.goals.length).toBe(7);

    // Play 0: 2-run Double by Richie Palacios (Non-home run)
    const p0 = g.goals[0]!;
    expect(p0.scorer).toBe("Richie Palacios");
    expect(p0.team_abbr).toBe("TB");
    expect(p0.period).toBe(2);
    expect(p0.period_label).toBe("Bot 2nd");
    expect(p0.home_score).toBe(2);
    expect(p0.away_score).toBe(0);
    expect(p0.strength).toBeUndefined();
    expect(p0.text).toContain("doubles");

    // Play 3: 2-run Home Run by Junior Caminero
    const p3 = g.goals[3]!;
    expect(p3.scorer).toBe("Junior Caminero");
    expect(p3.team_abbr).toBe("TB");
    expect(p3.period).toBe(7);
    expect(p3.period_label).toBe("Bot 7th");
    expect(p3.home_score).toBe(5);
    expect(p3.away_score).toBe(1);
    expect(p3.strength).toBe("HR");
    expect(p3.text).toContain("homers");

    // Play 6: 2-run Home Run by Yandy Díaz
    const p6 = g.goals[6]!;
    expect(p6.scorer).toBe("Yandy Díaz");
    expect(p6.strength).toBe("HR");
    expect(p6.home_score).toBe(7);
    expect(p6.away_score).toBe(3);
  });

  it("parses detailed live feed payload identically to schedule scoring plays", () => {
    const liveGame = parseMlbLive(liveRaw);
    expect(liveGame.id).toBe(849815);
    expect(liveGame.homeAbbr).toBe("TB");
    expect(liveGame.awayAbbr).toBe("CLE");
    expect(liveGame.homeScore).toBe(7);
    expect(liveGame.awayScore).toBe(3);
    expect(liveGame.goals.length).toBe(7);

    const hr = liveGame.goals.find((p) => p.scorer === "Junior Caminero");
    expect(hr).toBeDefined();
    expect(hr?.strength).toBe("HR");
    expect(hr?.period_label).toBe("Bot 7th");
  });

  it("matches ESPN MLB game to MLB counterpart via matchMlb", () => {
    const schedGames: MlbGame[] = (schedRaw.dates?.[0]?.games ?? []).map(normalizeMlb);
    const espnGame: Game = {
      id: "mlb:401930516",
      league: "mlb",
      sport: "baseball",
      status: "in",
      start_time: schedGames[0]!.start_utc,
      period: 7,
      period_label: "7th",
      clock: "",
      intermission: false,
      home: makeTeam("tb", "TB", "Rays", "Tampa Bay Rays", 5),
      away: makeTeam("cle", "CLE", "Guardians", "Cleveland Guardians", 1),
      linescores: { home: [], away: [] },
      stats: { home: {}, away: {} },
      goals: [],
    };

    const matched = matchMlb(espnGame, schedGames);
    expect(matched).toBeDefined();
    expect(matched?.id).toBe(849815);

    // Mismatched time (more than 3 hours)
    const espnOldTime = { ...espnGame, start_time: "2026-10-18T00:00:00Z" };
    expect(matchMlb(espnOldTime, schedGames)).toBeUndefined();

    // Mismatched team
    const espnWrongTeam = { ...espnGame, home: makeTeam("nyy", "NYY", "Yankees", "New York Yankees", 0) };
    expect(matchMlb(espnWrongTeam, schedGames)).toBeUndefined();
  });

  it("distinguishes HOME RUN vs RUN in scoringLabel, naturalText, and triggers", () => {
    const schedGames: MlbGame[] = (schedRaw.dates?.[0]?.games ?? []).map(normalizeMlb);
    const hrPlay = schedGames[0]!.goals[3]!;
    const doublePlay = schedGames[0]!.goals[0]!;

    // 1. Scoring label detection
    const hrLabel = scoringLabel("baseball", 2, hrPlay.text, hrPlay.strength);
    const runLabel = scoringLabel("baseball", 2, doublePlay.text, doublePlay.strength);
    expect(hrLabel).toBe("HOME RUN");
    expect(runLabel).toBe("RUN");

    const dummyGame: Game = {
      id: "mlb:1",
      league: "mlb",
      sport: "baseball",
      status: "in",
      start_time: new Date().toISOString(),
      period: 7,
      period_label: "7th inning",
      clock: "Bot 7th",
      intermission: false,
      home: makeTeam("tb", "TB", "Rays", "Tampa Bay Rays", 5),
      away: makeTeam("cle", "CLE", "Guardians", "Cleveland Guardians", 1),
      linescores: { home: [], away: [] },
      stats: { home: {}, away: {} },
      goals: [],
    };

    const hrEvent: EventPayload = {
      event_id: "evt_hr",
      type: "goal",
      emitted_at: Date.now() / 1000,
      delay_s: 0,
      league: "mlb",
      sport: "baseball",
      game: dummyGame,
      team: dummyGame.home,
      scoring: {
        label: hrLabel,
        scorer: hrPlay.scorer,
        assists: [],
        strength: hrPlay.strength,
        delta: 2,
        home_score: 5,
        away_score: 1,
      },
      natural_text: naturalText("goal", { game: dummyGame, team: dummyGame.home, label: hrLabel, scorer: hrPlay.scorer }),
    };

    const runEvent: EventPayload = {
      event_id: "evt_run",
      type: "goal",
      emitted_at: Date.now() / 1000,
      delay_s: 0,
      league: "mlb",
      sport: "baseball",
      game: dummyGame,
      team: dummyGame.home,
      scoring: {
        label: runLabel,
        scorer: doublePlay.scorer,
        assists: [],
        strength: doublePlay.strength,
        delta: 2,
        home_score: 2,
        away_score: 0,
      },
      natural_text: naturalText("goal", { game: dummyGame, team: dummyGame.home, label: runLabel, scorer: doublePlay.scorer }),
    };

    // 2. Natural text check
    expect(hrEvent.natural_text).toBe("Home run, Tampa Bay Rays! Junior Caminero with the score. Rays 5, Guardians 1.");
    expect(runEvent.natural_text).toBe("Run, Tampa Bay Rays! Richie Palacios with the score. Rays 5, Guardians 1.");

    // 3. Trigger vocabulary check
    const ctx = { favorites: new Set<string>(["mlb:TB"]) };

    // Home run event satisfies BOTH "home_run" and "run" triggers
    expect(matchesAny(["home_run"], hrEvent, ctx)).toBe(true);
    expect(matchesAny(["run"], hrEvent, ctx)).toBe(true);
    const hrTriggers = triggersFor(hrEvent, ctx);
    expect(hrTriggers).toContain("home_run");
    expect(hrTriggers).toContain("run");
    expect(hrTriggers).toContain("any_score");

    // Regular run event satisfies "run" trigger but NOT "home_run" trigger
    expect(matchesAny(["home_run"], runEvent, ctx)).toBe(false);
    expect(matchesAny(["run"], runEvent, ctx)).toBe(true);
    const runTriggers = triggersFor(runEvent, ctx);
    expect(runTriggers).not.toContain("home_run");
    expect(runTriggers).toContain("run");
    expect(runTriggers).toContain("any_score");
  });

  it("diffGame and Engine build MLB events with full baseball situation and scorer", () => {
    const store = new Store(":memory:");
    const engine = new Engine(store);

    const baseGame: Game = {
      id: "mlb:test",
      league: "mlb",
      sport: "baseball",
      status: "in",
      start_time: new Date().toISOString(),
      period: 7,
      period_label: "7th inning",
      clock: "Bot 7th",
      intermission: false,
      home: makeTeam("tb", "TB", "Rays", "Tampa Bay Rays", 3),
      away: makeTeam("cle", "CLE", "Guardians", "Cleveland Guardians", 1),
      linescores: { home: [], away: [] },
      stats: { home: {}, away: {} },
      goals: [],
    };

    const schedGames: MlbGame[] = (schedRaw.dates?.[0]?.games ?? []).map(normalizeMlb);
    const mlbSnapshot = schedGames[0]!;

    engine.ingestEspn(baseGame);
    expect(engine.games.get(baseGame.id)?.authority).toBe("espn");

    // Now ingest the MLB Stats API feed (which has home score 7, 2 home runs)
    engine.ingestMlb(baseGame.id, mlbSnapshot);
    const cur = engine.games.get(baseGame.id);
    expect(cur).toBeDefined();
    expect(cur?.authority).toBe("mlb");
    expect(cur?.home.score).toBe(7);
    expect(cur?.baseball_situation).toBeDefined();
    expect(cur?.baseball_situation?.outs).toBe(3);
    expect(cur?.goals.length).toBe(7);

    // Verify buildEvent produces a HOME RUN payload with baseball situation
    const hrPlay = cur!.goals[3]!;
    const ev = engine.buildEvent("goal", cur!, {
      team: cur!.home,
      delta: 2,
      play: hrPlay,
    });

    expect(ev.scoring?.label).toBe("HOME RUN");
    expect(ev.scoring?.scorer).toBe("Junior Caminero");
    expect(ev.baseball).toBeDefined();
    expect(ev.natural_text).toContain("Home run, Tampa Bay Rays!");
  });

  it("Poller tracks MLB feed in liveProviders and calls tickMlb", async () => {
    const store = new Store(":memory:");
    const engine = new Engine(store);
    const poller = new Poller(engine);

    // Register an active MLB game
    const liveGame: Game = {
      id: "mlb:849815",
      league: "mlb",
      sport: "baseball",
      status: "in",
      start_time: new Date().toISOString(),
      period: 5,
      period_label: "5th inning",
      clock: "Bot 5th",
      intermission: false,
      home: makeTeam("tb", "TB", "Rays", "Tampa Bay Rays", 2),
      away: makeTeam("cle", "CLE", "Guardians", "Cleveland Guardians", 0),
      linescores: { home: [], away: [] },
      stats: { home: {}, away: {} },
      goals: [],
    };
    engine.games.set(liveGame.id, liveGame);
    store.setSyncedGames([liveGame.id]);

    // liveProviders must now report "mlb"
    const providers = poller.liveProviders();
    expect(providers.has("mlb")).toBe(true);

    const warnings = poller.providerWarnings();
    expect(warnings).toEqual([]);
  });
});
