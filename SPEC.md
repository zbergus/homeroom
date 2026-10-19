# Homeroom — Specification

> **Status note (kept current by hand).** §1 (the HA integration wire contract) is authoritative and unchanged. Sections 2–5 describe the original design; where the code has moved on, the code and [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) win. Known divergences: light actions use `triggers[]` (trigger ids, e.g. `touchdown`, `basket_3`, `win`) instead of `on[]` event types, and gain a `light_effect` effect; settings gained `my_team_only`, `automations_enabled`, `auto_sync_favorites`, `sync_excluded`, `delay_by_league`; new routes `/api/{triggers,trigger,hook/:trigger,status,events/recent,games/raw,calibrate}`; `GET /api/settings` never returns the HA token; `Game` gained `stat_rows`, `insight`, `clock_s/clock_running/clock_dir`, `Team.record`; the UI/REST-only event `goal_overturned` exists. §6.0–6.0c are research notes; the TV views were rebuilt to match them (hockey break screens implemented; see `AGENTS.md` for the backlog).

A local-first replacement for the ConnectedRoom cloud. It is derived from (a) the open-source
`connected-room-hass` Home Assistant integration v1.1.1 (read in full; **authoritative** for the
wire contract) and (b) the public marketing pages for UI reference (**informational only**; the
logged-in app was not accessed). Screenshots: `docs/research/`.

Everything marked **[wire]** is read directly from the integration source and must be matched
exactly for the unmodified integration to work. Everything marked **[design]** is our choice.

---

## 1. How the upstream integration talks to the cloud [wire]

`const.py` hardcodes `API_URL=https://api.connectedroom.io`, `WSS_HOST=ws.connectedroom.io`,
`WSS_KEY=<pusher app key>`. The integration is a **Pusher-protocol client** (`pysher==1.0.8`) plus
three REST calls. To go local we (1) implement a Pusher-compatible WebSocket server and those REST
endpoints, and (2) point the three constants at us (`ha/patch-integration.sh`).

### 1.1 REST (all `verify=False`, so self-signed TLS is fine)

| Call | Request | Response |
|---|---|---|
| `POST /integrations/home-assistant/link` | `Authorization: Bearer <api_key>`, **form-encoded** `home_assistant_id`, `home_assistant_integration_version` | `{"success":true,"unique_id":"…","websocket_key":"…","integration_key":"…"}`; `success:false` or non-JSON ⇒ "invalid auth" |
| `POST /integrations/home-assistant/devices/sync` | Bearer, **JSON** `{"devices":[Device]}` | `{"success":true}` |
| `POST /auth/websockets` | header `x-websocket-key: <websocket_key>`, **form** `socket_id`, `channel_name` | `{"auth":"<appkey>:<hmac_sha256_hex(secret, socket_id+":"+channel_name)>"}`, HTTP 200 (pysher asserts 200) |
| `POST /requests/execute` | Bearer, JSON `{"scope":"home-assistant.<integration_key>","payload":"<JSON string of entity attributes>","request_id":"…"}` | ignored |

`Device` = `{entity_id, capabilities, device_class ("light"|"switch"), name, supports_flash_speed,
supports_flash_duration, supports_alternate_speed, supports_alternate_duration}`.

### 1.2 WebSocket (Pusher protocol 7)

`ws[s]://<host>[:port]/app/<appkey>?protocol=7&client=…&version=…`

* On connect, server sends `{"event":"pusher:connection_established","data":"{\"socket_id\":\"1.2\",\"activity_timeout\":30}"}`.
* Client sends `pusher:subscribe {channel, auth}`; server verifies `auth` for `private-*` channels and replies
  `{"event":"pusher_internal:subscription_succeeded","channel":…,"data":"{}"}`; bad auth ⇒ `pusher:error` code 4009.
* Client sends `pusher:ping` every 15 s ⇒ reply `pusher:pong`. Server may also ping.
* All server→client frames: `{"event":"<name>","channel":"<chan>","data":"<JSON-encoded string>"}`. **`data` is a string**, the
  integration calls `json.loads(data)`.

