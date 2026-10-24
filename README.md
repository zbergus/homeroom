# Homeroom

Self-hosted, local-first replacement for the ConnectedRoom cloud. It watches live games (ESPN public scoreboard + the official NHL API),
detects game start / period changes / scores / game end, and drives your smart home through Home Assistant: lights, goal horns, TTS.
It also serves kiosk-ready TV views (scoreboard with break screens, SportsGrid, LED ticker) and a control dashboard.
Personal-use tool for a trusted LAN.

```
ESPN / NHL APIs ──► engine (state machine) ──► stream-sync delay buffer (0–120 s) ──┬─► Pusher-compatible WS ─► unmodified HA `connectedroom` integration
                                                                                    ├─► HA REST events (connectedroom_goal, …)
                                                                                    └─► UI WebSocket ─► /  /scoreboard  /grid  /ticker
```

**For contributors and AI agents:** start with [`AGENTS.md`](AGENTS.md), then [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md), [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md), [`docs/HOME_ASSISTANT.md`](docs/HOME_ASSISTANT.md) and the wire contracts and research in [`SPEC.md`](SPEC.md).

## Run it

```bash
cp .env.example .env        # set PUBLIC_BASE_URL=http://<this machine's LAN IP>:8080  (speakers fetch horns from it)
docker compose up -d --build
open http://localhost:8080
```
Data lives in `./data` (SQLite) and `./media` (goal horns and celebration videos). Both are bind mounts, so they survive rebuilds.

**Deploying to a home server (Arcane):** CI publishes `ghcr.io/zbergus/homeroom`; paste [`deploy/docker-compose.yml`](deploy/docker-compose.yml) into an Arcane project. See [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md).

## Connect Home Assistant

Full guide: [`docs/HOME_ASSISTANT.md`](docs/HOME_ASSISTANT.md). In short:

```bash
python3 ha/patch_integration.py --src ../connected-room-hass --host <LAN IP of this machine> --port 8080 --key <PUSHER_APP_KEY>
# copy ha/custom_components/connectedroom into <HA config>/custom_components/, restart HA, add "ConnectedRoom" with any API key
```
In the integration's options pick your lights, TTS player(s) and goal-horn player(s). `PUBLIC_BASE_URL` must be a LAN address HA and the speaker can reach, never `localhost`.
**Pick one path for lights**: the integration (recommended) **or** REST events (`connectedroom_goal`, …); both together fire twice. No horn audio ships; upload your own.
Nothing has been tested inside a real Home Assistant yet; use the post-deploy checklist in the HA doc.

## Using it

* **Today** – *Next 24 h* panel and a 7-day calendar. Tick games to sync (events only fire for synced games); ★ favourite teams are **auto-synced** (opt out per game).
* **Stream delay** – 0–120 s in 0.5 s steps; per game, per league, or global (most specific wins). Lights, horn, TTS **and the TV views** are delayed together so nothing spoils the stream.
  **Calibrate**: type the game clock you see on your TV and Homeroom suggests a delay (an estimate good to a couple of seconds).
