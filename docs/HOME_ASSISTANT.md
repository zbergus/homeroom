# Home Assistant Setup

Homeroom drives home automations via Home Assistant (HA). It detects hockey events in real time (goals, power plays, intermissions, game start/end) and natively orchestrates Home Assistant devices—lights, speakers, and TTS announcements—with zero plugins and zero custom components.

---

## 1. Quick Setup (Direct Connection)

1. In Home Assistant: go to your user profile (bottom left) → **Security** → **Long-Lived Access Tokens** → **Create Token** (e.g. name it "Homeroom").
2. In Homeroom Dashboard: go to **Settings** → **Home Assistant**:
   - **Home Assistant URL**: your HA local URL (e.g. `http://homeassistant.local:8123` or `http://192.168.1.50:8123`)
   - **Long-lived access token**: paste the token from step 1 (stored securely in SQLite, write-only)
   - **Public base URL**: LAN URL of Homeroom (e.g. `http://192.168.1.10:8080`), reachable by media players to stream horns
3. Click **Test connection** (or **Sync devices**). Homeroom will immediately discover all your lights, smart speakers, and TTS engines!

---

## 2. Configuring Lights (In Homeroom)

Go to **Triggers & light actions** in the Homeroom Dashboard:
- Choose when your lights trigger (Any Goal, Power Play Goal, Short-Handed Goal, Empty Netter, Period End, Team Win).
- Select target smart bulbs from your auto-discovered Home Assistant lights.
- Pick your effect:
  - **Alternate**: smoothly switches between the scoring team's primary and secondary colors for the duration of the celebration.
  - **Flash**: blinks the bulbs at your chosen speed.
  - **Set Color**: applies the team's primary color.
  - **Light Effect**: triggers your bulb hardware's native effect (e.g., Hue candle, fire).
- Check **Restore**: Homeroom automatically records prior bulb states (on/off, brightness, color, effect) and restores them when the celebration completes.

---

## 3. Configuring Audio & Horns (In Homeroom)

Go to **Audio & Goal Horns** in the Homeroom Dashboard:
- **Horn Speakers**: Select or enter your smart speakers (`media_player.*`).
- **Volume Boost**: Optional dedicated goal horn volume (e.g. 80%). Homeroom boosts the speaker volume just before the horn starts and restores previous volume when it ends.
- **TTS Speaker & Engine**: Choose which speaker announces the goal and which TTS engine to use (e.g., Piper, Cloud, or default `tts.speak`).
- **Horn Trimming & Fade**: Homeroom can trim long horns (`horn_max_s`, default 30s) with smooth fade-out (`horn_fade_ms`) and volume normalization.

### Celebration Sequence
When a goal is detected:
1. Lights start alternating/flashing in the team's colors.
2. Speaker volume boosts, and the team horn MP3 streams via `media_player.play_media`.
3. Homeroom calculates the exact duration of the horn file.
4. Once the horn finishes, volume restores and the bilingual TTS announcement speaks (e.g., *"Goal, Montreal Canadiens! Cole Caufield scores. Canadiens 3, Maple Leafs 2."*).
5. Lights restore to their original state.

### When nothing comes out of the speaker
- **Test Goal Alert** plays horn and announcement; **Test TTS** speaks one fixed line only. Both answer in the dashboard, and every failed Home Assistant call is logged by Homeroom as `[ha] speakAnnouncement <engine> -> <speaker>: HTTP ...` with Home Assistant's own reason (`docker logs homeroom` / the Arcane log view).
- **HomePod / AirPlay speakers** (Apple TV integration, `pyatv`): the speaker downloads the clip and gives up after 10 s, so Homeroom pre-synthesizes the line through `/api/tts_get_url` before speaking. A slow TTS engine (generative ones can take 5-20 s) still works, it just starts later.
- **No TTS engine configured**: `tts.speak` without an entity is a bare HTTP 400. Homeroom falls back to the first `tts.*` entity Home Assistant reported, so run **Sync devices** once after adding an engine.
- **Chromecast / Google Cast groups**: a group only plays while its members are on; `quick_play` fails silently otherwise. Point the TTS speaker at a real speaker, or at the group once its members are up.
- A 500 with *"Failed to stream media to the Apple TV"* usually means Home Assistant could not download the audio: check that the speaker and Home Assistant agree on the URL (Home Assistant's **internal URL** must be an address the speaker can reach, e.g. `http://192.168.1.10:8123`).

---

## 4. Optional: Custom Home Assistant Automations (Event Bus)

Homeroom can also post events directly onto Home Assistant's event bus if you want custom HA automations (such as pausing Plex, flashing an ESPHome custom LED strip, or sending phone push notifications).

Check **Fire REST events** in Homeroom Settings → Home Assistant.

### Available Event Types:
- `homeroom_goal`: Dispatched on confirmed goals.
- `homeroom_period_start`: Dispatched at the start of a period.
- `homeroom_period_end`: Dispatched at intermission.
- `homeroom_game_start`: Dispatched when puck drops.
- `homeroom_game_end`: Dispatched when final.
- `homeroom_goal_overturned`: Dispatched if a goal is disallowed upon video review.

### Example Home Assistant Automation:
```yaml
alias: "Hockey Goal Notification"
trigger:
  - platform: event
    event_type: homeroom_goal
condition:
  # Optional: only trigger when your favourite team scores
  - condition: template
    value_template: "{{ trigger.event.data.team_abbr == 'MTL' }}"
action:
  - action: notify.notify
    data:
      title: "{{ trigger.event.data.label }}"
      message: "{{ trigger.event.data.tts_message }}"
```

### Event Payload Structure:
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

---

## 5. Post-Deploy Checklist

1. Go to Homeroom Settings → Home Assistant, click **Test connection**, and verify that lights and speakers are discovered.
2. In the Dashboard, click **Test Goal Alert** to test the full loop:
   - Lights alternate in team colors and restore.
   - Smart speakers boost volume, play the goal horn, restore volume, and speak the TTS announcement.
3. During a live hockey broadcast: use **Alerts → Calibrate** or **Scan TV with Camera** to synchronize stream delay with your broadcast clock.
