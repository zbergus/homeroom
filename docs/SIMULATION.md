# Replay simulator (dev only)

Replays a **finished** game through the whole pipeline (poller, engine, delay buffer, dispatcher, TV views, event log) as if it were live, so break screens, power plays, shootouts and overturned goals can be exercised and screenshotted at any time. Research and fidelity limits: [`notes/replay-research.md`](notes/replay-research.md).

Nothing in `server/src/sim/` is imported by production code. The only production edits are three env-overridable base URLs (`ESPN_BASE`, `ESPN_WEB_BASE`, `NHL_BASE`, each defaulting to the real host), read once at import.

## Run it
```bash
cd server
npm run sim -- --game nhl:401892525 --speed 60 --delay 5     # SJ @ DET, regulation + OT + shootout, 3 min at 60x
# open the printed URLs, e.g. http://127.0.0.1:18102/scoreboard?game=nhl:401892525
```
Options: `--game <league>:<espnId>` (repeat for several; fixture dir `server/test/fixtures/replay/<league>-<id>`), `--speed <x>` (default 10), `--delay <s>` (global delay buffer, default 5), `--start goal:N|intermission:N|final|v:<seconds>` with `--before <s>`, `--phantom <virtual s>:<home|away>[:<hold s>]` (an overturned goal), `--port` (replay server, default 18101; Homeroom on port+1), `--data-dir` (default `/tmp/hr-sim/data-<port>`, wiped each run), `--server-only` (just the replay server, point your own instance at it with the three env vars).

It starts the replay server **and** an in-process Homeroom (`createApp`) on throw-away `DATA_DIR`/`MEDIA_DIR`, the games synced, `delay_global_s` set, leagues enabled. No Home Assistant is configured, so nothing leaves the machine. The console prints a `SIM MODE` banner; `GET /sim/state` says `"SIM": true`; replayed games report `odds.details = "SIM REPLAY"`. The web UI has no SIM banner (web/ is untouched), so do not leave a sim instance on a port a TV points at.

Control API (replay server):
```bash
curl localhost:18101/sim/state                                   # virtual time, per-game snapshot, seek markers
curl -XPOST localhost:18101/sim/speed -d '{"speed":60}'          # (0, 5000]
curl -XPOST localhost:18101/sim/seek  -d '{"to":"goal:2","before_s":15}'   # or {"v_s":3600}; kinds: start kickoff goal intermission resume card final
curl -XPOST localhost:18101/sim/pause ; curl -XPOST localhost:18101/sim/resume
```
Virtual time starts 10 virtual minutes before each game's first recorded event (so `pre` and `game_start` are visible); with several games they share that origin and kick off together.

## Endpoints served (what the providers hit)
`/espn/<sport>/<league>/scoreboard[?dates=]` (the game is listed for no date, today ET, and its recorded day), `/espn/.../summary?event=`, `/espn/.../teams/<id>/{schedule,statistics}`, `/espnweb/.../athletes/<id>/gamelog`, `/nhl/score/{now,YYYY-MM-DD}`, `/nhl/gamecenter/<id>/play-by-play`. Payloads are the recorded real ones with state overlaid, so `normalizeEvent`, `parseSummary`, `normalizeNhl`, `parsePbp` run unchanged. The scheduled start is rebased to "a few seconds from launch" so warm/live windows and the ESPN/NHL start-time matching behave.

## Record another game
```bash
node scripts/record-game.mjs --league nhl --espn 401892525 --date 20261017 --nhl 2026020127
```
Finished games only; writes trimmed payloads (~40-300 KB) to `server/test/fixtures/replay/<league>-<id>/`. Recorded: nhl-401892525 (SO), nhl-401892524 (OT), nhl-401892505 (3-goal SO).

## Tests
`server/test/sim.test.ts` (about 3 s): real engine under fake timers with the delay configured, asserting the event sequence for the SO game (game_start, goals with scorers, period_end/start, powerplay, game_end), that the delay holds each goal back by the configured time, no duplicates; the phantom-goal scenario (`goal` then `goal_overturned`); multi-goal shootouts; sim server routes and seek. `src/sim/drive.ts` mirrors `Poller.tickEspn/tickNhl` for these tests; the full poller path is what `npm run sim` exercises.

## Caveats
- **Speed compresses production's real-time windows** (120 s flap suppression, 20 s overturn confirm, 20 s power-play repeat, polling). Use `--speed 1..5` when checking those; 60x is for looking at screens and sequencing.
- The delay is real seconds (10 s at 60x is 600 virtual seconds).
- Boxscore stats are scaled approximations, team form/players are final-day; see the research note.
- `/api/settings` of the sim instance is a normal Homeroom: do not link it to HA.

## Findings
Production observations made while replaying (reported, not fixed):
1. `providers/nhl.ts:56` and `:118` build the goal key from `period-timeInPeriod-homeScore-awayScore`. Every shootout goal has `timeInPeriod "00:00"` and the same pre-shootout score (verified on real payloads: DAL@COL, NSH@OTT have three SO goals with identical tuples), so all SO goals share one key. `diff.ts:49` (`!prevKeys.has(p.key)`) then finds no new play when the SO winner's +1 arrives, and the scorer only comes from the ESPN fallback in `Engine.findPlay`. It works today by luck of that fallback.
2. **Fixed** (test `server/test/shootout.test.ts`): a hockey shootout showed a game clock (`00:00` in the big clock, `0:00` on the summary goal card) and the Game Summary listed the SO goal under a `2OT` column. Now the shootout has no clock (`isShootout` in `leagues.ts`, applied in `normalizeEvent`, `parseSummary` and the NHL merge in `Engine`), the scoreboard shows `SO`, and the summary column is `SO`. The card still shows ESPN's shootout tally (`DET 1-0`), not the game score. Known limit, shared with the server's `periodLabel`: an NHL *playoff* 2OT is also period 5 and would be called a shootout.
3. By design but worth knowing: `Engine.suppressFlaps` swallows a legitimate goal if a score is taken back and the same team scores again within 120 s (reproduce: `--phantom 900:home:40 --speed 20`, the real first goal arrives 55 real seconds later and fires nothing).
