import type { TeamColors } from "./types.js";

export interface PreloadedTeam {
  abbr: string;
  name: string;
  logo: string;
  options: TeamColors;
}

const c = (r1: number, g1: number, b1: number, r2: number, g2: number, b2: number): TeamColors => ({
  primary_color_rgb: { r: r1, g: g1, b: b1 },
  secondary_color_rgb: { r: r2, g: g2, b: b2 },
  alternate_color_rgb: { r: 255, g: 255, b: 255 },
});

export const PRELOADED_NHL_TEAMS: PreloadedTeam[] = [
  { abbr: "ANA", name: "Anaheim Ducks", logo: "https://a.espncdn.com/i/teamlogos/nhl/500/ana.png", options: c(249, 86, 2, 17, 17, 17) },
  { abbr: "BOS", name: "Boston Bruins", logo: "https://a.espncdn.com/i/teamlogos/nhl/500/bos.png", options: c(252, 181, 20, 17, 17, 17) },
  { abbr: "BUF", name: "Buffalo Sabres", logo: "https://a.espncdn.com/i/teamlogos/nhl/500/buf.png", options: c(0, 38, 84, 252, 181, 20) },
  { abbr: "CGY", name: "Calgary Flames", logo: "https://a.espncdn.com/i/teamlogos/nhl/500/cgy.png", options: c(200, 16, 46, 241, 196, 0) },
  { abbr: "CAR", name: "Carolina Hurricanes", logo: "https://a.espncdn.com/i/teamlogos/nhl/500/car.png", options: c(206, 17, 38, 17, 17, 17) },
  { abbr: "CHI", name: "Chicago Blackhawks", logo: "https://a.espncdn.com/i/teamlogos/nhl/500/chi.png", options: c(207, 10, 44, 0, 0, 0) },
  { abbr: "COL", name: "Colorado Avalanche", logo: "https://a.espncdn.com/i/teamlogos/nhl/500/col.png", options: c(111, 38, 61, 35, 97, 146) },
  { abbr: "CBJ", name: "Columbus Blue Jackets", logo: "https://a.espncdn.com/i/teamlogos/nhl/500/cbj.png", options: c(0, 38, 84, 206, 17, 38) },
  { abbr: "DAL", name: "Dallas Stars", logo: "https://a.espncdn.com/i/teamlogos/nhl/500/dal.png", options: c(0, 104, 71, 143, 143, 140) },
  { abbr: "DET", name: "Detroit Red Wings", logo: "https://a.espncdn.com/i/teamlogos/nhl/500/det.png", options: c(206, 17, 38, 255, 255, 255) },
  { abbr: "EDM", name: "Edmonton Oilers", logo: "https://a.espncdn.com/i/teamlogos/nhl/500/edm.png", options: c(4, 30, 66, 255, 76, 0) },
  { abbr: "FLA", name: "Florida Panthers", logo: "https://a.espncdn.com/i/teamlogos/nhl/500/fla.png", options: c(4, 30, 66, 200, 16, 46) },
  { abbr: "LAK", name: "Los Angeles Kings", logo: "https://a.espncdn.com/i/teamlogos/nhl/500/lak.png", options: c(17, 17, 17, 162, 170, 173) },
  { abbr: "MIN", name: "Minnesota Wild", logo: "https://a.espncdn.com/i/teamlogos/nhl/500/min.png", options: c(21, 71, 52, 174, 18, 42) },
  { abbr: "MTL", name: "Montreal Canadiens", logo: "https://a.espncdn.com/i/teamlogos/nhl/500/mtl.png", options: c(175, 30, 45, 25, 33, 88) },
  { abbr: "NSH", name: "Nashville Predators", logo: "https://a.espncdn.com/i/teamlogos/nhl/500/nsh.png", options: c(255, 184, 28, 4, 30, 66) },
  { abbr: "NJD", name: "New Jersey Devils", logo: "https://a.espncdn.com/i/teamlogos/nhl/500/njd.png", options: c(206, 17, 38, 17, 17, 17) },
  { abbr: "NYI", name: "New York Islanders", logo: "https://a.espncdn.com/i/teamlogos/nhl/500/nyi.png", options: c(0, 83, 155, 244, 125, 48) },
  { abbr: "NYR", name: "New York Rangers", logo: "https://a.espncdn.com/i/teamlogos/nhl/500/nyr.png", options: c(0, 56, 168, 206, 17, 38) },
  { abbr: "OTT", name: "Ottawa Senators", logo: "https://a.espncdn.com/i/teamlogos/nhl/500/ott.png", options: c(197, 34, 46, 17, 17, 17) },
  { abbr: "PHI", name: "Philadelphia Flyers", logo: "https://a.espncdn.com/i/teamlogos/nhl/500/phi.png", options: c(247, 73, 2, 17, 17, 17) },
  { abbr: "PIT", name: "Pittsburgh Penguins", logo: "https://a.espncdn.com/i/teamlogos/nhl/500/pit.png", options: c(0, 0, 0, 252, 181, 20) },
  { abbr: "SJS", name: "San Jose Sharks", logo: "https://a.espncdn.com/i/teamlogos/nhl/500/sjs.png", options: c(0, 109, 117, 234, 114, 0) },
  { abbr: "SEA", name: "Seattle Kraken", logo: "https://a.espncdn.com/i/teamlogos/nhl/500/sea.png", options: c(0, 22, 40, 153, 217, 217) },
  { abbr: "STL", name: "St. Louis Blues", logo: "https://a.espncdn.com/i/teamlogos/nhl/500/stl.png", options: c(0, 47, 135, 252, 181, 20) },
  { abbr: "TBL", name: "Tampa Bay Lightning", logo: "https://a.espncdn.com/i/teamlogos/nhl/500/tbl.png", options: c(0, 40, 104, 255, 255, 255) },
  { abbr: "TOR", name: "Toronto Maple Leafs", logo: "https://a.espncdn.com/i/teamlogos/nhl/500/tor.png", options: c(0, 32, 91, 255, 255, 255) },
  { abbr: "UTA", name: "Utah Hockey Club", logo: "https://a.espncdn.com/i/teamlogos/nhl/500/uta.png", options: c(113, 197, 232, 17, 17, 17) },
  { abbr: "VAN", name: "Vancouver Canucks", logo: "https://a.espncdn.com/i/teamlogos/nhl/500/van.png", options: c(0, 32, 91, 0, 132, 61) },
  { abbr: "VGK", name: "Vegas Golden Knights", logo: "https://a.espncdn.com/i/teamlogos/nhl/500/vgk.png", options: c(185, 151, 91, 51, 63, 72) },
  { abbr: "WSH", name: "Washington Capitals", logo: "https://a.espncdn.com/i/teamlogos/nhl/500/wsh.png", options: c(200, 16, 46, 4, 30, 66) },
  { abbr: "WPG", name: "Winnipeg Jets", logo: "https://a.espncdn.com/i/teamlogos/nhl/500/wpg.png", options: c(4, 30, 66, 0, 76, 132) },
];