### 1.3 Channels and events

**`private-<unique_id>` — game events** (client handlers `ConnectedRoomEvents`)

| Event | Integration behaviour |
|---|---|
| `goal` | Fires HA bus event `connectedroom_event` once per device in the config entry; uses `data.team.options.{primary,secondary,alternate}_color_rgb` (`{r,g,b}`) only for the (unused in UI) `<color>_lights` option; `data.natural_text` → TTS. If goal-horn players are configured, TTS is **deferred** (3 s timer) waiting for the `goal_horn` event. |
| `goal_horn` | `data.audioFile` (absolute URL) played via `media_player.play_media` (`media_content_type: music`) on each goal-horn device; after the player goes `playing→idle`, deferred TTS plays after 1 s. **Must arrive <3 s after `goal`**, or TTS plays first and the horn is skipped/talked over. |
| `period_start`, `period_end`, `game_start`, `game_end` | Fire `connectedroom_event`; `data.natural_text` → TTS. |

Known upstream bug: `goal` handler does `data.already_triggered_from_score_change` (attribute access on a dict) — it
raises `AttributeError` whenever that key is present. We **never send that key**. (`ha/patch-integration.sh` also fixes it.)

**`private-home-assistant.<integration_key>` — device control** (handlers `ConnectedRoomDeviceEvents`;
one `execute.<entity_id>` and `get_state.<entity_id>` binding per synced entity)

`execute.<entity_id>` `data` = `{"action":…}` plus:

| action | fields | effect in HA |
|---|---|---|
| `set_color` | `hs_color`\|`rgb_color`\|`xy_color`\|`color` (`[r,g,b]` or `[x,y]`) | `light.turn_on hs_color` |
| `set_effect` | `effect` | `light.turn_on effect` |
| `set_brightness` | `brightness` (0–255) | `light.turn_on brightness` |
| `turn_on` / `turn_off` | – | domain service |
| `flash` | `duration` (s, ≤300, default 3), `speed` (1–10, default 5) | off/on blinks locally, lands on, restores prior colour. Native `flash:short` for light groups |
| `alternate` | `duration`, `speed`, `colors`: 2–3 of `{r,g,b}`\|`[r,g,b]`\|null (null/[0,0,0] = off) | cycles colours; **ends lit on first colour — send `restore` afterwards** |
| `restore` | `state` = a previous `get_state` payload | `light.turn_on` with brightness/effect/one colour key |

`get_state.<entity_id>` `data` = `{"request_id":"…"}` ⇒ integration `POST /requests/execute` with the entity's
attributes (`brightness, color_mode, hs_color, rgb_color, color_temp_kelvin, effect, …`).

Switches only honour `turn_on`/`turn_off`/`flash`/`alternate`(→flash)/`restore`. Colour/effect/brightness are ignored for non-lights.

### 1.4 What Home Assistant sees [wire]

One event type, **`connectedroom_event`**:
```json
{ "type": "goal|game_start|game_end|period_start|period_end",
  "device_id": "<HA device id>", "entity_id": "<config entry id>", "payload": { …event payload… } }
```
Device triggers (`device_trigger.py`) match on `{device_id, type}`. The names `connectedroom_goal`,
`team_color_rgb`, `tts_message`, `goal_horn_url` from the brief **do not exist upstream**; the real names are
`connectedroom_event`, `team.options.primary_color_rgb`, `natural_text`, `audioFile`. Homeroom therefore offers both
(§5): the real contract (drop-in) and a flat, friendlier REST event path.

### 1.5 Behaviour owned by the cloud that the integration does *not* implement

Light flashing is **server-driven**: the cloud's rules engine ("Actions": sport + trigger + optional team + devices + effect)
decides which entities to `flash`/`alternate`/`set_color`, and when to `restore`. Homeroom must implement this engine (§4.4).
The integration itself only reports capabilities (`supports_*_speed/duration`) so the server can tune effects.

