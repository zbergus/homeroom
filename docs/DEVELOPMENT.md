# Development guide

## Setup
Node ≥ 22.13 (the server uses built-in `node:sqlite`; it is loaded through `createRequire` because Vite/Vitest do not yet treat it as a builtin). Python 3 only for the HA patch script and the pysher e2e.
```bash
cd server && npm install        # then: npm test | npm run typecheck | npm run dev
cd web && npm install           # then: npm run dev (:5173, proxies /api /ws /media to :8080) | npm run build
```
Throw-away backend (does not touch real data; polls ESPN live, which is fine):
```bash
cd server && PORT=18090 DATA_DIR=/tmp/hr/data MEDIA_DIR=/tmp/hr/media WEB_DIR=$PWD/../web/dist \
  PUSHER_APP_KEY=k PUSHER_APP_SECRET=s npx tsx src/index.ts
```
Restart it after rebuilding `web/` (static asset list is registered at boot).

## Tests
`cd server && npx vitest run`. Layout:
- `core`, `engine`, `automation`, `calibrate`, `poller`, `enrich`: pure logic and the engine with injected dependencies (`new Engine(store, now, { fetchSummary, buildInsight, retryMs })`).
- `app`: the **whole stack in-process** via `createApp({ store: new Store(":memory:"), appKey, appSecret, webDir: "/nonexistent", port: 0 })`: REST, signed WebSocket subscribe, lights round trips, status/diagnostics, settings, hook auth. A minimal `ws` client plays the role of pysher.
- `boxscore`, `insight`: parsers against **real ESPN payloads** in `server/test/fixtures/`.
- Tests never write into the repo: `vitest.config.ts` sets `DATA_DIR`/`MEDIA_DIR` to a temp dir.

**Refreshing a fixture** (ESPN changed its shape, or a new sport/league): fetch the endpoint with `curl --compressed`, trim to the keys the parser reads (boxscore teams, scoring plays, header competitors), save as `server/test/fixtures/espn-<league>-<kind>.json`, update the assertions, and note the date in the commit message. Useful endpoints: `site.api.espn.com/apis/site/v2/sports/<sport>/<league>/{scoreboard?dates=YYYYMMDD,summary?event=ID,teams/ID/schedule,teams/ID/statistics}`, `site.web.api.espn.com/apis/common/v3/sports/<sport>/<league>/athletes/ID/gamelog`, `api-web.nhle.com/v1/{score/now,gamecenter/ID/play-by-play}`. All unofficial.

## Wire-level check (real pysher client)
```bash
python3 -m venv .venv && .venv/bin/pip install pysher==1.0.8 httpx
.venv/bin/python scripts/e2e_pysher.py --base http://127.0.0.1:18090 --key k
```
Links, syncs a colour-capable fake light, sets a temporary action, fires a manual touchdown, asserts `goal` → `get_state` → `execute`(alternate) → `restore`. It overwrites light actions on the target server, so run it against a throw-away instance.

## Looking at the UI
Every view works without a backend: `?mock=1` (`/scoreboard?mock=1&game=nhl:m1|m3|m4|m5`, sparse-data examples `nba:m1 nfl:m1 epl:m1 mlb:m1`, `&screen=…` to force a break screen, `/grid?mock=1`, `/ticker?mock=1`). Verify with real screenshots at 1920×1080 **and** 1080×1920, and compare against `docs/research/ref-*.png` if present. Real-data check: run the throw-away backend, sync a game (`PUT /api/sync {"games":["nhl:…"]}`), open `/scoreboard?game=<id>`.

Browser tooling: the Playwright **MCP** browser is a single shared profile (if "Browser is already in use", another session holds it). Headless fallback: install `playwright@1.56.x` in a scratch directory *outside* the repo (browsers are cached in `~/Library/Caches/ms-playwright`) and script `chromium.launch()`; it can run in parallel with the MCP browser.

## Debugging recipes
- "No events for a synced game": `GET /api/status` (warnings), `GET /api/events/recent` (delivered/filtered + reason), check `my_team_only`/`automations_enabled`, check the game exists in `GET /api/games/raw` (ESPN's lagging default day, see AGENTS.md).
- "Horn silent": `PUBLIC_BASE_URL` set to a LAN address? `/api/status` → `horns.url_check`. No MP3 for the team *and* no `default.mp3`? The `goal_horn` event is simply not sent.
- "Lights flash twice": HA integration path **and** REST path both driving lights; `/api/status` warns.
- "Alert fires before the play": delay too low; use Calibrate in the dashboard or set per-league presets.
- "Scoreboard stats are empty": the boxscore refresh runs every 60 s for live synced games and after each period end/game end; unsynced games get none.

## Adding things
- **A trigger**: add to `TRIGGERS` and `MANUAL_SPECS` in `engine/triggers.ts` (tests assert every manual spec has a trigger), surface in the dashboard, test the predicate in `automation.test.ts`.
- **A league**: row in `leagues.ts` (ESPN slug, sport, period noun, min delta); sport-specific rows go in `providers/boxscore.ts` (capture a fixture first).
- **A setting**: `types.ts` (server + web) → default + validation in `store.ts` → UI. Poke the poller only if polling inputs change (`POLL_KEYS` in `http.ts`).
- **A break screen**: data in `providers/*` + `types.ts`, view in `web/src/kiosk/Breaks.tsx`, mock data in `lib/mock.ts`, rotation in `views/Scoreboard.tsx`; it must hide itself when data is missing.
