#!/usr/bin/env python3
"""End-to-end check with the *real* pysher client, exactly as the Home Assistant integration uses it.

  python3 -m venv .venv && .venv/bin/pip install pysher==1.0.8 httpx
  .venv/bin/python scripts/e2e_pysher.py [--base http://127.0.0.1:8080] [--key homeroom-local-key]

Needs a running Homeroom. It links, syncs a fake light, configures a temporary action, fires a manual
touchdown and asserts: `goal` then `goal_horn` is NOT required (no horn file), `get_state` -> `execute`
(alternate) -> `restore`, in that order. It overwrites light actions on the target server.
"""
import argparse, json, logging, os, sys, time
from urllib.parse import urlparse

import httpx
import pysher

ap = argparse.ArgumentParser()
ap.add_argument("--base", default="http://127.0.0.1:8080")
ap.add_argument("--key", default="homeroom-local-key", help="PUSHER_APP_KEY of the server")
ap.add_argument("--token", default=os.environ.get("ADMIN_TOKEN"), help="ADMIN_TOKEN if required by the server")
a = ap.parse_args()
BASE = a.base.rstrip("/")
u = urlparse(BASE)
H = {"Authorization": "Bearer e2e-test-key", "Accept": "application/json"}
admin_h = {"Accept": "application/json"}
if a.token:
    admin_h["Authorization"] = f"Bearer {a.token}"

# Backup existing light actions to restore when finished
existing_resp = httpx.get(BASE + "/api/actions", headers=admin_h)
existing_actions = existing_resp.json() if existing_resp.status_code == 200 else None

link = httpx.post(BASE + "/integrations/home-assistant/link", data={"home_assistant_id": "e2e", "home_assistant_integration_version": "1.1.1"}, headers=H).json()
assert link["success"], link
dev = {"entity_id": "light.e2e", "capabilities": {"supported_color_modes": ["hs"]}, "device_class": "light", "name": "E2E", "supports_flash_speed": True, "supports_flash_duration": True, "supports_alternate_speed": True, "supports_alternate_duration": True}
assert httpx.post(BASE + "/integrations/home-assistant/devices/sync", json={"devices": [dev]}, headers=H).json()["success"]

got = []
p = pysher.Pusher(key=a.key, custom_host=u.hostname, port=u.port or (443 if u.scheme == "https" else 80), secure=u.scheme == "https",
                  auth_endpoint=BASE + "/auth/websockets", auth_endpoint_headers={"x-websocket-key": link["websocket_key"]},
                  reconnect_interval=15, log_level=logging.CRITICAL)

def on_conn(_):
    ch = p.subscribe("private-" + link["unique_id"])
    for ev in ("goal", "goal_horn", "period_start", "period_end", "game_start", "game_end"):
        ch.bind(ev, lambda data, ev=ev, **k: got.append((ev, json.loads(data))))
    dch = p.subscribe("private-home-assistant." + link["integration_key"])
    dch.bind("get_state.light.e2e", lambda data, **k: (got.append(("get_state", json.loads(data))), reply(json.loads(data))))
    dch.bind("execute.light.e2e", lambda data, **k: got.append(("execute", json.loads(data))))

def reply(d):
    httpx.post(BASE + "/requests/execute", json={"scope": "home-assistant." + link["integration_key"], "payload": json.dumps({"brightness": 200, "color_mode": "hs", "hs_color": [10, 50]}), "request_id": d["request_id"]}, headers=H)

p.connection.bind("pusher:connection_established", on_conn)
p.connect()
time.sleep(2)

try:
    httpx.put(BASE + "/api/actions", json=[{"id": "e2e", "enabled": True, "triggers": ["touchdown"], "team_scope": "any", "entities": ["light.e2e"], "effect": "alternate", "duration": 1, "speed": 5, "colors": "team", "restore": True}], headers=admin_h)
    httpx.post(BASE + "/api/trigger", json={"trigger": "touchdown"}, headers=admin_h)
    time.sleep(3.5)
    names = [n for n, _ in got]
    print(names)
    goal = next(d for n, d in got if n == "goal")
    assert goal["scoring"]["label"] == "TOUCHDOWN" and goal["natural_text"] and "already_triggered_from_score_change" not in goal
    assert names[0] == "goal", names
    assert names.index("get_state") < names.index("execute"), names
    execs = [d for n, d in got if n == "execute"]
    assert execs[0]["action"] == "alternate" and execs[-1]["action"] == "restore", execs
    print("E2E OK")
finally:
    p.disconnect()
    if isinstance(existing_actions, list):
        httpx.put(BASE + "/api/actions", json=existing_actions, headers=admin_h)
