# AGENTS.md: Homeroom

Context for AI coding agents (and humans) working in this repo. Read this first; it is the shortest path to not breaking things.
Longer docs: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) · [`docs/HOME_ASSISTANT.md`](docs/HOME_ASSISTANT.md) · [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md) · [`SPEC.md`](SPEC.md) (wire contracts + research) · [`README.md`](README.md) (user-facing).

## What this is
A **self-hosted, local-first dedicated hockey platform ("The Rink Mancave" edition)** for one person's home. It watches live hockey games (official NHL API, ESPN international hockey tournaments, and the AHL HockeyTech feed), detects game start / period changes / goals / power plays / intermissions / game end, and drives Home Assistant (lights, goal horn, TTS) plus kiosk TV views (`/scoreboard`, `/plate`, `/grid`, `/ticker`) and a control dashboard (`/`). Personal use, LAN only, no accounts, no billing, no cloud.

It does **not** need custom device connectors: Home Assistant owns smart home devices. Homeroom decides *what should happen and when*; HA executes.

## Repo map
```
server/   Node 22 + TypeScript (Fastify, ws, node:sqlite)   the engine, APIs, TV display WebSocket
web/      Vite + React + Tailwind                           dashboard + TV views (dark mode only)
scripts/  fetch-horns.mjs, make-default-horn.sh
docs/     ARCHITECTURE / HOME_ASSISTANT / DEVELOPMENT / DEPLOYMENT, research/ (reference screenshots, see its README)
deploy/   Arcane compose + .env template (pulls the image CI publishes to GHCR; .github/workflows/ci.yml builds it)
data/ media/   runtime volumes (SQLite, goal horns); git-ignored contents
```
Key server files: `engine/engine.ts` (state, diff, events, delay), `engine/poller.ts` (adaptive polling), `engine/triggers.ts`, `outputs/dispatch.ts` (the one gate before any automation output), `outputs/ha.ts` (Home Assistant REST output), `outputs/lights.ts`, `providers/{espn,nhl,boxscore,insight}.ts`, `http.ts` (all routes), `app.ts` (wiring; tests build the whole app with it), `store.ts` (SQLite + settings).

## Commands
```bash
cd server && npm install && npm test          # vitest; must stay green
cd server && npm run typecheck && npm run dev # :8080 (set PORT, DATA_DIR, MEDIA_DIR, WEB_DIR for throw-away runs)
cd web && npm install && npx tsc --noEmit && npm run build   # `?mock=1` on any view runs without a backend
docker compose up -d --build                  # packaged stack
node scripts/fetch-horns.mjs --dry-run        # verify the horn manifest URLs (NHL only); drop --dry-run to import
```
Always finish a change with: server `npm run typecheck && npm run lint && npx vitest run` (typecheck covers `src` and `test`; lint is Biome, run from the repo root config), web `npx tsc --noEmit && npm run build`. Both packages compile with `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes` (domain DTOs declare optional fields as `x?: T | undefined`, since they are JSON where absent and undefined are the same). `any` is only allowed through `providers/raw.ts` (`Raw`); the linter rejects it everywhere else. If `npm run lint` reports "nested root configuration", a git worktree under `.claude/worktrees/` is still checked out inside the repo; `git worktree remove` it. For UI changes, look at real screenshots (see DEVELOPMENT.md).

