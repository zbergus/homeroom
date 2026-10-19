# Headless Home Assistant integration test

Runs the **patched upstream ConnectedRoom integration inside a real Home Assistant core** (via
`pytest-homeassistant-custom-component`, no HA install, UI or devices needed) against a **real Homeroom** instance, and
asserts what the integration does with a fired trigger:

| Homeroom fires | Integration (real upstream code) does | Asserted |
| --- | --- | --- |
| `goal` | fires `connectedroom_event` on the HA bus, `light.turn_on` with the team colour on `primary_lights` | yes |
| `goal_horn` (follows `goal`) | `media_player.play_media` of the horn URL on `goal_horn_devices` | yes |
| horn device `playing -> idle` | `tts.speak` (after the horn, as designed) | yes |
| `game_start` / `period_end` / `game_end` | `connectedroom_event` | yes |

It exercises login (`/integrations/home-assistant/link`), the real `pysher` websocket client, the private-channel auth
(`/auth/websockets`), and the Pusher event framing. It does not exercise the device sync / `get_state` / `execute`
path used by Homeroom's own light rules (that is covered by `server/test/app.test.ts` and `scripts/e2e_pysher.py`).

Nothing contacts a real Home Assistant, a score feed (the throw-away server runs with the poller off) or any cloud:
everything binds to 127.0.0.1 and uses throw-away temp dirs. No tokens are involved.

## Run

```bash
cd server && npm install && cd ..                      # the test starts the TypeScript server with tsx
uv venv --python 3.14 /tmp/hr-ha/venv                  # any Python that current Home Assistant supports (3.13/3.14)
uv pip install --python /tmp/hr-ha/venv/bin/python -r scripts/ha_integration_test/requirements.txt
cd scripts/ha_integration_test
CONNECTED_ROOM_HASS=../../../connected-room-hass /tmp/hr-ha/venv/bin/python -m pytest -q
```

`CONNECTED_ROOM_HASS` is the path to your clone of the upstream `connected-room-hass` repo (default: a sibling of this repo).
The patched copy is generated into a temp dir on every run with `ha/patch_integration.py` (set `HR_HA_WORKDIR` to keep it),
so an upstream change that breaks a patch fails here loudly. `HR_TEST_PORT` pins the server port.

Verified on 2026-10-19: Python 3.14.8, Home Assistant 2026.10.2, pysher 1.0.8, upstream integration 1.1.1: 3 passed in ~2 s.

## Findings and caveats

- Upstream pins `pytest-homeassistant-custom-component==0.12.49` in its own requirements; that is ancient. Use the newest.
- The upstream login reads the private key `hass.data["core.uuid"]`. A real HA fills it at bootstrap; the test fixture calls
  `homeassistant.helpers.instance_id.async_get` to do the same. If a future HA stops populating it, the integration's login
  raises `KeyError` inside a background task and **silently never connects**. That is a latent upstream fragility, not a Homeroom bug.
- `conftest.py` overrides the plugin's strict `verify_cleanup` fixture: upstream's pysher client leaves a daemon
  `PysherScheduler` thread behind on unload.
- The plugin ships its own `custom_components` package; `conftest.py` appends the generated one to its `__path__`.
- This is still a fake HA core: real entities, real integrations for lights/media players, real tts engines and a real
  Home Assistant `config_flow` UI are not involved (the config entry is created directly).
