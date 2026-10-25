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
The Playwright MCP browser is a **shared, single-instance** profile: if it says "Browser is already in use", another session holds it; do not kill it unless the user says it is unused. Headless fallback: a Playwright 1.56.x install driven from a script **outside** the repo. `fastify-static` registers the asset list at boot, so **restart the server after rebuilding `web/`** or new bundles 404 into the SPA fallback.

## Status and backlog
Implemented: Dedicated hockey platform ("The Rink Mancave" edition) supporting NHL, IIHF international tournaments (World Juniors, Men's World Championship, Olympic Hockey), and AHL. Features include: NHL power plays (`powerplay` from play-by-play `situationCode` / skater count), empty-net (`eng`), short-handed (`shg`), and power-play (`ppg`) goal classification, SOG (shots on goal) tracking, compact scoreboard plate view (`/plate` and `?plate=1`) with live SOG and PP 5v4/5v3 badges, auto-sync favorites, preloaded hockey teams catalog with official colors and logos; multi-pane `/screen/<name>` companion presets (`dual`, `grid-ticker`, `mancave-main`, `quad`, `triple`, `scoreboard-plate`, `scoreboard-ticker`, `plate-ticker`, custom URL split ratios & embedded child view overrides), companion player tracker view (`/player`), engine + state machine, adaptive polling (+NHL fast poller and AHL HockeyTech feed), delay buffer with per-game/league/global delays, Pusher bridge + REST events, light rules (triggers, capability-aware, light effects, restore), manual triggers + hook URLs, diagnostics (`/api/status`, `/api/events/recent`), delay calibration (`/api/calibrate`), break-screen data (hockey boxscore rows, team form, players to watch), dashboard, horns manager with trimming and sirens, celebration videos, TV views, Docker packaging.