---

## 2. Canonical event payloads [design, superset of wire]

Every game event is a JSON object (extra fields are ignored by the integration):

```jsonc
{
  "event_id": "evt_…", "type": "goal", "emitted_at": 1760000000.5, "delay_s": 12.5,
  "league": "nhl", "sport": "hockey",
  "game": { "id": "nhl:401892533", "status": "in", "period": 2, "period_label": "2nd period",
            "clock": "08:42", "home": Team, "away": Team },
  "team": { "id":"30","abbr":"MIN","name":"Wild","display_name":"Minnesota Wild","logo":"https://…",
            "options": { "primary_color_rgb":{"r":18,"g":71,"b":52},
                         "secondary_color_rgb":{"r":174,"g":18,"b":42},
                         "alternate_color_rgb":{"r":255,"g":255,"b":255} } },
  "scoring": { "label":"GOAL", "scorer":"Danila Yurov", "assists":["Y. Trenin"], "strength":"ev",
               "delta":1, "home_score":1, "away_score":0 },
  "natural_text": "Goal, Minnesota Wild! Danila Yurov scores. Wild 1, Blue Jackets 0.",
  "goal_horn": "http://192.168.1.10:8080/media/horns/nhl/MIN.mp3"   // optional
}
```
`Team` = `{id, abbr, name, display_name, logo, score, options:{…colors…}}`. Non-goal events omit `scoring`/`goal_horn`;
`team` is omitted for `game_*`/`period_*`.

**TTS templates (`natural_text`):** goal `"{Label}, {team}! {scorer} scores. {home} {h}, {away} {a}."` (no scorer ⇒ clause dropped);
`game_start` `"{away} at {home} is starting."`; `period_start` `"{Period label} begins."`;
`period_end` `"End of the {period label}. {leader} leads {x} to {y}."` (tied ⇒ `"Tied {x} to {x}."`);
`game_end` `"Final. {winner} beat {loser}, {w} to {l}."` (soccer/tie ⇒ `"Final. {a} and {b} tie, {x} to {x}."`).

**Scoring labels by delta:** hockey/soccer `GOAL`; basketball `BASKET`; baseball `RUN`/`HOME RUN` (delta≥1 with HR if play text says so; else `RUN`);
football delta ≥6 `TOUCHDOWN`, 3 `FIELD GOAL`, 2 `SAFETY`, 1 `EXTRA POINT`. Leagues have a `min_delta` (default NFL 3, others 1).

---

## 3. Local control-plane API [design]

Base `http://<host>:8080`. JSON. No auth on LAN by default; optional `ADMIN_TOKEN` (Bearer) for mutating routes.

| Route | Purpose |
|---|---|
| `GET /api/leagues` | Supported leagues |
| `GET /api/schedule?days=7` | `{days:[{date:"YYYY-MM-DD" (server-local), games:Game[]}], synced:string[]}`, 7-day calendar for enabled leagues |
| `GET/PUT /api/sync` | `{games:string[], favorites:{league,abbr}[]}`; PUT accepts either key (partial) |
| `GET /api/teams/:league` | Teams seen in the schedule `[{abbr,name,logo,options}]` (horn/colour pickers) |
| `GET/PUT /api/settings` | `{delay_global_s, delay_by_game:{id:s}, poll_idle_s, poll_live_s, nhl_fast_poll_ms, ha:{url,token,fire_rest_events}, public_base_url, horn_scope, tts_enabled}`; delay validated 0–120, 0.5 steps |
| `GET /api/games/live` | Current (delayed) state of all games the UI may show |
| `POST /api/test/goal` | `{league?, team_abbr?, bypass_delay?:true}` fires a synthetic goal (lights + horn + TTS + overlay) |
| `GET/PUT /api/teams/:league/:abbr` | Colour overrides |
| `GET /api/devices`, `PUT /api/actions` | Synced HA devices and per-event light actions (§4.4) |
| `GET /api/horns`, `POST /api/horns/:league/:abbr` (multipart `file`), `DELETE …` | Horn manager |
| `GET /media/horns/:league/:abbr.mp3` | Static horn files (+ `default.mp3` fallback) |
| `POST /api/ha/test` | Verifies HA URL/token by firing `connectedroom_test` |
| `GET /healthz` | |
| `WS /ws` | UI stream (below) |
| Pusher/REST routes from §1 | Drop-in integration |

