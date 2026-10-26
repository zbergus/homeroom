# Architecture

## Data flow
```
ESPN scoreboard (all enabled leagues)  ┐
NHL api-web (score/now + play-by-play) ├─► Poller ─► Engine.ingestEspn / ingestNhl ─► commit()
ESPN summary / team schedule / stats   ┘                    │
                                                             ├─ diffGame(prev,next) ─► Detected[] (game_start, goal, period_*, game_end)
                                                             ├─ enrich (scorer, boxscore rows, insight) ─► buildEvent() ─► EventPayload
                                                             ▼
                                                    DelayBuffer (per-game ordered, 0–120 s)
                                                             ▼ released
                                    ┌────────────── Engine emits "game" / "event" ──────────────┐
                                    ▼                                                            ▼
                               UiHub (/ws) ─► TV views + dashboard              Dispatcher.handle(event)
                                                                                  ├─ UI always
                                                                                  ├─ gates: automations_enabled, my_team_only (manual bypasses)
                                                                                  ├─ HaOutputs.orchestrateGoalAudio ─► horn volume, playback & TTS
                                                                                  ├─ HaOutputs.publishRest   ─► Home Assistant REST event bus (homeroom_*)
                                                                                  ├─ LightRules.handle       ─► Direct Home Assistant REST (/api/services/light/*)
                                                                                  └─ EventLog (diagnostics)
```

## Core concepts
**Game** (`types.ts`): canonical state per game, id `"<league>:<espnId>"`. The engine holds two maps: `games` (raw, real time) and `shown` (what viewers may see, i.e. after the delay). `Game` also carries enrichment: `goals` (scoring plays), `stat_rows` (boxscore comparison rows), `insight` (team form + players to watch), `leaders` (input for insight), numeric clock fields.

**State machine** (`engine/diff.ts`, pure): `diffGame(prev, next, minDelta)` returns what happened between two snapshots. First sight of a game returns nothing (seeds silently). `game_start` on pre→in; `period_end`/`period_start` on intermission flag toggles or period increments (a missed intermission still yields both); `goal` per score increase ≥ league `minDelta` (emits one event per scoring play when plays are known); score decreases emit nothing; `game_end` only from in→post. Non-goal events are idempotent via `Store.markEmitted`.

**Authority** (`Engine`): for NHL games the NHL feed owns score/period/clock while fresh (<10 s); ESPN then only contributes colours, logos, linescores, odds, records. This prevents a stale ESPN poll from looking like "score went down, then up" (a double goal). A drop followed by a return to the old score within 120 s is suppressed as a provider flap.

**Hockey powerplay and situation tracking**: For synced live NHL games the poller reads play-by-play; the latest `situationCode` gives `Game.situation` (advantage, home_skaters, away_skaters). A side gaining the skater advantage (e.g. 5v4, 5v3, 4v3) fires one `powerplay` event; repeats within 20 s are suppressed; a pulled goalie is not a power play. Official NHL and tournament `strength` normalises to `ev`, `pp`, `sh`, `en`.

**Triggers** (`engine/triggers.ts`): user-facing vocabulary for light actions; each is a predicate over `EventPayload` (`type`, `scoring.label`, `scoring.delta`, `winner`). A manual press records `ev.trigger` so e.g. "win" fires without a favourite. `MANUAL_SPECS` defines how a button synthesises an event. Legacy actions saved with `on[]` are migrated to `triggers[]` on read (`store.ts: migrateAction`).

**Delay** (`engine/delay.ts`): items are keyed by game id; release time = max(now + delay, last release for that key), so lowering the delay never lets a later item overtake an earlier one. Delay resolution: `delay_by_game ?? delay_by_league ?? delay_global_s` (`Engine.delayMs`). Both state snapshots and events pass through it, so a TV never shows a score before its goal alert. Clock running/stopped states follow that same wall-clock timeline: whistles do not change a 36-second delay. `clock_at_ms` anchors the clock observation to its scheduled replay time; enrichment and secondary-provider updates do not refresh its age. The browser interpolates running clocks for at most 10 seconds, then holds until another observation arrives. Public-feed jumps still appear as corrections; interpolation cannot reconstruct play the provider never reported.

Calibration (`engine/calibrate.ts`) matches the TV period/clock against recent timestamped feed history rather than subtracting game-clock seconds. Submit promptly while the TV clock is ticking; typing time and provider latency contribute to uncertainty. Short, consistent running intervals can be interpolated, but gaps and discontinuities cannot. Repeated stopped-clock readings are ambiguous and return an actionable error instead of a misleading delay. History is in memory and warms up again after a restart; allow up to two minutes for the full supported delay range.

