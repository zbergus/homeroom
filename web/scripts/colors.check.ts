// Run: npx tsx scripts/colors.check.ts   (no test runner in this package)
import { contrast, deltaE, resolveMatchup, resolveTeam, MIN_DE } from "../src/lib/colors";
import type { Team } from "../src/types";

const T = (abbr: string, p: number[], s?: number[], a?: number[]): Team => ({
  id: abbr, abbr, name: abbr, display_name: abbr,
  options: {
    primary_color_rgb: { r: p[0], g: p[1], b: p[2] },
    ...(s ? { secondary_color_rgb: { r: s[0], g: s[1], b: s[2] } } : {}),
    ...(a ? { alternate_color_rgb: { r: a[0], g: a[1], b: a[2] } } : {}),
  },
});
let fails = 0;
const ok = (c: boolean, m: string) => { if (!c) { fails++; console.error("FAIL", m); } else console.log("ok  ", m); };

const tor = T("TOR", [0, 32, 91], [255, 255, 255]);
const van = T("VAN", [0, 32, 91], [0, 132, 61]);
const a = resolveMatchup(tor, van);
ok(a.switched, "two navy teams: one side switches");
ok(deltaE(a.away.rgb, a.home.rgb) >= MIN_DE, "navy vs navy ends distinguishable");

const bos = T("BOS", [252, 181, 20], [20, 20, 20]);
const b = resolveMatchup(bos, tor);
ok(contrast(b.away.rgb, { r: 255, g: 255, b: 255 }) >= 4.5 || b.away.textIsDark, "yellow side has legible text");

const sas = T("SAS", [0, 0, 0], [196, 206, 211]);
const nyk = T("NYK", [0, 107, 182], [245, 132, 38]);
const c = resolveMatchup(sas, nyk);
ok(c.away.fill !== "rgb(0 0 0)", "pure black primary falls back/lifts");
ok(JSON.stringify(resolveMatchup(sas, nyk)) === JSON.stringify(c), "deterministic");

const white = T("WHT", [255, 255, 255], [20, 40, 120]);
const w = resolveTeam(white);
ok(contrast(w.rgb, { r: 255, g: 255, b: 255 }) >= 4.5, "solo: white primary -> secondary keeps white text >= 4.5");
const none: Team = { id: "x", abbr: "XYZ", name: "x", display_name: "x" };
ok(resolveMatchup(none, none).away.fill.startsWith("rgb"), "no colours: deterministic fallback");
process.exit(fails ? 1 : 0);
