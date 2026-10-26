# Homeroom Design System (`DESIGN.md`)
*Impeccable-grade design system for The Rink Mancave edition.*

## 1. Product Character & Identity
Homeroom is a dedicated, self-hosted hockey intelligence and automation platform. It is designed for two high-context environments:
1. **The Tactical Mancave Rig (Product Surface):** A dense, tactile hardware-inspired control interface for managing live feeds, Home Assistant automations, delays, celebrations, and kiosk displays.
2. **The Arena Experience (Atmospheric Surface):** 10-foot television screens simulating arena jumbotrons, LED ribbon boards, and broadcast score bugs.

### Anti-Patterns Explicitly Banned
- ❌ **No "AI Slop" Gradients:** No uncalibrated purple-to-blue or cyan-to-violet linear gradients.
- ❌ **No Card-in-Card Nesting:** No infinite nested gray containers with rounded corners. Use structural dividers, subtle elevation steps, and typographic grouping.
- ❌ **No Muddy Drop Shadows:** Replace soft, fuzzy CSS box shadows with tactile 1px rim highlights (`inset 0 1px 0 rgba(255, 255, 255, 0.08)`).
- ❌ **No Font Monoculture:** Never use a single generic sans-serif for scores, telemetry, and control labels. Scores require condensed athletic display faces; clocks and stats require tabular monospaced numbers.
- ❌ **No Hardcoded Pixel Sizes on Kiosk Views:** Kiosk displays must scale strictly with the `--u` unit system (`--u0: min(1vw, 1.7778vh); --u: var(--u0)`).

---

## 2. Color Tokens

### Dark Canvas & Surfaces (Cold Rink Tones)
| Token | Value | Semantic Role |
| :--- | :--- | :--- |
| `rink-deep` | `#040711` | Primary viewport background (deepest rink dark) |
| `rink-surface` | `#090e1b` | Main panel and container background |
| `rink-panel` | `#0f172a` | Tactile panel body / secondary card |
| `rink-elevated` | `#172138` | Interactive states, toolbars, drawer panels |
| `rink-input` | `#060a14` | Recessed input fields, sunken meters, dark matrix background |

### Tactical Accents & Signatures
| Token | Value | Semantic Role |
| :--- | :--- | :--- |
| `ice-cyan` | `#00d4ff` | Tactical primary accent, active tab, selected filter |
| `ice-cyan-soft` | `#4ce2ff` | Hover / interactive focus state for cyan elements |
| `goal-amber` | `#ff9f1c` | Goal lamp warm amber, active automation toggle, warning alerts |
| `goal-amber-glow` | `#ffb74d` | Illuminated goal lamp glow effect |
| `puck-red` | `#e63946` | Red line, live goal trigger, critical errors, penalty |
| `rink-emerald` | `#10b981` | Healthy system status, connected WS, successful automation |

### Borders & Rims
| Token | Value | Usage |
| :--- | :--- | :--- |
| `rim-subtle` | `rgba(255, 255, 255, 0.07)` | Structural partition lines and subtle panel boundaries |
| `rim-tactical` | `rgba(255, 255, 255, 0.12)` | Interactive borders (buttons, cards, switches) |
| `rim-highlight` | `inset 0 1px 0 rgba(255, 255, 255, 0.09)` | Top bevel light on tactile hardware panels |

---

## 3. Typography Matrix

### Font Families
1. **Athletic Display (`font-display`):**
   - Fallbacks: `"Barlow Condensed", "Oswald", "Impact", "Arial Narrow", sans-serif`
   - Purpose: Team abbreviations, large scores, period numbers, jumbotron headers.
   - Styling: High-impact uppercase, tight tracking (`tracking-tight` or `tracking-wide` for acronyms).
2. **Telemetry & Clocks (`font-mono` / `.num`):**
   - Fallbacks: `"JetBrains Mono", "ui-monospace", "SFMono-Regular", "Menlo", monospace`
   - Purpose: Period clocks, shots on goal (SOG), delay offsets (`+4.5s`), timestamps, WebSocket latency.
   - Styling: Always `font-variant-numeric: tabular-nums` (class `.num`).
3. **Control UI Sans (`font-sans`):**
   - Fallbacks: `ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`
   - Purpose: Control labels, form inputs, modal dialogs, status descriptions.

---

## 4. Component Patterns

### Tactical Panel (`.panel-tactical`)
- Background: `bg-rink-surface` (`#090e1b`)
- Border: `1px solid rgba(255, 255, 255, 0.08)`
- Top Highlight: `box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.08)`
- Header: Crisp uppercase subtitle (`text-xs font-semibold tracking-wider text-slate-400 uppercase`) with bold title.
- Actions: Grouped right-aligned with tactile buttons.

### Tactile Rocker Switch
- Container: Recessed track in `#060a14` with a subtle 1px border.
- Knob: Distinct tactile pill with an embedded micro-LED jewel (`.led-jewel`) that glows amber when active.

### Jewel Status LED (`.led-jewel`)
- Micro indicator dot with subtle radial glow:
  - Green (`#10b981`): Healthy, connected
  - Amber (`#ff9f1c`): Warning / reconnecting / delay active
  - Red (`#e63946`): Error / disconnected
  - Cyan (`#00d4ff`): Live sync active
