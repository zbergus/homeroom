// Matchup colour resolver. Pure (no DOM/React) so the server can reuse it.
//
// Rules, in order:
//  1. usable   : a candidate whose luminance is extreme (near black / near white) is only used when
//                nothing else is available; text colour per side is white or near-black, whichever
//                has >= 4.5:1 contrast on the fill (always achievable for mid-tones).
//  2. distinct : the two sides must differ by CIE76 dE >= MIN_DE; otherwise the cheapest alternative
//                (secondary / alternate on either side) that does is chosen.
//  3. deterministic: same inputs give the same output; ties resolve by option order.
//
// API
//   resolveMatchup(away, home, { whiteText? }) -> { away: SideColors, home: SideColors, switched: boolean }
//   resolveTeam(team)          -> SideColors, solo, prefers colours that keep WHITE text >= 4.5:1
//   gradientFor(away, home, angle?) -> CSS hard-split gradient (what diagonal() returns)
//   contrast(a, b), deltaE(a, b), luminance(c)
import type { RGB, Team } from "../types";

const BG: RGB = { r: 11, g: 14, b: 22 };
const WHITE: RGB = { r: 255, g: 255, b: 255 };
const DARK: RGB = { r: 10, g: 13, b: 20 };
export const MIN_DE = 30;