### UI WebSocket (`/ws`)
Server → client messages (all pass through the **delay buffer**, so the TV never spoils):
```jsonc
{ "t":"snapshot", "games":[Game], "settings":{…} }             // on connect
{ "t":"game", "game":Game }                                     // state update
{ "t":"event", "event":EventPayload }                           // goal / period / game_* for overlays + break screens
```
Client → server: `{ "t":"hello","view":"scoreboard|grid|ticker|control","game_id"? }`.

`Game` = `{id, league, sport, status:"pre|in|post", start_time, period, period_label, clock, intermission:bool,
home:Team, away:Team, linescores:{home:[],away:[]}, stats:{home:{},away:{}}, goals:[ScoringPlay], odds?}`.

---

## 4. Engine behaviour [design]

### 4.1 Providers
* **ESPN** `https://site.api.espn.com/apis/site/v2/sports/{sport}/{league}/scoreboard[?dates=YYYYMMDD]` — schedule, status, score,
  linescores, team colours (`team.color`/`alternateColor`, hex, may be missing), logos, odds. `…/summary?event=ID` for scoring plays when a score changes.
  **ESPN rejects date ranges (HTTP 400)**, so the calendar is one request per league per day (cached 10 min, pooled 8-wide).
  ESPN slugs: nfl `football/nfl`, nhl `hockey/nhl`, nba `basketball/nba`, mlb `baseball/mlb`, mls `soccer/usa.1`, epl `soccer/eng.1`,
  laliga `soccer/esp.1`, bundesliga `soccer/ger.1`, ucl `soccer/uefa.champions`.
* **NHL** `https://api-web.nhle.com/v1/score/now` (redirects to `/score/YYYY-MM-DD`; use redirect-following fetch) and
  `/v1/gamecenter/{id}/play-by-play`. `goals[]` carries scorer (`firstName`/`lastName`), assists, `strength`, `teamAbbrev`, running score;
  `clock.inIntermission`. NHL ids ≠ ESPN ids ⇒ match by date + team nickname (`name.default` ↔ ESPN `team.name`).
  When a mapped NHL game is live and the NHL feed is fresh (<10 s) the NHL feed is **authoritative** for score/period/clock (prevents
  provider disagreement causing phantom decrease+increase double goals); ESPN supplies everything else.

### 4.2 Adaptive polling
Per league: **idle** every 30 min (`poll_idle_s`, 1800); **warm** every 30 s when a relevant game starts within 10 min;
**live** every 2.5 s (`poll_live_s`) while any *relevant* game is in progress. *Relevant* = synced games, plus all games of leagues in the grid. Schedule for
7 days is refreshed at idle cadence. NHL fast poller: `nhl_fast_poll_ms` (default 1000) on live, synced, NHL games.
Back-off ×2 up to 60 s on errors; one in-flight request per league.

### 4.3 Per-game state machine
`pre → in → (intermission ↔ in)* → post`. A diff between previous and next canonical `Game` yields:
* `game_start` — `pre→in` (once).
* `period_end` / `period_start` — period number increases, or an intermission flag toggles (`STATUS_END_PERIOD`, `STATUS_HALFTIME`,
  NHL `inIntermission`); MLB emits per inning (ESPN exposes the inning, not top/bottom, as the period). Never emitted twice for the same `(game, period, kind)` (idempotency key persisted in memory + SQLite).
