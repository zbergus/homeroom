# Home Assistant setup

Homeroom does not talk to lights, speakers or TTS engines itself; Home Assistant (HA) does. There are two ways to connect, and for **lights you should pick one**.

| Path | What it is | Use it for |
|---|---|---|
| **Integration (drop-in, recommended)** | The upstream `connectedroom` custom integration, patched to point at Homeroom (3 constants). HA fires its own `connectedroom_event`, speaks the TTS, plays the goal horn, and Homeroom's light rules command the lights through it. | Lights, horn, TTS with the least HA configuration |
| **REST events (optional)** | Homeroom posts `connectedroom_goal`, `…_game_start`, `…_game_end`, `…_period_start`, `…_period_end`, `…_goal_overturned` to HA's event API with flat fields (`team_color_rgb`, `tts_message`, `goal_horn_url`, `label`, `trigger`, `winner`, …). You write HA automations. | Scenes, plugs, notifications, anything the integration can't do |

Running both and driving the same lights from both makes them fire twice (`GET /api/status` warns).

## 1. Install the patched integration
```bash
python3 ha/patch_integration.py --src ../connected-room-hass --host <LAN IP of the Homeroom machine> --port 8080 --key <PUSHER_APP_KEY>
```
- `--src` is a clone of the upstream integration repo (MIT). The script copies it to `ha/custom_components/connectedroom` (git-ignored), sets `API_URL`/`WSS_HOST`/`WSS_PORT`/`WSS_KEY`, passes `secure=`/`port=` to pysher, and fixes an upstream crash on `data.already_triggered_from_score_change`. Add `--tls` if Homeroom is behind HTTPS/WSS.
- `--key` must equal the server's `PUSHER_APP_KEY` (default `homeroom-local-key`).
- Copy the folder into `<HA config>/custom_components/connectedroom` (or add it as a HACS custom repository), restart HA, add **ConnectedRoom**, and enter **any** API key (it only identifies the install).
- In the integration's options pick the lights/switches to expose (they appear under *Devices & light actions* in Homeroom), the TTS player(s) or TTS entity, and the **goal-horn media player(s)**.

## 2. Make the horn work
- `PUBLIC_BASE_URL` must be an address **HA and the speaker** can reach (`http://<LAN IP>:8080`), never `localhost`. Cast speakers fetch the MP3 themselves.
- No horn audio ships with Homeroom. Upload MP3s per team (or a league default) in the dashboard, drop them in `media/horns/<league>/<ABBR>.mp3`, or bulk-import with `scripts/fetch-horns.mjs`. Without a file for the scoring team **and** a `default.mp3`, no `goal_horn` is sent: lights and TTS still work.
- `horn_scope`: `favorites` (default; horn only for your favourite team's goals when one is in the game, otherwise both), `all` (both teams) or `home` (home team only; ConnectedRoom's "Home Team").
- **Long horns delay the announcement.** The integration speaks the TTS only after the horn has finished playing, so a 55 s horn means a 55 s wait. Homeroom therefore caps horn length (`horn_max_s`, default 30 s, empty = no limit) and fades the cut (`horn_fade_ms`, 1500) and can even out loudness (`horn_normalize`). Fade and loudness need ffmpeg (the Docker image has it); without it horns are cut abruptly. The integration is unchanged: it just receives a shorter `goal_horn` URL target. Details: [`HORNS.md`](HORNS.md#length-fade-and-loudness).

## 3. Light actions
Dashboard → Alerts → Triggers & light actions. Each action: triggers (any score, goal, touchdown, 3-pointer, win, period end…), team scope, entities, effect (flash, alternate team colours, set colour, or a light's built-in effect), duration/speed, restore previous state.
- **White-only bulbs** (only `color_temp`/`brightness`) and switches cannot show colours; Homeroom flashes them instead of alternating.
- A built-in effect (e.g. a Hue "candle") must appear in the light's `effect_list`; otherwise it flashes. On restore, if the light has a "None/Off" effect that is named, so a built-in effect stops.
- Flash rate is limited by each device's HA integration (cloud-throttled bulbs cannot flash fast; the integration slows down automatically for groups).

## 4. REST path details
Dashboard → Setup → Home Assistant: URL + long-lived access token (write-only; never returned by the API) + "Fire REST events". Events are `POST {url}/api/events/connectedroom_<type>`. Example automation trigger: `platform: event, event_type: connectedroom_goal, event_data: { label: TOUCHDOWN }`.

## 5. Manual triggers (Stream Deck, buttons, HA scripts)
`POST /api/trigger {"trigger":"touchdown","team_abbr":"KC"}` or `GET /api/hook/touchdown?team=KC&token=…` (token only when `ADMIN_TOKEN` is set). Manual triggers bypass *My team only* / *Disable automations* and are immediate unless `apply_delay`/`delay=1`. From HA: a `rest_command` calling the GET hook.

## 6. Post-deploy checklist (run by a human)
1. `GET /api/status`: the integration link shows **connected** (events and devices) and no red warnings.
2. Dashboard → Alerts → Buttons → *Test Goal Alert*: the chosen light flashes and the horn plays on the horn player; TTS speaks.
3. `python3 scripts/e2e_pysher.py --base http://<host>:8080 --key <PUSHER_APP_KEY>` passes against the deployed instance (it overwrites light actions; run it before configuring real ones).
4. Optional, no hardware needed: `scripts/ha_integration_test/` runs the patched integration inside a real Home Assistant core against a throw-away Homeroom (see its README). It passes today (HA 2026.10.2); it is a simulated core, not your install.
5. During a real game: *Alerts → Calibrate* with the clock on your TV, set the delay, then watch `GET /api/events/recent` for outcomes.

## This install, as surveyed (read-only, 2026-10-19; **not verified by Homeroom**)
A read-only survey of the user's HA (2026.10.x) reported: 7 Philips Hue lights, all flash-capable, most colour-temperature only (so they flash white, not team colours) and two driveway lights with built-in effects; a Cast speaker entity intended as the goal-horn player; Google TTS engines; HACS installed; the `connectedroom` integration **not installed yet**; no sports sensors or light groups. Nothing has been tested against these devices; the patched integration has never run inside this HA. Do not claim otherwise in docs or reports. (Never record the access token used for that survey.)
