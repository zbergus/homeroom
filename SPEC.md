# Homeroom — Technical Specification

Dedicated, local-first hockey platform and companion system for the NHL, AHL, and IIHF international tournaments.

---

## 1. System Architecture

Homeroom runs as a single, self-hosted service (Fastify HTTP server, SQLite database, WebSocket hubs) paired with a React companion web application.

```
Live Feeds (NHL / ESPN / AHL)
      │
      ▼
Poller & Parser ──► Game State Engine ──► Stream-Sync Delay Buffer (0–120 s)
                                                    │
            ┌───────────────────────────────────────┼──────────────────────────────────────┐
            ▼                                       ▼                                      ▼
 Home Assistant REST                     Pusher WebSocket Server                   UI WebSocket Hub
 (homeroom_goal, ...)                   (/app/<PUSHER_APP_KEY>)                          (/ws)
            │                                       │                                      │
            ▼                                       ▼                                      ▼
 HA Automations & Lights                  External PySher Clients                 Kiosk TV Companion Views
```

### 1.1 Core Principles
- **Local-first & LAN only**: No external cloud service accounts, no remote subscriptions, and no telemetry.
- **Outbound only for live feeds**: Network requests leaving the host are strictly limited to polling official and public sports endpoints (NHL API, ESPN, AHL HockeyTech).
- **Synchronized stream delay**: Every event destined for viewer screens or automation output passes through an in-memory delay buffer (0–120 seconds in 0.5s increments) to align with delayed broadcast feeds.

---

## 2. Event Delivery & Home Assistant Contract

Homeroom provides two mechanisms for automation delivery:

### 2.1 Direct Home Assistant REST Events (Native)
Homeroom posts events directly to Home Assistant's event bus via `POST {HA_URL}/api/events/homeroom_<type>` with `Authorization: Bearer <HA_TOKEN>`.

Event types:
- `homeroom_goal`: Dispatched on a confirmed goal.
- `homeroom_period_start`: Dispatched at the start of regulation or overtime periods.
- `homeroom_period_end`: Dispatched at the end of a period (intermission).
- `homeroom_game_start`: Dispatched when the game officially transitions to live.
- `homeroom_game_end`: Dispatched when the game reaches final status.
- `homeroom_goal_overturned`: Dispatched when a previously counted goal is disallowed upon review.

#### Event Payload Schema:
```json
{
  "type": "goal",
  "trigger": "goal",
  "manual": false,
  "winner": null,
  "league": "nhl",
  "game_id": "nhl:401892533",
  "team": "Montreal Canadiens",
  "team_abbr": "MTL",
  "team_color_rgb": [175, 30, 45],
  "secondary_color_rgb": [25, 55, 109],
  "alternate_color_rgb": [255, 255, 255],
  "scorer": "Cole Caufield",
  "label": "Goal",
  "home_team": "Montreal Canadiens",
  "away_team": "Toronto Maple Leafs",
  "home_score": 3,
  "away_score": 2,
  "period": "3rd period",
  "clock": "04:12",
  "tts_message": "Goal, Montreal Canadiens! Cole Caufield scores. Canadiens 3, Maple Leafs 2.",
  "goal_horn_url": "http://192.168.1.10:8080/media/horns/nhl/MTL.mp3",
  "delay_s": 15.0,
  "test": false
}
```

### 2.2 Pusher-Compatible WebSocket Server
For integration with external tools (such as Python `pysher` listeners or WebSocket automation bridges), Homeroom implements a standard Pusher protocol v7 server on `ws[s]://<host>[:port]/app/<PUSHER_APP_KEY>`.

- Clients subscribe to channels such as `private-<unique_id>` using HMAC-SHA256 authenticated handshakes via `/auth/websockets`.
- Game events (`goal`, `goal_horn`, `game_start`, `game_end`, `period_start`, `period_end`) are broadcast as JSON payloads.
- Device control channels (`private-home-assistant.<integration_key>`) support entity commands (`execute.<entity_id>` for flash, alternate colours, set effect, restore) and state querying (`get_state.<entity_id>`).