## Invariants: do not break these
1. **Home Assistant integration is direct REST** (`docs/HOME_ASSISTANT.md`). Homeroom calls HA REST APIs directly (`/api/services/light/*`, `/api/services/media_player/*`, `/api/services/tts/*`, and `/api/events/homeroom_<type>`). No third-party websocket bridges or Pusher emulators are needed.
2. **Everything a viewer or automation could be spoiled by goes through the delay buffer** (`engine/delay.ts`, 0–120 s, 0.5 s steps, per game > per league > global, release order never goes backwards per game). Only *manual* events (buttons, test) are immediate by default. `/api/games/raw` is the one undelayed view and is **control-plane only**: never feed it to a TV view.
3. **One gate for automation output**: `Dispatcher.handle` (`outputs/dispatch.ts`). It applies `automations_enabled` and `my_team_only`; the TV UI always sees every event. Manual events bypass the gates. Every event is recorded in the event log with an outcome and reason; keep it that way (the diagnostics panel depends on it).
4. **First sight of a game seeds state silently** (no replayed goals); score *decreases* never fire events; a drop shortly after an announced goal may produce a UI/REST-only `goal_overturned` after a 20 s confirm window. `Engine.commit` works on a copy of its input; do not mutate caller objects.
5. **Providers are unofficial and flaky.** Every parser is defensive; a missing field hides a row/screen, it never throws or shows blanks. New parsers get a real-payload fixture test.
6. **Secrets and the HTTP boundary**: all environment variables are parsed once by `server/src/config.ts` (`loadConfig`); every request body/query that is not a pure pass-through goes through a Zod schema in `server/src/schemas.ts` (never `req.body as T`). Mutating `/api` calls and the WebSocket upgrades refuse cross-site browser requests (`security.ts` `isCrossSite`) and the API only takes JSON (horn upload: multipart). The stored HA token is bound to its URL: changing `ha.url` without a new token clears it. The Home Assistant token is write-only (`GET /api/settings` returns `token_set`, never the token). Never write tokens/keys to files, logs, tests, memory, or commits. `ADMIN_TOKEN` (optional) guards mutating routes and `GET /api/hook/*`.
7. **No third-party brand assets or audio** in the product or repo: no bundled proprietary horns or trademarked copy.
8. **The delay buffer is persistent.** Every `buffer.push` goes through `Engine.pushOut`; queued events live in the `pending_events` table until released; `Engine.restore()` runs once in `createApp` after listeners attach. Overdue by more than the grace (`HOMEROOM_RESTORE_GRACE_S`, 10 s) means dropped with a log line, never replayed late. The 20 s `goal_overturned` confirm timer is not restored.
9. **Horn volume is opt-in and best effort** (`outputs/horn_volume.ts`): it never blocks the horn or lights, never runs without `horn_volume` + `horn_players` + HA url/token, reads the player's volume first so it can restore it, and stays under the ~3 s goal-to-horn rule.
10. **Provider health**: `/api/status.providers` is fed by `Poller.health`; wrap any new provider call with `this.health.track(...)` so a silent feed failure shows up as a warning.
11. Lights: effects are capability-aware. White-only bulbs (`supports_color=false`) and plugs flash instead of alternating; a `light_effect` the light does not advertise flashes instead.
12. **Horns are served through `audio/horns.ts`** (`/media/horns/...`): length cap `horn_max_s` (default 30; a long horn delays the HA announcement), `horn_fade_ms`, `horn_normalize`, `horn_scope` (`favorites|all|home`). The original file is never modified; processed copies live in `$DATA_DIR/cache/horns/`; any processing failure must serve the original bytes; ffmpeg is called with an arg array (no shell) and may be absent (cut-only mode, pure-JS MP3 frame cut). Tests inject a fake runner and must pass without ffmpeg. The Docker image installs ffmpeg (+~400 MB).

## Conventions
- TypeScript strict, ESM (`.js` import suffixes). Match the surrounding style; comments explain *why*. No new runtime dependencies without a reason.
- Settings changes: validate in `Store.patchSettings`, expose in `types.ts` (server **and** `web/src/types.ts`; keep them in sync by hand), and only call `poller.poke()` when polling inputs changed (not for the delay slider).
- UI: everything scales with the `--u` unit system on TV views (no fixed px), tabular numerals, landscape **and** portrait, hide blocks with missing data. Respect `prefers-reduced-motion` except the goal overlay stays visible.
- Tests: pure logic in `server/test/*.test.ts`; whole-stack tests use `createApp({ store: new Store(":memory:") ... port: 0 })`; parsers use `server/test/fixtures/*.json` captured from real feeds. Tests must not write into the repo (vitest config points `DATA_DIR`/`MEDIA_DIR` at a temp dir).
- Commits and pushes only when the user asks. Commits must follow Conventional Commits formatting and use the user's configured git identity (`git config user.name` and `git config user.email`), never machine or agent default identities.
- Versioning: when finishing a meaningful feature, user-facing enhancement, or fix cluster, proactively suggest whether to cut a version release (e.g. `gh release create vX.Y.Z --generate-notes`). Pushing a `v*` tag triggers CI to publish versioned Docker images to GHCR.

## More
Provider quirks, Playwright/browser notes and the implemented/unverified/backlog status live in [`docs/AGENT-NOTES.md`](docs/AGENT-NOTES.md); read it when touching providers or planning new work.
