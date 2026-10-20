import { leagueById, periodLabel } from "../leagues.js";
import type { Game, ScoringPlay, Team, UiEventType } from "../types.js";

export function scoringLabel(sport: string, delta: number, playText = "", strength = ""): string {
  switch (sport) {
    case "football":
      if (delta >= 6) return "TOUCHDOWN";
      if (delta === 3) return "FIELD GOAL";
      if (delta === 2) return "SAFETY";
      return "EXTRA POINT";
    case "basketball":
      return "BASKET";
    case "baseball":
      return strength === "HR" || /home run|homers|grand slam/i.test(playText) ? "HOME RUN" : "RUN";
    default:
      return "GOAL";
  }
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

interface TextCtx {
  game: Game;
  card?: { kind: "yellow" | "red"; player?: string | undefined; clock: string };
  team?: Team | undefined;
  label?: string | undefined;
  scorer?: string | undefined;
  period?: number | undefined;
  play?: ScoringPlay | undefined;
}

export function naturalText(type: Exclude<UiEventType, "goal_overturned">, c: TextCtx): string {
  const { game } = c;
  const league = leagueById(game.league);
  const h = game.home;
  const a = game.away;
  const score = `${h.name} ${h.score}, ${a.name} ${a.score}.`;
  const per = (n?: number) => {
    const g = { ...game, period: n ?? game.period };
    return periodText(league.id, g.period);
  };
  switch (type) {
    case "goal": {
      const who = c.scorer ? ` ${c.scorer} ${league.sport === "soccer" || league.sport === "hockey" ? "scores" : "with the score"}.` : "";
      return `${cap((c.label ?? "goal").toLowerCase())}, ${c.team?.display_name ?? ""}!${who} ${score}`.replace(/\s+/g, " ").trim();
    }
    case "card": {
      const who = c.card?.player ? ` ${c.card.player}.` : "";
      return `${cap(c.card?.kind ?? "yellow")} card, ${c.team?.display_name ?? ""}.${who}`.replace(/\s+/g, " ").trim();
    }
    case "powerplay":
      return `Power play, ${c.team?.display_name ?? ""}.`.trim();
    case "first_down":
      return `First down, ${c.team?.display_name ?? ""}.`.trim();
    case "third_down":
      return `Third down defense, ${c.team?.display_name ?? ""}.`.trim();
    case "game_start":
      return `${a.display_name} at ${h.display_name} is starting.`;
    case "period_start":
      return `${cap(per(c.period))} begins.`;
    case "period_end": {
      if (h.score === a.score) return `End of the ${per(c.period)}. Tied ${h.score} to ${a.score}.`;
      const lead = h.score > a.score ? h : a;
      const trail = lead === h ? a : h;
      return `End of the ${per(c.period)}. ${lead.display_name} lead ${lead.score} to ${trail.score}.`;
    }
    case "game_end": {
      if (h.score === a.score) return `Final. ${h.display_name} and ${a.display_name} tie, ${h.score} to ${a.score}.`;
      const w = h.score > a.score ? h : a;
      const l = w === h ? a : h;
      return `Final. ${w.display_name} beat ${l.display_name}, ${w.score} to ${l.score}.`;
    }
  }
}

function periodText(leagueId: string, n: number): string {
  return periodLabel(leagueById(leagueId), n);
}