UI snapshot/game WebSocket messages include `server_now_ms`. At receipt the browser translates `clock_at_ms` into its local time domain, preserving the observation's age even if the kiosk and server clocks differ.

**Dispatcher** (`outputs/dispatch.ts`): the single exit for released events (see data flow). `goal_overturned` is UI/REST only.

**Sync model**: a game is synced if ticked by the user, or (auto-sync) it contains a favourite team, unless in `sync_excluded` (`Engine.isSynced`). Events only fire for synced games; the grid and ticker show every game of the enabled leagues.

## Polling (`engine/poller.ts`)
Per league: live (`poll_live_s`, default 2.5 s) while a synced game or any game of a grid league is in progress; warm (30 s) starting 10 min before a relevant start; idle (`poll_idle_s`, default 30 min) but never sleeping past the next warm window. Errors back off ×2 to 60 s. If ESPN's undated scoreboard is on a different day than ET today, today is fetched explicitly each tick (default re-read every 5 min). NHL: `score/now` every `nhl_fast_poll_ms` (1 s) while a relevant NHL game is live or about to start, with play-by-play fetched only when the goal list lags the score. Extra loops: summary every 60 s for live synced games (+ one backfill for synced finished games), insight every 5 min for synced games starting within 3 h or live. Calendar: `getSchedule` = one request per league per day, 10 min cache.

## Providers (`server/src/providers/`)
`espn.ts` scoreboard → `Game`, `fetchSummary` (scoring plays + boxscore rows in one call), raw JSON helpers. Supports multi-tournament fetching for IIHF international tournaments (Olympics, World Juniors, World Championship). `nhl.ts` score/PBP for official NHL API. `ahl.ts` scorebar and game summary for AHL via HockeyTech. `boxscore.ts` hockey stat rows (`shots`, `hits`, `faceoffs`, `powerplay`, `takeaways`, `giveaways`, `pim`) keyed on provider names. `insight.ts` last-10 results, hockey team-stat rows, players to watch (points leader + game log), 6 h cache. `strength.ts` normalisation (`ev|pp|sh|en`).

## Home Assistant integration
Homeroom integrates directly with Home Assistant using standard REST APIs with a long-lived access token:
- `outputs/ha.ts`: synchronizes entities (`/api/states`), triggers test events (`/api/events/homeroom_test`), posts game events (`homeroom_<type>`), and orchestrates horn audio (`/api/services/media_player/play_media`, `/api/services/media_player/volume_set`) and TTS announcements (`/api/services/tts/speak`).
- `outputs/lights.ts`: applies light actions directly via `/api/services/light/*`, querying state beforehand to restore brightness, color, and effects when the action completes.

## HTTP surface (`http.ts`)
Control plane: `/api/{leagues,schedule,sync,settings,triggers,trigger,hook/:trigger,test/goal,status,events/recent,games/live,games/raw,calibrate,teams/…,entities,actions,horns…,ha/test,ha/sync}`, `/healthz`, `/media/horns/<league>/<ABBR>.mp3`, WS `/ws`, WS `/ws/live`, static web build with SPA fallback. `ADMIN_TOKEN` (optional) is required on mutating routes and on `GET /api/hook/*`. `GET /api/settings` redacts the HA token.

## Web (`web/src`)
`views/` Dashboard, Scoreboard, Grid, Ticker (+`App.tsx` routes). `dashboard/` control panels. `kiosk/` goal overlay, toast, break screens. `components/` shared TV pieces (`GameBars`, `StatBars`, `SidePanel`, `Kiosk`). `lib/`: `live.ts` (single WS client, renders exactly what the server sends, already delayed), `clock.ts` (interpolated game clock), `colors.ts` (matchup colour resolver: contrast + clash avoidance), `format.ts`, `mock.ts` (`?mock=1` fake data for every view and state), `api.ts`, `hooks.ts`. Scoreboard debug: `&screen=live|countdown|players|form|stats|summary`.

## Persistence
SQLite (`node:sqlite`, `DATA_DIR/homeroom.db`): settings JSON, synced games, favourites, integration links, synced devices, light actions, team colour overrides, emitted-event keys. Horns are plain files in `MEDIA_DIR/horns/<league>/<ABBR>.mp3` (`default.mp3` per league as fallback). The delay queue and event log are memory-only (a restart drops pending events).