* `goal` — either side's score **increases**; delta is classified (§2). A score *decrease* (review/disallowed) updates state silently and is logged.
  Multiple increases in one poll emit one event per scoring play when play data allows, else one event with the summed delta.
* `game_end` — `→post` (once). Late-start joins (service started mid-game) **do not** replay `game_start`/past goals: first sight seeds state silently.

### 4.4 Light rules (replacing the cloud "Actions")
`actions[]` = `{id, enabled, on: ["goal"|"game_start"|…], team_scope:"any|favorites|scoring_team", entities:[…], effect:"flash|alternate|set_color",
duration, speed, colors:"team|[...]", restore:true}`. On an event leaving the delay buffer: for each matching action and each synced entity,
(1) send `get_state.<entity>` if `restore`, (2) wait ≤1.5 s for `/requests/execute`, (3) send `execute.<entity>` (`alternate` with
`[primary, secondary, alternate]`, or `flash`), (4) after `duration`+0.5 s send `restore`. Entities are capped by capability flags from `devices/sync`.
A newer effect on the same entity supersedes the older (the integration enforces this locally too).

### 4.5 Stream-sync delay buffer
Single in-memory min-heap keyed by `release_at = detected_at + delay(game)`; `delay(game)=delay_by_game[game] ?? delay_global`, **0–120 s, 0.5 s steps**,
validated server-side. **Everything that could spoil is delayed**: game events, Pusher/HA/REST outputs, UI `game` and `event` messages. The
buffer also keeps state snapshots in order so the TV scoreboard shows the state *as of* `now−delay`. Changing delay affects only
events enqueued afterwards. **Ordering guarantee:** release times never go backwards per game, so *lowering* the delay while items are queued
makes newer items wait for older ones (the new delay is fully effective once the queue drains) instead of overtaking them. `bypass_delay` is available only on test goals.
Timer resolution ≤50 ms. The queue is memory-only; a restart drops pending events (acceptable; documented).

---

## 5. Home Assistant delivery [design]

1. **Drop-in (Pusher emulation)** — the unmodified `connectedroom` custom component, with the 3 constants patched (`ha/patch-integration.sh`
   → `API_URL=http://<host>:8080`, `WSS_HOST=<host>`, `WSS_KEY=<appkey>`, `Pusher(secure=False, port=8080)`). In the integration UI use any API key; `link` issues a stable
   `unique_id`/`websocket_key`/`integration_key` per API key (SQLite). HA fires `connectedroom_event` itself, does TTS and the horn, and runs lights via §4.4.
2. **Direct HA REST** (optional, independent) — Homeroom calls `POST {ha.url}/api/events/<name>` with `Authorization: Bearer <ha.token>`, names
   `connectedroom_goal`, `connectedroom_game_start`, `connectedroom_game_end`, `connectedroom_period_start`, `connectedroom_period_end`, body:
   ```json
   {"league":"nhl","team":"Minnesota Wild","team_abbr":"MIN","team_color_rgb":[18,71,52],"secondary_color_rgb":[174,18,42],
    "alternate_color_rgb":[255,255,255],"scorer":"Danila Yurov","home_score":1,"away_score":0,"period":"1st period","clock":"18:12",
    "tts_message":"Goal, Minnesota Wild! …","goal_horn_url":"http://…/media/horns/nhl/MIN.mp3","game_id":"nhl:401892533","delay_s":12.5}
   ```
   Use either path or both; if both are on and both HA-side automations trigger lights, you will double-flash — documented in README.

Horn URL must be reachable **by the speaker**, so `PUBLIC_BASE_URL` (e.g. `http://192.168.1.10:8080`) is required for horns. Horn scope: `favorites` (default
if any favourite team is in the game, else `all`) or `all`.

---

## 6. UI reference and state transitions [design, informed by public pages]

