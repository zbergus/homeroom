import { leagueById, periodLabel } from "../leagues.js";
import type { Game, ScoringPlay, Team, UiEventType } from "../types.js";

export function scoringLabel(_sport = "hockey", _delta = 1, _playText = "", _strength = ""): string {
  return "GOAL";
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

interface TextCtx {
  game: Game;
  team?: Team | undefined;
  label?: string | undefined;
  scorer?: string | undefined;
  period?: number | undefined;
  play?: ScoringPlay | undefined;
}

function periodTextFr(_leagueId: string, n: number): string {
  if (n <= 0) return "";
  if (n === 1) return "1ère période";
  if (n === 2) return "2e période";
  if (n === 3) return "3e période";
  if (n === 4) return "prolongation";
  if (n === 5) return "tirs de barrage";
  return `${n - 3}e prolongation`;
}

function periodPrepFr(p: string): string {
  return `de la ${p}`;
}

export function naturalText(type: UiEventType, c: TextCtx, lang: "en" | "fr" = "en"): string {
  const { game } = c;
  const league = leagueById(game.league);
  const h = game.home;
  const a = game.away;
  const score = `${h.name} ${h.score}, ${a.name} ${a.score}.`;
  const per = (n?: number) => {
    const g = { ...game, period: n ?? game.period };
    return periodText(league.id, g.period);
  };

  if (lang === "fr") {
    const perFr = (n?: number) => {
      const g = { ...game, period: n ?? game.period };
      return periodTextFr(league.id, g.period);
    };

    switch (type) {
      case "goal": {
        const isMtl = c.team?.abbr === "MTL";
        const tag = isMtl ? "But des Canadiens !" : `But, ${c.team?.display_name ?? ""} !`;
        const who = c.scorer ? ` ${c.scorer} marque.` : "";
        return `${tag}${who} ${score}`.replace(/\s+/g, " ").trim();
      }
      case "goal_overturned": {
        const isMtl = c.team?.abbr === "MTL";
        const tag = isMtl ? "Le but des Canadiens" : `Le but pour ${c.team?.display_name ?? ""}`;
        return `${tag} a été refusé après révision. ${score}`.replace(/\s+/g, " ").trim();
      }
      case "powerplay":
        return `Avantage numérique, ${c.team?.display_name ?? ""}.`.trim();
      case "penalty":
        return `Punition, ${c.team?.display_name ?? ""}.`.trim();
      case "sog":
        return `Tir au but, ${c.team?.display_name ?? ""}.`.trim();
      case "game_start":
        return `Le match entre ${a.display_name} et ${h.display_name} commence.`;
      case "period_start":
        return `Début ${periodPrepFr(perFr(c.period))}.`;
      case "period_end": {
        if (h.score === a.score) return `Fin ${periodPrepFr(perFr(c.period))}. Égalité ${h.score} à ${a.score}.`;
        const lead = h.score > a.score ? h : a;
        const trail = lead === h ? a : h;
        return `Fin ${periodPrepFr(perFr(c.period))}. ${lead.display_name} mènent ${lead.score} à ${trail.score}.`;
      }
      case "game_end": {
        if (h.score === a.score) return `Pointage final. Égalité entre ${h.display_name} et ${a.display_name}, ${h.score} à ${a.score}.`;
        const w = h.score > a.score ? h : a;
        const l = w === h ? a : h;
        return `Pointage final. ${w.display_name} l'emportent contre ${l.display_name}, ${w.score} à ${l.score}.`;
      }
    }
  }

  switch (type) {
    case "goal": {
      const who = c.scorer ? ` ${c.scorer} scores.` : "";
      return `Goal, ${c.team?.display_name ?? ""}!${who} ${score}`.replace(/\s+/g, " ").trim();
    }
    case "goal_overturned": {
      return `The goal for ${c.team?.display_name ?? ""} was overturned. ${score}`.replace(/\s+/g, " ").trim();
    }
    case "powerplay":
      return `Power play, ${c.team?.display_name ?? ""}.`.trim();
    case "penalty":
      return `Penalty, ${c.team?.display_name ?? ""}.`.trim();
    case "sog":
      return `Shot on goal, ${c.team?.display_name ?? ""}.`.trim();
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