const lin = (v: number) => { const x = v / 255; return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; };
const luminance = (c: RGB) => 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
export function contrast(a: RGB, b: RGB) {
  const la = luminance(a), lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

function lab(c: RGB): [number, number, number] {
  const r = lin(c.r), g = lin(c.g), b = lin(c.b);
  const x = (r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047;
  const y = r * 0.2126 + g * 0.7152 + b * 0.0722;
  const z = (r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883;
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const fx = f(x), fy = f(y), fz = f(z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}
export function deltaE(a: RGB, b: RGB) {
  const p = lab(a), q = lab(b);
  return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
}

const mix = (a: RGB, b: RGB, t: number): RGB => ({
  r: Math.round(a.r + (b.r - a.r) * t), g: Math.round(a.g + (b.g - a.g) * t), b: Math.round(a.b + (b.b - a.b) * t),
});
const css = (c: RGB) => `rgb(${c.r} ${c.g} ${c.b})`;

const hash = (s: string) => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return h; };
function hsl(h: number, s: number, l: number): RGB {
  const a = (s / 100) * Math.min(l / 100, 1 - l / 100);
  const f = (n: number) => { const k = (n + h / 30) % 12; return Math.round(255 * (l / 100 - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)))); };
  return { r: f(0), g: f(8), b: f(4) };
}

interface Cand { rgb: RGB; pen: number; extreme: boolean }

interface ResolveOpts {
  /** the caller always draws WHITE text: light candidates are penalised and darkened to 4.5:1 */
  whiteText?: boolean | undefined;
}

function candidates(t: Team, whiteText = false): Cand[] {
  const o = t.options;
  const raw = [o?.primary_color_rgb, o?.secondary_color_rgb, o?.alternate_color_rgb].filter((c): c is RGB => !!c);
  if (!raw.length) {
    const hue = hash(t.abbr || t.id) % 360;
    raw.push(hsl(hue, 60, 38), hsl((hue + 40) % 360, 55, 28));
  }
  const uniq: RGB[] = [];
  for (const c of raw) if (!uniq.some((u) => deltaE(u, c) < 8)) uniq.push(c);
  return uniq.map((c, i) => {
    let rgb = c;
    const L = luminance(rgb);
    let extreme = L < 0.02 || L > 0.7;
    let pen = i + (extreme ? 10 : 0);
    if (whiteText && contrast(rgb, WHITE) < 4.5) {
      pen += 5;
      for (let k = 1; contrast(rgb, WHITE) < 4.5 && k <= 20; k++) rgb = mix(c, { r: 0, g: 0, b: 0 }, k * 0.04);
      extreme = luminance(rgb) < 0.02;
    }
    return { rgb, pen, extreme };
  });
}

export interface SideColors {
  rgb: RGB;
  fill: string;
  /** darker companion for gradients */
  deep: string;
  /** readable text on `fill` */
  text: string;
  /** de-emphasised text on `fill` */
  muted: string;
  textIsDark: boolean;
  /** true when a non-primary colour was chosen */
  fallback: boolean;
}

/** Used only if a team yields no colour candidates at all (it never does for ESPN data). */
const NEUTRAL: Cand = { rgb: { r: 90, g: 98, b: 110 }, pen: 0, extreme: false };

function finish(c: Cand, fallback: boolean): SideColors {
  let rgb = c.rgb;
  // too dark against the dark UI: lift towards white until it separates
  for (let k = 1; contrast(rgb, BG) < 1.6 && k <= 12; k++) rgb = mix(c.rgb, WHITE, k * 0.04);
  const textIsDark = contrast(rgb, DARK) > contrast(rgb, WHITE);
  return {
    rgb, fill: css(rgb), deep: css(mix(rgb, { r: 0, g: 0, b: 0 }, 0.45)),
    text: textIsDark ? css(DARK) : "#fff",
    muted: textIsDark ? "rgba(10,13,20,.72)" : "rgba(255,255,255,.78)",
    textIsDark, fallback,
  };
}

const cache = new Map<string, { away: SideColors; home: SideColors; switched: boolean }>();
const sig = (t: Team) => `${t.id}|${t.abbr}|${[t.options?.primary_color_rgb, t.options?.secondary_color_rgb, t.options?.alternate_color_rgb].map((c) => (c ? `${c.r},${c.g},${c.b}` : "-")).join(";")}`;

export function resolveMatchup(away: Team, home: Team, opts: ResolveOpts = {}) {
  const key = `${opts.whiteText ? "w" : "x"}${sig(away)}#${sig(home)}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const A = candidates(away, opts.whiteText), H = candidates(home, opts.whiteText);
  let best: { i: number; j: number; cost: number; de: number; ok: boolean } | undefined;
  A.forEach((a, i) => H.forEach((h, j) => {
    const de = deltaE(a.rgb, h.rgb);
    const ok = de >= MIN_DE;
    const cost = a.pen + h.pen;
    const better = !best
      || (ok && !best.ok)
      || (ok === best.ok && (ok ? cost < best.cost : de > best.de + 0.5 || (Math.abs(de - best.de) <= 0.5 && cost < best.cost)));
    if (better) best = { i, j, cost, de, ok };
  }));
  const b = best ?? { i: 0, j: 0 };
  const out = { away: finish(A[b.i] ?? NEUTRAL, b.i > 0), home: finish(H[b.j] ?? NEUTRAL, b.j > 0), switched: b.i > 0 || b.j > 0 };
  if (cache.size > 500) cache.clear();
  cache.set(key, out);
  return out;
}

/** Solo colour: first candidate that keeps white text >= 4.5:1, else the primary darkened until it does. */
export function resolveTeam(t: Team): SideColors {
  const cs = candidates(t);
  const primary = cs[0] ?? NEUTRAL;
  const ok = cs.filter((c) => !c.extreme && contrast(c.rgb, WHITE) >= 4.5)[0]
    ?? cs.filter((c) => contrast(c.rgb, WHITE) >= 4.5 && luminance(c.rgb) >= 0.02)[0];
  if (ok) return finish(ok, ok !== primary);
  let rgb = primary.rgb;
  for (let k = 1; contrast(rgb, WHITE) < 4.5 && k <= 20; k++) rgb = mix(primary.rgb, { r: 0, g: 0, b: 0 }, k * 0.05);
  return finish({ rgb, pen: 0, extreme: false }, true);
}

/** Hard-ish diagonal split of the two resolved fills (cards, break backdrops). */
export function gradientFor(away: Team, home: Team, angle = 115): string {
  const { away: a, home: h } = resolveMatchup(away, home, { whiteText: true });
  return `linear-gradient(${angle}deg, ${a.fill} 0%, ${a.fill} 46%, ${h.fill} 54%, ${h.fill} 100%)`;
}