---

## 3. Live Providers & Polling Engine

### 3.1 Data Feeds
1. **Official NHL API (`https://api-web.nhle.com/v1`)**:
   - `score/now` and `/score/{date}`: Authoritative game status, periods, clock, and scores.
   - `gamecenter/{id}/play-by-play`: Scorer and assist attribution, situation codes (identifying skater strengths: 5v4, 5v3, 4v3, empty net).
2. **ESPN API (`https://site.api.espn.com/apis/site/v2/sports/hockey`)**:
   - International tournament coverage (IIHF World Juniors, Men's World Championship, Olympics).
   - Team schedules, form, standings, and game summary statistics.
3. **AHL HockeyTech Feed (`https://lscluster.hockeytech.com/feed`)**:
   - Live scorebars, game clocks, periods, shots on goal, and game summaries for the American Hockey League.

### 3.2 Adaptive Polling Schedule
- **Idle**: Every 30 minutes when no games are relevant.
- **Warm**: Every 30 seconds starting 10 minutes prior to a scheduled puck drop.
- **Live**: Every 2.5 seconds during live play.
- **Fast Poll (NHL)**: Every 1.0 second on live, synced NHL games for sub-second goal detection.

---

## 4. Delay Buffer & State Machine

### 4.1 State Machine
Games follow the lifecycle: `pre` → `in` (regulation / OT / shootout) ↔ `intermission` → `post`.
- Initial detection seeds game state silently without firing historical events.
- Goals increment scores monotonically; score reductions (disallowed goals) do not re-trigger goal sequences, but emit `homeroom_goal_overturned` after confirmation.

### 4.2 Stream Delay Buffer
- An in-memory min-heap orders releases by `release_at = detected_at + delay_seconds`.
- Delays can be configured per game, per league, or globally (0 to 120 seconds in 0.5s steps).
- Ordering guarantee: events never release out-of-order for a given game.
- The control plane endpoint `/api/games/raw` provides undelayed state for administrative delay calibration. TV kiosk views exclusively consume delayed state.

---

## 5. Smart Home Lights & Audio Output

### 5.1 Light Actions
Automations match hockey triggers to Home Assistant light entities:
- **Triggers**: `goal`, `ppg` (power play goal), `shg` (short-handed goal), `eng` (empty net goal), `powerplay`, `penalty`, `sog` (shots on goal), `overtime`, `shootout`, `intermission`, `win`.
- **Effects**:
  - `flash`: Rapid blinking with configurable duration and speed.
  - `alternate`: Transitions between team primary, secondary, and alternate colors.
  - `set_color`: Holds team primary color.
  - `light_effect`: Activates hardware-supported light effects (e.g. Philips Hue candle or fire effects).
- **Capability Adaptation**: White-only and non-color bulbs automatically fall back to flashing. Prior lighting state is captured and restored after alert execution.

### 5.2 Audio & Horn Management
- Team horns are served via `/media/horns/<league>/<abbr>.mp3`.
- Trimming: Long horns can be automatically trimmed (`horn_max_s`) with smooth audio fade-outs (`horn_fade_ms`) and optional volume normalization (via ffmpeg).
- Goal celebration clips: TV views display player or team MP4 celebration videos alongside goal overlays.

---

## 6. Companion Display Views

Homeroom provides optimized fullscreen TV and scoreboard views:
- `/scoreboard`: Hero view featuring live scores, game clock, SOG, power play indicators, intermission boxscore tables, and pre-game cards.
- `/plate`: Ultra-compact scorebug designed for picture-in-picture or secondary monitor placement with live SOG and player advantage badges.
- `/grid`: Multiview dashboard rotating through live games across leagues.
- `/ticker`: Full-color LED-style scrolling ribbon.
- `/screen/<preset>`: Multi-pane layout presets (`dual`, `quad`, `triple`, `grid-ticker`, `mancave-main`).