export const PRELOADED_IIHF_TEAMS: PreloadedTeam[] = [
  { abbr: "CAN", name: "Canada", logo: "https://a.espncdn.com/i/teamlogos/countries/500/can.png", options: c(216, 11, 40, 255, 255, 255) },
  { abbr: "USA", name: "United States", logo: "https://a.espncdn.com/i/teamlogos/countries/500/usa.png", options: c(10, 49, 97, 186, 12, 47) },
  { abbr: "SWE", name: "Sweden", logo: "https://a.espncdn.com/i/teamlogos/countries/500/swe.png", options: c(0, 106, 167, 254, 204, 0) },
  { abbr: "FIN", name: "Finland", logo: "https://a.espncdn.com/i/teamlogos/countries/500/fin.png", options: c(0, 47, 108, 255, 255, 255) },
  { abbr: "CZE", name: "Czechia", logo: "https://a.espncdn.com/i/teamlogos/countries/500/cze.png", options: c(215, 20, 26, 17, 69, 126) },
  { abbr: "GER", name: "Germany", logo: "https://a.espncdn.com/i/teamlogos/countries/500/ger.png", options: c(0, 0, 0, 221, 0, 0) },
  { abbr: "SUI", name: "Switzerland", logo: "https://a.espncdn.com/i/teamlogos/countries/500/sui.png", options: c(218, 41, 28, 255, 255, 255) },
  { abbr: "SVK", name: "Slovakia", logo: "https://a.espncdn.com/i/teamlogos/countries/500/svk.png", options: c(11, 60, 137, 238, 28, 37) },
  { abbr: "LAT", name: "Latvia", logo: "https://a.espncdn.com/i/teamlogos/countries/500/lat.png", options: c(158, 27, 50, 255, 255, 255) },
  { abbr: "DEN", name: "Denmark", logo: "https://a.espncdn.com/i/teamlogos/countries/500/den.png", options: c(200, 12, 43, 255, 255, 255) },
  { abbr: "NOR", name: "Norway", logo: "https://a.espncdn.com/i/teamlogos/countries/500/nor.png", options: c(186, 12, 47, 0, 32, 91) },
  { abbr: "FRA", name: "France", logo: "https://a.espncdn.com/i/teamlogos/countries/500/fra.png", options: c(0, 38, 84, 237, 41, 57) },
  { abbr: "AUT", name: "Austria", logo: "https://a.espncdn.com/i/teamlogos/countries/500/aut.png", options: c(237, 41, 57, 255, 255, 255) },
  { abbr: "KAZ", name: "Kazakhstan", logo: "https://a.espncdn.com/i/teamlogos/countries/500/kaz.png", options: c(0, 175, 202, 254, 209, 0) },
  { abbr: "GBR", name: "Great Britain", logo: "https://a.espncdn.com/i/teamlogos/countries/500/gbr.png", options: c(1, 33, 105, 200, 16, 46) },
  { abbr: "POL", name: "Poland", logo: "https://a.espncdn.com/i/teamlogos/countries/500/pol.png", options: c(220, 20, 60, 255, 255, 255) },
  { abbr: "ITA", name: "Italy", logo: "https://a.espncdn.com/i/teamlogos/countries/500/ita.png", options: c(0, 92, 185, 255, 255, 255) },
  { abbr: "HUN", name: "Hungary", logo: "https://a.espncdn.com/i/teamlogos/countries/500/hun.png", options: c(206, 41, 57, 71, 112, 80) },
  { abbr: "SLO", name: "Slovenia", logo: "https://a.espncdn.com/i/teamlogos/countries/500/slo.png", options: c(0, 93, 170, 237, 28, 36) },
  { abbr: "JPN", name: "Japan", logo: "https://a.espncdn.com/i/teamlogos/countries/500/jpn.png", options: c(188, 0, 45, 255, 255, 255) },
];

