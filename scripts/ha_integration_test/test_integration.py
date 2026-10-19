"""Drive the patched upstream integration inside a real (headless) Home Assistant core against a real Homeroom.

A trigger fired on Homeroom travels: engine -> dispatcher -> Pusher bridge -> the integration's real pysher client
-> real integration code -> `hass` service calls on mocked entities + the `connectedroom_event` bus event.
"""
import asyncio
import json
import time

import httpx
import pytest
from homeassistant.const import STATE_IDLE, STATE_PLAYING
from homeassistant.helpers import instance_id
from pytest_homeassistant_custom_component.common import MockConfigEntry, async_mock_service

pytestmark = [pytest.mark.enable_socket]

HORN = "media_player.horn"
LIGHT = "light.couch"


@pytest.fixture(autouse=True)
def _allow_loopback(socket_enabled):
    """pytest-socket blocks sockets by default; this test talks to a Homeroom on 127.0.0.1."""


async def wait_for(cond, timeout=10.0):
    end = time.monotonic() + timeout
    while time.monotonic() < end:
        if cond():
            return True
        await asyncio.sleep(0.05)
    return False


async def post(base, path, body=None):
    async with httpx.AsyncClient() as c:
        r = await c.post(base + path, json=body or {})
        r.raise_for_status()
        return r.json()


@pytest.fixture
async def room(hass, enable_custom_integrations, homeroom):
    # a real HA fills hass.data["core.uuid"] during bootstrap; the upstream integration reads that private key at login
    await instance_id.async_get(hass)
    assert "core.uuid" in hass.data
    hass.states.async_set(LIGHT, "off", {"supported_color_modes": ["rgb"]})
    hass.states.async_set(HORN, STATE_IDLE, {"media_content_id": ""})
    calls = {
        "play_media": async_mock_service(hass, "media_player", "play_media"),
        "light_on": async_mock_service(hass, "light", "turn_on"),
        "speak": async_mock_service(hass, "tts", "speak"),
    }
    events = []
    hass.bus.async_listen("connectedroom_event", lambda e: events.append(e.data))
    entry = MockConfigEntry(
        domain="connectedroom",
        data={"api_key": "local-test-key", "unique_id": "ignored-the-server-assigns-it"},
        options={
            "goal_horn_devices": [HORN],
            "tts_devices": [HORN],
            "tts_provider": "tts.home_assistant_cloud",
            "primary_lights": {"entity_id": [LIGHT]},
        },
    )
    entry.add_to_hass(hass)
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    # wait until the integration's pysher client is subscribed to its private channel on the server
    async with httpx.AsyncClient() as c:
        for _ in range(100):
            st = (await c.get(homeroom + "/api/status")).json()
            if any(l["events_connected"] for l in st["integration"]["links"]):
                break
            await asyncio.sleep(0.1)
        else:
            pytest.fail(f"integration never connected to Homeroom: {st}")
    yield {"base": homeroom, "calls": calls, "events": events, "entry": entry}
    await hass.config_entries.async_unload(entry.entry_id)
    await hass.async_block_till_done()


async def test_goal_reaches_real_integration_code(hass, room):
    base, calls, events = room["base"], room["calls"], room["events"]
    out = await post(base, "/api/trigger", {"trigger": "goal", "league": "nhl", "team_abbr": "MIN"})
    assert out["ok"]

    # `goal` -> bus event (automation trigger path)
    assert await wait_for(lambda: any(e["type"] == "goal" for e in events)), "no connectedroom_event for the goal"
    ev = next(e for e in events if e["type"] == "goal")
    payload = ev["payload"] if isinstance(ev["payload"], dict) else json.loads(ev["payload"])
    assert payload["type"] == "goal" and payload["team"]["abbr"] == "MIN"

    # team-colour lights
    assert await wait_for(lambda: calls["light_on"]), "no light.turn_on from the goal"
    assert calls["light_on"][0].data["rgb_color"] and len(calls["light_on"][0].data["rgb_color"]) == 3

    # `goal_horn` -> media_player.play_media on the configured horn device
    assert await wait_for(lambda: calls["play_media"]), "no media_player.play_media from goal_horn"
    pm = calls["play_media"][0].data
    assert pm["entity_id"] == HORN
    assert pm["media_content_id"].endswith("/media/horns/nhl/default.mp3")

    # TTS waits for the horn to finish: nothing yet, then the horn device goes playing -> idle
    assert not calls["speak"]
    hass.states.async_set(HORN, STATE_PLAYING, {"media_content_id": pm["media_content_id"]})
    await hass.async_block_till_done()
    hass.states.async_set(HORN, STATE_IDLE, {"media_content_id": pm["media_content_id"]})
    assert await wait_for(lambda: calls["speak"], timeout=8), "no tts.speak after the horn finished"
    spoken = calls["speak"][0].data
    assert spoken["media_player_entity_id"] == HORN and spoken["entity_id"] == "tts.home_assistant_cloud"
    assert "MIN" in spoken["message"] or "goal" in spoken["message"].lower() or spoken["message"]


async def test_other_pusher_events_fire_bus_events(hass, room):
    base, events = room["base"], room["events"]
    for trig, typ in [("game_start", "game_start"), ("period_end", "period_end"), ("game_end", "game_end")]:
        await post(base, "/api/trigger", {"trigger": trig, "league": "nhl"})
        assert await wait_for(lambda: any(e["type"] == typ for e in events)), f"no bus event for {typ}"


async def test_only_the_five_contract_events_exist(hass, room):
    """The integration contract is fixed (SPEC section 1): nothing but goal/game_start/game_end/period_* may arrive."""
    base, events = room["base"], room["events"]
    await post(base, "/api/trigger", {"trigger": "game_end", "league": "nhl"})
    assert await wait_for(lambda: any(e["type"] == "game_end" for e in events))
    assert {e["type"] for e in events} <= {"goal", "game_start", "game_end", "period_start", "period_end"}
