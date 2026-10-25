# Home Assistant setup

Homeroom drives home automations via Home Assistant (HA). It detects hockey events in real time (goals, power plays, intermissions, game start/end) and sends them to Home Assistant.

There are two primary ways to connect:

| Path | What it is | Use it for |
|---|---|---|
| **Direct REST events (recommended)** | Homeroom posts `homeroom_goal`, `homeroom_game_start`, `homeroom_game_end`, `homeroom_period_start`, `homeroom_period_end`, `homeroom_goal_overturned` to HA's event API with flat payload fields. | Native HA automations, scripts, scenes, notifications, lights |
| **Pusher WebSocket bridge** | Homeroom exposes a standard Pusher protocol (v7) WebSocket server (`/app/<PUSHER_APP_KEY>`). | Python `pysher` listeners or WebSocket client scripts |

## 1. Connecting via REST Events

1. In Home Assistant: go to your profile (bottom left) → **Security** → **Long-Lived Access Tokens** → **Create Token**.
2. In Homeroom: go to **Settings** → **Home Assistant**:
   - **Home Assistant URL**: your HA local URL (e.g. `http://homeassistant.local:8123` or `http://192.168.1.50:8123`)
   - **Long-lived access token**: paste the token generated in step 1 (stored securely in SQLite, write-only)
   - **Public base URL**: LAN URL of Homeroom (e.g. `http://192.168.1.10:8080`), reachable by media players to stream horns
   - Check **Fire REST events**
3. Tap **Test connection** to verify connectivity (sends a `homeroom_test` event to HA).

### Automation Example in Home Assistant

Whenever a goal is scored, Homeroom fires a `homeroom_goal` event on the HA event bus:

```yaml
alias: "Hockey Goal Alert"
trigger:
  - platform: event
    event_type: homeroom_goal
condition:
  # Optional: only trigger when your favourite team scores
  - condition: template
    value_template: "{{ trigger.event.data.team_abbr == 'MTL' }}"
action:
  - service: light.turn_on
    target:
      entity_id: light.living_room
    data:
      rgb_color: "{{ trigger.event.data.team_color_rgb }}"
      flash: short
  - service: media_player.play_media
    target:
      entity_id: media_player.mancave_speaker
    data:
      media_content_id: "{{ trigger.event.data.goal_horn_url }}"
      media_content_type: music
  - service: tts.speak
    target:
      entity_id: tts.piper
    data:
      media_player_entity_id: media_player.mancave_speaker
      message: "{{ trigger.event.data.tts_message }}"
```

### Event Payload Structure

The `homeroom_*` events provide flat, automation-ready fields:

```json
{
  "type": "goal",
  "trigger": "goal",
  "league": "nhl",
  "game_id": "nhl:401560000",
  "team": "Montreal Canadiens",
  "team_abbr": "MTL",
  "team_color_rgb": [175, 30, 45],
  "secondary_color_rgb": [25, 55, 109],
  "scorer": "Cole Caufield",
  "label": "Goal",
  "home_team": "Montreal Canadiens",
  "away_team": "Toronto Maple Leafs",
  "home_score": 3,
  "away_score": 2,
  "period": "3rd",
  "clock": "04:12",
  "tts_message": "Goal, Montreal Canadiens! Cole Caufield scores. Canadiens 3, Maple Leafs 2.",
  "goal_horn_url": "http://192.168.1.10:8080/media/horns/nhl/MTL.mp3",
  "delay_s": 15.0
}
```

## 2. Making Horns Work

- **Public Base URL**: `PUBLIC_BASE_URL` in `.env` (or Settings) must be an address your smart speakers can reach over the LAN (`http://<LAN_IP>:8080`), never `localhost`.
- **Audio Files**: Upload team MP3 horns via the dashboard or place them in `media/horns/<league>/<ABBR>.mp3`. No copyrighted audio ships with the repository.
- **Horn Scope**: Options include `favorites` (default; horn only for your favourite team), `all` (both teams), or `home` (home team only).
- **Trimming & Loudness**: Homeroom can trim long horns (`horn_max_s`, default 30 s) with a smooth fade-out (`horn_fade_ms`, 1500 ms) and optional volume normalization via ffmpeg.

## 3. Light Actions

In Homeroom Dashboard → **Triggers & light actions**:
Configure triggers (e.g. any goal, power play goal, empty net goal, power play start, shots on goal, team win, period end), select target lights, and choose effects (flash, alternate team colours, set colour, or hardware built-in light effects).

## 4. Manual Triggers & Webhooks

Test or trigger alerts anytime:
- In the dashboard: **Test Goal Alert** or individual trigger buttons
- Via HTTP POST: `POST /api/trigger {"trigger":"goal","team_abbr":"MTL"}`
- Via webhook GET: `GET /api/hook/goal?team=MTL&token=<ADMIN_TOKEN>`
- From Home Assistant: call via a `rest_command` in an HA script or dashboard button.

## 5. Post-Deploy Checklist

1. `GET /api/status`: check that status shows green and no configuration warnings.
2. Dashboard → Alerts → **Test Goal Alert**: verifies light actions, horn audio URL, and TTS generation.
3. Live game: use **Alerts → Calibrate** to align stream delay with your broadcast clock.