export const PRELOADED_AHL_TEAMS: PreloadedTeam[] = [
  { abbr: "ABB", name: "Abbotsford Canucks", logo: "https://assets.leaguestat.com/ahl/logos/50x50/434.png", options: c(0, 32, 91, 0, 132, 61) },
  { abbr: "BAK", name: "Bakersfield Condors", logo: "https://assets.leaguestat.com/ahl/logos/50x50/402.png", options: c(4, 30, 66, 255, 76, 0) },
  { abbr: "BEL", name: "Belleville Senators", logo: "https://assets.leaguestat.com/ahl/logos/50x50/414.png", options: c(197, 34, 46, 17, 17, 17) },
  { abbr: "BRI", name: "Bridgeport Islanders", logo: "https://assets.leaguestat.com/ahl/logos/50x50/314.png", options: c(0, 83, 155, 244, 125, 48) },
  { abbr: "CAL", name: "Calgary Wranglers", logo: "https://assets.leaguestat.com/ahl/logos/50x50/437.png", options: c(200, 16, 46, 241, 196, 0) },
  { abbr: "CHA", name: "Charlotte Checkers", logo: "https://assets.leaguestat.com/ahl/logos/50x50/374.png", options: c(200, 16, 46, 4, 30, 66) },
  { abbr: "CHI", name: "Chicago Wolves", logo: "https://assets.leaguestat.com/ahl/logos/50x50/303.png", options: c(168, 153, 102, 182, 11, 44) },
  { abbr: "CLE", name: "Cleveland Monsters", logo: "https://assets.leaguestat.com/ahl/logos/50x50/356.png", options: c(0, 38, 84, 138, 36, 43) },
  { abbr: "COL", name: "Colorado Eagles", logo: "https://assets.leaguestat.com/ahl/logos/50x50/418.png", options: c(111, 38, 61, 35, 97, 146) },
  { abbr: "CV", name: "Coachella Valley Firebirds", logo: "https://assets.leaguestat.com/ahl/logos/50x50/436.png", options: c(224, 58, 36, 243, 142, 33) },
  { abbr: "GR", name: "Grand Rapids Griffins", logo: "https://assets.leaguestat.com/ahl/logos/50x50/306.png", options: c(206, 17, 38, 0, 38, 84) },
  { abbr: "HFD", name: "Hartford Wolf Pack", logo: "https://assets.leaguestat.com/ahl/logos/50x50/307.png", options: c(0, 56, 168, 206, 17, 38) },
  { abbr: "HEN", name: "Henderson Silver Knights", logo: "https://assets.leaguestat.com/ahl/logos/50x50/430.png", options: c(162, 170, 173, 17, 17, 17) },
  { abbr: "HER", name: "Hershey Bears", logo: "https://assets.leaguestat.com/ahl/logos/50x50/308.png", options: c(74, 50, 39, 212, 175, 55) },
  { abbr: "IA", name: "Iowa Wild", logo: "https://assets.leaguestat.com/ahl/logos/50x50/393.png", options: c(21, 71, 52, 174, 18, 42) },
  { abbr: "LAV", name: "Laval Rocket", logo: "https://assets.leaguestat.com/ahl/logos/50x50/415.png", options: c(175, 30, 45, 25, 33, 88) },
  { abbr: "LV", name: "Lehigh Valley Phantoms", logo: "https://assets.leaguestat.com/ahl/logos/50x50/397.png", options: c(247, 73, 2, 17, 17, 17) },
  { abbr: "MB", name: "Manitoba Moose", logo: "https://assets.leaguestat.com/ahl/logos/50x50/309.png", options: c(4, 30, 66, 0, 76, 132) },
  { abbr: "MIL", name: "Milwaukee Admirals", logo: "https://assets.leaguestat.com/ahl/logos/50x50/310.png", options: c(4, 30, 66, 136, 198, 236) },
  { abbr: "ONT", name: "Ontario Reign", logo: "https://assets.leaguestat.com/ahl/logos/50x50/403.png", options: c(17, 17, 17, 162, 170, 173) },
  { abbr: "PRO", name: "Providence Bruins", logo: "https://assets.leaguestat.com/ahl/logos/50x50/313.png", options: c(252, 181, 20, 17, 17, 17) },
  { abbr: "ROC", name: "Rochester Americans", logo: "https://assets.leaguestat.com/ahl/logos/50x50/316.png", options: c(200, 16, 46, 0, 38, 84) },
  { abbr: "RFD", name: "Rockford IceHogs", logo: "https://assets.leaguestat.com/ahl/logos/50x50/366.png", options: c(207, 10, 44, 0, 0, 0) },
  { abbr: "SD", name: "San Diego Gulls", logo: "https://assets.leaguestat.com/ahl/logos/50x50/404.png", options: c(249, 86, 2, 0, 38, 84) },
  { abbr: "SJ", name: "San Jose Barracuda", logo: "https://assets.leaguestat.com/ahl/logos/50x50/405.png", options: c(0, 109, 117, 234, 114, 0) },
  { abbr: "SPR", name: "Springfield Thunderbirds", logo: "https://assets.leaguestat.com/ahl/logos/50x50/410.png", options: c(0, 47, 135, 252, 181, 20) },
  { abbr: "SYR", name: "Syracuse Crunch", logo: "https://assets.leaguestat.com/ahl/logos/50x50/318.png", options: c(0, 40, 104, 255, 255, 255) },
  { abbr: "TEX", name: "Texas Stars", logo: "https://assets.leaguestat.com/ahl/logos/50x50/370.png", options: c(0, 104, 71, 143, 143, 140) },
  { abbr: "TOR", name: "Toronto Marlies", logo: "https://assets.leaguestat.com/ahl/logos/50x50/319.png", options: c(0, 32, 91, 255, 255, 255) },
  { abbr: "TUC", name: "Tucson Roadrunners", logo: "https://assets.leaguestat.com/ahl/logos/50x50/411.png", options: c(138, 36, 43, 218, 165, 32) },
  { abbr: "UTI", name: "Utica Comets", logo: "https://assets.leaguestat.com/ahl/logos/50x50/394.png", options: c(206, 17, 38, 17, 17, 17) },
  { abbr: "WBS", name: "Wilkes-Barre/Scranton Penguins", logo: "https://assets.leaguestat.com/ahl/logos/50x50/321.png", options: c(0, 0, 0, 252, 181, 20) },
];

export function getPreloadedTeams(league: string): PreloadedTeam[] {
  switch (league.toLowerCase()) {
    case "nhl":
      return PRELOADED_NHL_TEAMS;
    case "iihf":
      return PRELOADED_IIHF_TEAMS;
    case "ahl":
      return PRELOADED_AHL_TEAMS;
    default:
      return [];
  }
}
