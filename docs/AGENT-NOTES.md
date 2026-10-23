<!-- Moved unchanged from AGENTS.md on 2026-10-23 to cut per-session tokens. -->
# Homeroom agent notes

## Known provider quirks (each cost time once)
- ESPN's **undated scoreboard lags the real date for hours** after midnight ET; the poller asks for today explicitly when `day` differs (`tickEspn`).
- ESPN **rejects date ranges** (HTTP 400); the 7-day calendar is one request per league per day, cached.
- Scoreboard `statistics` are season/YTD junk; real game stats come from `summary?event=` `boxscore` (`providers/boxscore.ts`, per-sport row tables written against real labels).
- ESPN `strength` arrives as "even-strength"/"power-play"; normalise to `ev|pp|sh|en` at the source (`providers/strength.ts`). NHL feed derives strength from `situationCode`.
- Team stats have **no PP%/PK%**; the "recent form" rows use what exists (see `providers/insight.ts`).
- ESPN reports a clock value but no "running" flag; the engine infers it from consecutive polls. NHL reports `running` directly.
- NHL ids ≠ ESPN ids: games are matched by start time ± 3 h and team nickname; the NHL feed becomes authoritative for score/clock while fresh (<10 s) so provider disagreement cannot cause a phantom double goal.

## Working with the browser (Playwright)
The Playwright MCP browser is a **shared, single-instance** profile: if it says "Browser is already in use", another session holds it; do not kill it unless the user says it is unused. Headless fallback: a Playwright 1.56.x install (browsers are cached under `~/Library/Caches/ms-playwright`) driven from a script **outside** the repo. `fastify-static` registers the asset list at boot, so **restart the server after rebuilding `web/`** or new bundles 404 into the SPA fallback.

## Status and backlog
Implemented: opt-in leagues (WNBA, NCAA football, NCAA hockey; off by default, enable in Setup → Leagues), soccer bookings (`card` events, from scoreboard `details[]`; soccer goals/scorers too; tested against fixtures), NHL power plays (`powerplay`, from play-by-play `situationCode`), empty-net suppression, and game end transitions (verified against live game PIT @ UTA, 2026-10-19), NFL 1st/3rd down triggers (`first_down` for offense, `third_down` for defense, from scoreboard `situation`), MLB Stats API integration (`statsapi.mlb.com` fast poller, Home Run vs Run distinction, count/outs/bases situation), compact scoreboard plate view (`/plate` and `?plate=1`), auto-sync favorites; engine + state machine, adaptive polling (+NHL and MLB fast pollers), delay buffer with per-game/league/global delays, Pusher bridge + REST events, light rules (triggers, capability-aware, light effects, restore), manual triggers + hook URLs, diagnostics (`/api/status`, `/api/events/recent`), delay calibration (`/api/calibrate`), break-screen data (boxscore rows, team form, hockey players to watch), dashboard, horns manager, TV views, Docker packaging.
Not verified against real hardware/HA yet: the patched integration runs inside a headless real HA core in `scripts/ha_integration_test/` (login, pysher, `connectedroom_event`, `light.turn_on`, `media_player.play_media`, `tts.speak` all pass) but has never run inside the user's actual Home Assistant; that test does not cover device sync / `get_state` / `execute`. Also unverified: flash speed on cloud-throttled bulbs; soccer behaviour on a live game (only fixtures).
Backlog (see the approved plan notes in `SPEC.md` §6.0–6.0c): multi-pane `/screen/<name>` presets, basketball/football "players to watch".