Visual reference (public product pages, `docs/research/`): dark UI, blue accent; **SportsGrid** = grid of rounded cards, each a **diagonal split
of the two team colours**, circular badge + 3-letter abbr + score per team, a status at bottom-right (`2nd 8:42` live with red dot, `3rd 1:47`, or a
`HH:MM:SS` countdown pre-game), 4 columns on landscape; **Break screens** = full-screen takeovers: *Players to watch* (pre-game, per team, 5-game chart), *Recent form*
(pre-game, last-5 W/L chips, side-by-side averages), *Game stats* (between periods: score, line score, per-sport team stat bars), *Game summary* (every goal
grouped by period with scorer/assists/time/running score, PP/EN tags, ended period highlighted); landscape + portrait; **SportsTicker** = LED scroller of scores. The authenticated app
(calendar, scoreboard config) was not inspected; those screens are our own design. Not copied: logos, copy, assets.

### 6.0 Additional research (public Instagram thumbnails + public feedback board; no login used)
Instagram (`docs/research/instagram.png`) shows real installs: (a) a **compact scoreboard plate** on a secondary screen beside the stream — big centred clock, scores flanking it,
period label underneath, team-colour wedges at the corners; (b) a **ticker strip** with matchup, date/time and odds along the top of a wall of screens; (c) SportsGrid
with diagonal team-colour cards and countdowns; (d) goal moments as a full-room "GOAL GOAL GOAL" wall in team colours plus lights. Not built: compact plate mode, player tracker.
The public feature board (connectedroom.featurebase.app) lists pain points worth designing around: **overtime goals firing before the set delay** (Homeroom delays every output through one buffer, so no
path bypasses it), **overturned goals replaying horn/TTS with a stale score** (Homeroom never fires on a score decrease, but cannot recall an alert already sent — a known limit),
requests for **per-sport / per-network delay presets** (not built; only global + per-game), a **per-clip horn volume slider / fade-out** (not built), and **favourite teams floated to the top of the calendar** (partly: ★ favourites and "sync all followed").

### 6.0b Findings from the authenticated ConnectedRoom app (read-only exploration of a free/trial account; nothing saved, no credits spent)
Screenshots are kept locally in `docs/research/app-*.png` (git-ignored: they show account details). Scoreboards, Custom Game and the TV views are paywalled on the free tier, so **the TV views remain our own design**; everything below is the control app.

