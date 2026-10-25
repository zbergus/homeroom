# Homeroom — Dedicated Hockey Companion Platform

Dedicated hockey companion platform and local-first smart home hub. It monitors live hockey games (the official NHL API, ESPN international hockey tournaments, and the AHL HockeyTech feed),
detects game starts, period changes, goals, power plays, intermissions, and game ends, and drives home automations through Home Assistant: lights, sirens, goal horns, and spoken announcements.
It also serves real-time TV views (hockey scoreboard with intermission statistics, compact broadcast plate scorebug with live SOG and skater strength badges, multiview grid, arena ticker) and a local control dashboard.

```
NHL / ESPN / AHL feeds ──► Engine (state machine) ──► Stream-sync delay buffer (0–120 s) ──┬─► Home Assistant REST events (homeroom_goal, …)
                                                                                           ├─► Pusher-compatible WebSocket (/app/<key>)
                                                                                           └─► UI WebSocket ─► /  /scoreboard  /plate  /grid  /ticker
```

## Philosophy & Architecture

- **Local-first & self-hosted**: Designed to run entirely on a home server on a trusted LAN. No accounts, no subscriptions, and no telemetry.
- **Outbound only for live feeds**: The only outbound network requests made are to public sports data feeds (NHL, ESPN, and AHL) to fetch game schedules, scores, and clocks.
- **Synchronized stream delay**: Sports feeds are typically 10 to 60 seconds ahead of cable and streaming broadcasts. Homeroom buffers and delays all automation events and companion screen updates in unison (0–120 s, 0.5 s increments) so nothing spoils the live broadcast.

## Disclaimer & Licensing

This project is created for personal, non-commercial hobby use. You are welcome to use, study, or fork it under the terms of the MIT License.
The author is not responsible for anything anyone else does with this software or with any fork.
All product names, logos, and brands are property of their respective owners and are used strictly for identification purposes.

> **AI Disclosure**: AI coding assistants were used to facilitate most of the development and testing work on this codebase.

---

## Getting Started

```bash
cp .env.example .env        # configure PUBLIC_BASE_URL=http://<host-ip>:8080 (for speakers to stream audio)
docker compose up -d --build
open http://localhost:8080
```
Persistent data is stored in `./data` (SQLite database) and `./media` (goal horns and celebration clips).

**Home server deployment (Arcane / Docker Compose):** Paste [`deploy/docker-compose.yml`](deploy/docker-compose.yml) into your server deployment manager. See [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md).

## Home Assistant Integration

Homeroom integrates seamlessly with Home Assistant without requiring third-party cloud services. Full setup instructions are documented in [`docs/HOME_ASSISTANT.md`](docs/HOME_ASSISTANT.md).

1. In Homeroom's Dashboard under **Settings → Home Assistant**, enter your Home Assistant local URL and a long-lived access token.
2. Enable **Fire REST events**.
3. Homeroom posts native events (`homeroom_goal`, `homeroom_game_start`, `homeroom_game_end`, `homeroom_period_start`, `homeroom_period_end`, `homeroom_goal_overturned`) directly to Home Assistant.
4. Set up standard Home Assistant automations triggering on `platform: event, event_type: homeroom_goal`.

## Key Features

* **Today's Slate & Auto-Sync**: View upcoming games across the NHL, IIHF, and AHL. Favourite teams (★) automatically sync for automation and screen tracking.
* **Stream Delay Buffer & Calibration**: Configurable delay (0–120 s) per-game, per-league, or globally. Use the built-in camera scanner or manual clock input in the dashboard to measure TV broadcast delay against live feeds.
* **Automation Gates**: *My team only* filter restricts smart home triggers to favoured clubs while keeping TV displays live for all games.
* **French Goal Announcements**: Optional Bell Centre-style French announcements for Montreal Canadiens games (`tts_french_canadiens`).
* **Triggers & Light Actions**: Map hockey triggers (goals, power play goals, short-handed goals, empty netters, power play starts, penalties, shots on goal, team wins) to smart lights with flashing, alternating team colours, or hardware effects.
* **Kiosk TV Views**:
  - `/scoreboard?game=auto|<id>`: Broadcast-style game hero with live boxscore stats, pre-game player cards, and intermission breakdown.
  - `/plate`: Sleek, compact scorebug with live SOG and skater strength badges (5v4, 5v3, 4v3).
  - `/grid?max=8&rotate=12`: Multiview scoreboard rotating through live games.
  - `/ticker`: Arena ribbon score ticker.
  - Preset companion splits (`/screen/dual`, `/screen/grid-ticker`, `/screen/quad`, etc.).
* **Horns & Celebrations**: Upload MP3 team horns or MP4 celebration clips per team and player. Long horns are automatically trimmed with smooth audio fades.

## Development

```bash
cd server && npm install && npm test && npm run dev     # backend API on :8080
cd web && npm install && npm run dev                     # Vite dev server on :5173
```

Before committing changes:
```bash
cd server && npm run typecheck && npm run lint && npx vitest run
cd web && npx tsc --noEmit && npm test && npm run build
```

## Security Notes

Homeroom is intended for use on a private, trusted local network. To protect mutating endpoints when hosting across a wider network, set `ADMIN_TOKEN` in your environment. Home Assistant tokens are stored write-only and never exposed via the API.
