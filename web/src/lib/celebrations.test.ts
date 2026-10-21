import { describe, expect, it } from "vitest";
import type { CelebrationVideo, EventPayload, Game } from "../types";
import { celebrationCandidates, knownScorers } from "./celebrations";

const event: EventPayload = {
  event_id: "goal-1", type: "goal", emitted_at: 1, delay_s: 10, league: "nhl", sport: "hockey",
  game: {
    id: "nhl:1", status: "in", period: 1, period_label: "1st", clock: "10:00",
    home: { id: "1", abbr: "COL", name: "Avalanche", display_name: "Colorado Avalanche" },
    away: { id: "2", abbr: "MIN", name: "Wild", display_name: "Minnesota Wild" },
  },
  team: { id: "1", abbr: "COL", name: "Avalanche", display_name: "Colorado Avalanche" },
  scoring: { label: "GOAL", scorer: "Player", scorer_id: "nhl:123", scorer_number: "29", delta: 1, home_score: 1, away_score: 0 },
};
const videos: CelebrationVideo[] = [
  { league: "nhl", abbr: "COL", player_id: "default", url: "/team.mp4" },
  { league: "nhl", abbr: "COL", player_id: "nhl:123", url: "/player.mp4" },
  { league: "nhl", abbr: "MIN", player_id: "nhl:123", url: "/other-team.mp4" },
  { league: "nba", abbr: "COL", player_id: "default", url: "/other-league.mp4" },
];

describe("celebration selection", () => {
  it("orders player then team regardless of catalogue order", () => {
    expect(celebrationCandidates(event, videos)).toEqual(["/player.mp4", "/team.mp4"]);
  });
  it("uses team fallback when the scorer is unknown; never matches by name", () => {
    expect(celebrationCandidates({ ...event, scoring: { ...event.scoring!, scorer_id: undefined } }, videos)).toEqual(["/team.mp4"]);
    expect(celebrationCandidates({ ...event, scoring: { ...event.scoring!, scorer_id: "nhl:999" } }, videos)).toEqual(["/team.mp4"]);
  });
  it("needs no video and excludes non-goal events or unknown teams", () => {
    expect(celebrationCandidates(event, [])).toEqual([]);
    expect(celebrationCandidates({ ...event, type: "goal_overturned" }, videos)).toEqual([]);
    expect(celebrationCandidates({ ...event, team: undefined }, videos)).toEqual([]);
  });
  it("skips empty URLs and does not return duplicate candidates", () => {
    expect(celebrationCandidates(event, [...videos, videos[1]!])).toEqual(["/player.mp4", "/team.mp4"]);
    expect(celebrationCandidates(event, [{ ...videos[0]!, url: "" }])).toEqual([]);
  });
});

describe("known scorer assignments", () => {
  it("offers unique identified scorers only from the selected league and team", () => {
    const goals = [
      { period: 1, home_score: 1, away_score: 0, team_abbr: "COL", scorer: "Player", scorer_id: "nhl:123", scorer_number: "29" },
      { period: 1, home_score: 2, away_score: 0, team_abbr: "COL", scorer: "Player", scorer_id: "nhl:123" },
      { period: 1, home_score: 2, away_score: 1, team_abbr: "MIN", scorer: "Other", scorer_id: "nhl:456" },
      { period: 1, home_score: 3, away_score: 1, team_abbr: "COL", scorer: "Unidentified" },
    ];
    const game: Game = { ...event.game, league: "nhl", sport: "hockey", start_time: 0, intermission: false, linescores: { home: [], away: [] }, stats: { home: {}, away: {} }, goals };
    expect(knownScorers([game, game], "nhl", "COL")).toEqual([{ id: "nhl:123", name: "Player", number: "29" }]);
    expect(knownScorers([game], "nba", "COL")).toEqual([]);
  });
});