**Shell.** Left icon sidebar: My Room, Integrations, Hub, Actions, Screens (`/devices`), Audio, Calendar, Buttons, Capture, Custom Game, Teams, Webhooks, API Keys, Addons, Settings, Help. Audio and Calendar are right-hand **drawers** (`#audio-players`, `#calendar`), not pages. A Featurebase changelog popup shows on load.
**My Room (home).** A 12-step "Get started" checklist (connect Hue / Home Assistant / Sonos / Yahoo fantasy; create a scoreboard; create an Action; set up audio; **Test it**; verify email; schedule a game; tweak settings; discover products), each with Skip. Then **Your teams** (team tile + *Auto-schedule* toggle + Delete, "Add a Team"), **Current games** as **numbered slots 1-5** (a game card per slot, "You are in Test Mode" badge), Balance (pay-per-game credits) / Subscription / Game Log, and a **Manage** row: *Go Live* vs *Test* ("send a test to your room"). Billing model is per-game credits or subscription; Homeroom has none.
**Calendar drawer.** Day-by-day (prev/next arrows, date heading) list of game cards (both logos, "A VS B", local time, sport); picking a game puts it in a slot. A gear opens **Calendar Settings**: hundreds of leagues grouped by sport, each with a toggle and a per-sport "Toggle All". (Ours: 7 day tabs + league chips for 9 leagues; sync toggle per game.)
**Teams.** Sport (Hockey, Basketball, Soccer, Football, Baseball, Racing, Golf, Fighting) → league → team. Followed teams **auto-schedule** their games.
**Settings.** Delay → "Edit delay" opens an **Anti Spoiler drawer**: choose a *reference game*; a live **Current Game Clock** to compare against the TV clock ("keep this clock **on or behind** your TV; you may let it run **up to 5 s ahead** for faster triggers; if it is far behind, pause your stream"); an **Assisted Delay (beta)** wizard; and a plain numeric *Anti Spoiler Delay* (seconds). Also: Language (en/fr/de); **My team only** (only trigger when *my* team scores; scheduled games with none of my teams do nothing); **Disable automations** (only trigger via Buttons; delay still applies to scoreboards).
**Actions.** List filtered by Triggers / Sports / Teams. *New Action* form: **Name · Sports (Edit, default ANY) · Triggers (Edit, default NONE) · Teams (ANY / add team) · Devices (Add Devices +) · Audio (enable; "overrides any other sound") · Video (paid) · Text (custom text animation on scoreboards/Scroll)**.
**Trigger vocabulary (27):** GOAL, HOMERUN, RUN, TOUCHDOWN, FIELD GOAL, 1ST DOWN (OFFENSE), 3RD DOWN (DEFENSE), BASKET, BASKET-2PTS, BASKET-3PTS, BASKET-FREE THROW, POWERPLAY, STRIKEOUT,
WALKOUTS, GREEN FLAG, CAUTION FLAG, RED FLAG, CHECKERED FLAG, YELLOW CARD, RED CARD, DRAFT-TEAM READY, DRAFT-PLAYER PICKED, WIN, PERIOD START, PERIOD END, GAME START, GAME END.
Only five of these (goal, game_start/end, period_start/end) cross the wire to the HA integration; the rest are cloud-side rules that end in `execute.<entity>` commands (§1.5).
**Buttons.** Manual triggers (Goal, Powerplay, Win, custom), bindable to a key or a physical button, with an API-access panel. "It triggers automatically if you don't." **Capture:** pick an HDMI capture device. **Webhooks / API Keys:** gated on this tier.

**Gap analysis vs Homeroom (candidates, in rough value order):**
1. *Delay calibration aid:* reference-game picker + live "current game clock" (as seen after delay) to compare with the TV; "on or behind" guidance. (Ours: slider only.)
2. *My team only* global switch, alongside per-action team scope.
3. *Finer triggers:* TOUCHDOWN / FIELD GOAL / 2PT-3PT-FT / HOMERUN vs RUN / POWERPLAY / cards as selectable action triggers. Cheap: `scoring.label` and `scoring.delta` already exist on every goal event; only action filtering and (for cards, powerplay) extra detection are missing.
4. *Manual trigger buttons* for any event type (ours: Test Goal only), with an HTTP endpoint for Stream Deck / physical buttons.
5. *Auto-schedule followed teams* (ours: "Sync all followed teams" is a manual click).
6. Per-action audio override, custom text, per-horn volume/fade (none built).
7. Compact scoreboard plate for a secondary screen (§6.0).