* **Automation switches** – *My team only* (automation outputs only for your favourite teams' goals; the TV overlay still shows everything), *Disable automations* (only manual buttons fire), *French announcements for Montreal Canadiens* (defaults to French Bell Centre-style goal and period announcements for the Habs, while other teams announce in English).
* **Triggers & light actions** – choose triggers (any score, goal, touchdown, field goal, 2/3-pointer, home run, win, period/game start/end…), lights, effect (flash, alternate team colours, set colour, a light's built-in effect) and restore. White-only bulbs flash instead of showing colours.
* **Manual buttons** – fire any trigger on demand; `GET /api/hook/<trigger>` for Stream Deck / HA `rest_command`.
* **Status & diagnostics** – link status, warnings (no integration, localhost base URL, both paths on…), horn URL check and a live table of what happened to each event and why.
* **Leagues** – NHL, NFL, NBA, MLB, MLS, Premier League, LaLiga, Bundesliga and Champions League are on by default; WNBA, NCAA football and NCAA hockey are opt-in (Setup → Leagues). Disabled leagues are not polled.
* **TV views** – `/scoreboard?game=auto|<id>` (live hero with stats and form, pre-game *players to watch* / *recent form*, intermission *stats* / *summary*), `/grid?max=8&rotate=12`, `/ticker`. `/scoreboard?game=auto` follows only your synced games and favourite teams and, when none is on, counts down to the next one of yours (looked up in the 7-day schedule); add `?only=mine` to `/grid` or `/ticker` to show only your teams' and synced games, updating as you add or remove favourites. Open in any browser, Fully Kiosk or a Chromecast tab. Add `?mock=1` to preview without a backend.
* **Horns** – upload MP3s per team (or a league default) in the UI, or drop files in `media/horns/<league>/<ABBR>.mp3`. `scripts/fetch-horns.mjs` bulk-imports from a manifest of URLs/local paths. Long horns are trimmed on playback (default 30 s, because the spoken announcement waits for the horn to finish), with a fade-out and optional loudness levelling in the Docker image (ffmpeg); a plain `npm run dev` without ffmpeg cuts without a fade. "Play horn for": home team / my teams / both. See [`docs/HORNS.md`](docs/HORNS.md).
* **Celebration videos** – Setup → *Celebration videos*: upload a local MP4 (up to 50 MiB) or paste a Giphy link / video URL, choose a league/team, and optionally assign a player ID. Every TV view (Scoreboard, Plate, SportsGrid, Ticker) uses **player video → team video → built-in GOAL wall** (tiled label in team colours, logo, scorer and updated score). Clips play muted for up to the existing six-second goal overlay, after the stream delay; horns, lights and TTS are unchanged. Short or unplayable clips return to the wall; a failed player video first tries the team video. Reduced-motion viewers see the wall instead of video. Use H.264 MP4 for broad browser compatibility; no transcoding is performed.

### Assigning celebration videos

Leave the player field blank for the team's generic fallback. For a player clip, choose a known scorer from the suggestions or enter `nhl:`, `espn:`, or `mlb:` plus the numeric player ID (**not** jersey number). Suggestions use already-received game data; they are not a full roster search. NHL fast feed, ESPN summaries/soccer details, and MLB Stats API attach those ids when present. If the feed hasn't identified the scorer, the team fallback plays.

Upload to the same assignment to replace a clip; use **Preview** to check playback, or **Delete** to restore the next fallback. Kiosk libraries refresh every 30 seconds and when a goal arrives. Videos remain in the existing media volume under `media/celebrations/`; deleting one never affects horns. Companion screens run Homeroom TV views in a browser; this does not replace or control the game broadcast on your main TV, nor push video to HA media players.

No videos ship with Homeroom and there is no automatic downloader. Supply original or appropriately licensed clips; a clip being publicly viewable does not establish permission to reuse it. Files are local, but browser displays need network access to Homeroom as usual.

## Polling behaviour

Per league: every 2.5 s while a synced game (or any game of a grid league) is live; every 30 s starting 10 min before a start; otherwise every 30 min.
NHL games additionally use the NHL API every 1 s (authoritative for score/clock while fresh, play-by-play for scorer names). Boxscore rows refresh every 60 s for live synced games.
All intervals are settings. ESPN/NHL endpoints are unofficial and can change without notice.

## Develop

```bash
cd server && npm install && npm test && npm run dev     # :8080
cd web && npm install && npm run dev                     # :5173, proxies /api /ws /media; add ?mock=1 to run without a backend
```
Server: Node ≥ 22.13 (built-in `node:sqlite`). Env vars: `PORT, DATA_DIR, MEDIA_DIR, WEB_DIR, PUBLIC_BASE_URL, PUSHER_APP_KEY, PUSHER_APP_SECRET, ADMIN_TOKEN, HOMEROOM_API_KEY, LOG_LEVEL`.

## Security notes

Built for a trusted LAN: no auth by default. Set `ADMIN_TOKEN` to require a Bearer token on mutating `/api` calls and on `GET /api/hook/*` (the dashboard has a field for it) and change `PUSHER_APP_SECRET`.
The Home Assistant token is write-only: the API never returns it. Don't expose port 8080 to the internet; use a VPN or an authenticated reverse proxy.

## Not built / known limits

Bet, fantasy and player trackers; a native HA custom component (the patched upstream integration is used); multi-pane screen layouts; soccer cards, NHL powerplay and NFL down triggers (data sources identified, see `SPEC.md` backlog); "players to watch" for sports other than hockey. No reliable video-review signal exists in the feeds (see `docs/notes/limits-review-signal.md`), so an alert already sent cannot be recalled if a goal is later overturned: Homeroom shows a "goal disallowed" notice and fires `connectedroom_goal_overturned` on the REST path. The delay itself mitigates this for viewers who watch with a stream delay.