### 6.0c Paywalled TV views, reconstructed from the vendor's own public marketing images (kept locally as `docs/research/ref-*.png`, git-ignored; used as visual reference only)
* **Break screens (4, 16:9 renders with fictional teams):** *Players to watch* (two halves in team colours, headshot, big surname, 4 stat tiles G/A/PTS/SOG, "points per game" bars for the last 5 games vs opponents), *Recent form* (two tall team panels with big circular badge + last-5 W/L chips + goals for/against bars per opponent; centre column of mirrored comparison bars: goals for, goals against, shots, power play %, penalty kill %, the better value highlighted white, the other grey), *Game stats* ("END OF 2ND PERIOD", team-colour score banners left/right, line score, mirrored bars for shots/hits/faceoffs/power play/takeaways/giveaways/penalty minutes), *Game summary* (title + final score pill; columns per period with "N GOALS" headers; goal cards in the scoring team's colour: running score, time, scorer in large caps, PP/EN tag, assists, "Unassisted"). Portrait variants exist.
* **Scoreboard (real OS screenshot):** the screen is a **multi-pane layout**: left pane = large **triangular split** of the two team colours with logos and giant scores, a big HH:MM:SS countdown pre-game, "Record W-L" plates; right pane = team-stat comparison bars (field goals, 3 points, free throws, rebounds, assists, steals, blocks) and "Last 10 Games" W/L chips with opponent logos; bottom = an **"UPCOMING" strip** of game cards in team colours with date/time, over a second strip (stocks, optional).
* **Screen configuration:** per screen a name ("TV Left"), **Single / Multiple** mode, one of **15 pane layout presets** (2x2, halves, thirds, main+sidebar, main+bottom bar, etc.), **orientation** (landscape / portrait), and a league list (NHL, AHL, NBA, NFL, MLB…) each with a *Customize* button.
* **LED ticker ("Scroll"):** NOT monochrome. Full-colour LED matrix: each game is two **stacked team-colour bars** (name + logo + score, white-on-colour), followed by large white date/time text, interleaved with finance-style quote strips.
Implications for Homeroom: our `/ticker` should be full-colour team bars (current amber look is wrong); a pane-layout system for `/scoreboard`; pre-game screens need ESPN team-schedule and athlete game-log data (not yet wired).

### 6.1 Control dashboard (`/`)
7-day calendar (day tabs → league filter → game rows with sync toggle; "sync all of team X"); stream-delay slider (0–120, step 0.5, number input, live preview of
"events fire N s after the play"); Test Goal button; HA connection (URL/token/test); horn manager; device/action editor.

### 6.2 `/scoreboard?game=<id>|auto` — state machine
`idle` (no synced game: next-game countdown) → `pregame` (break screens rotate: players, form) → `live` (score, clock, period, team-colour gradient) →
`goal` overlay (full-screen "GOAL / TOUCHDOWN!" ≈ 6 s, team colours, scorer, new score; queued if another arrives) → `live` → `intermission`
(game stats ↔ summary break screens, 15 s each) → `live` … → `final` (summary, then idle after 10 min). Transitions are driven by **delayed** WS events only.

### 6.3 `/grid` — up to `?max=` cards (default 8, max 12; auto columns, landscape/portrait) sorted live → upcoming → final; goal pulse on the card.
If ≤ max games are live they are shown with the next-up games on one page. If more are live than fit, or nothing is live, it pages through the slate every `?rotate=` s (default 12) with page dots. 
### 6.4 `/ticker` — single-row LED-matrix style scroll (dot-matrix font, amber on black, `ABB 2 – 1 ABB  2nd 8:42  •`), goal flash.

---

## 7. Packaging / ops
Docker Compose: one `homeroom` container (Node 22; serves API, Pusher WS, static web build on `:8080`), volumes `./data` (SQLite `homeroom.db`, config)
and `./media` (horns). Env: `PUBLIC_BASE_URL`, `PUSHER_APP_KEY`, `PUSHER_APP_SECRET`, `ADMIN_TOKEN`, `TZ`.
`scripts/fetch-horns.mjs` reads a user-supplied `horns.manifest.json` (team → URL **or local file path**); validates MP3 + size; rejects bad names.
No horn audio is bundled and no source URLs are baked in: I could not find a legitimate, verifiable public pack (the one fan site found now redirects to an unrelated domain).
Drop files into `media/horns/<league>/<ABBR>.mp3` (read from disk, no restart), upload in the UI, or run `scripts/make-default-horn.sh` (needs ffmpeg) for a synthetic fallback.

## 8. Non-goals / known limits
Pre-game "Players to watch" and "Recent form" break screens are **not built**: they need player/form data that the free providers' scoreboard feeds don't carry in our `Game` model.
Intermission "Game stats"/"Game summary" and a pre-game countdown screen are built.
No betting/fantasy/player trackers, no cloud accounts, no OTA. ESPN/NHL endpoints are unofficial and can change. ESPN data is not sub-second; only NHL
goals get fast detection. Delay queue is volatile across restarts.
