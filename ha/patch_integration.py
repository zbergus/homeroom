#!/usr/bin/env python3
"""Generate a copy of the upstream `connectedroom` Home Assistant integration that talks to Homeroom.

Usage:
  python3 ha/patch_integration.py --src ../connected-room-hass --host 192.168.1.10 --port 8080 \
      --key homeroom-local-key [--tls] [--out ha/custom_components/connectedroom]

Then copy the output folder into <HA config>/custom_components/connectedroom, restart Home Assistant,
add the "ConnectedRoom" integration and enter ANY API key (it just identifies your install).

Changes made (each is asserted, so an upstream change that breaks a patch fails loudly):
  const.py          API_URL / WSS_HOST / WSS_KEY point at Homeroom; new WSS_SECURE / WSS_PORT
  connectedroom.py  pysher.Pusher gets secure=/port=; fixes upstream AttributeError on
                    `data.already_triggered_from_score_change` (attribute access on a dict)
"""
import argparse
import pathlib
import re
import shutil
import sys


def sub_once(text: str, old: str, new: str, what: str) -> str:
    if text.count(old) != 1:
        sys.exit(f"patch failed: expected exactly one occurrence of {what!r}, found {text.count(old)} (upstream changed?)")
    return text.replace(old, new)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", required=True, help="path to the cloned connected-room-hass repo")
    ap.add_argument("--host", required=True, help="hostname/IP of the machine running Homeroom, reachable from Home Assistant")
    ap.add_argument("--port", type=int, default=8080)
    ap.add_argument("--key", default="homeroom-local-key", help="must equal PUSHER_APP_KEY of the server")
    ap.add_argument("--tls", action="store_true", help="Homeroom is behind HTTPS/WSS (reverse proxy)")
    ap.add_argument("--out", default=str(pathlib.Path(__file__).parent / "custom_components" / "connectedroom"))
    a = ap.parse_args()

    src = pathlib.Path(a.src) / "custom_components" / "connectedroom"
    if not (src / "connectedroom.py").exists():
        sys.exit(f"{src}/connectedroom.py not found")
    out = pathlib.Path(a.out)
    if out.exists():
        shutil.rmtree(out)
    shutil.copytree(src, out, ignore=shutil.ignore_patterns("__pycache__"))
    lic = pathlib.Path(a.src) / "LICENSE"
    if lic.exists():
        shutil.copy(lic, out / "LICENSE.upstream")

    scheme = "https" if a.tls else "http"
    default_port = 443 if a.tls else 80
    api = f"{scheme}://{a.host}" + ("" if a.port == default_port else f":{a.port}")

    const = (out / "const.py").read_text()
    const = sub_once(const, 'API_URL = "https://api.connectedroom.io"', f'API_URL = "{api}"', "API_URL")
    const = sub_once(const, 'WSS_HOST = "ws.connectedroom.io"', f'WSS_HOST = "{a.host}"\nWSS_PORT = {a.port}\nWSS_SECURE = {a.tls}', "WSS_HOST")
    const = re.sub(r'WSS_KEY = "[^"]*"', f'WSS_KEY = "{a.key}"', const, count=1)
    (out / "const.py").write_text(const)

    cr = (out / "connectedroom.py").read_text()
    cr = sub_once(cr, "from .const import WSS_HOST\n", "from .const import WSS_HOST\nfrom .const import WSS_PORT\nfrom .const import WSS_SECURE\n", "WSS_HOST import")
    cr = sub_once(cr, "            custom_host=WSS_HOST,\n", "            custom_host=WSS_HOST,\n            secure=WSS_SECURE,\n            port=WSS_PORT,\n", "custom_host kwarg")
    cr = sub_once(
        cr,
        '''if (
            "already_triggered_from_score_change" not in data
            or data.already_triggered_from_score_change is not True
        ):''',
        '''if data.get("already_triggered_from_score_change") is not True:''',
        "already_triggered_from_score_change check",
    )
    (out / "connectedroom.py").write_text(cr)

    mf = (out / "manifest.json").read_text()
    mf = mf.replace('"name": "ConnectedRoom"', '"name": "ConnectedRoom (Homeroom local)"', 1)
    (out / "manifest.json").write_text(mf)

    print(f"wrote {out}\n  API_URL={api}\n  websocket={'wss' if a.tls else 'ws'}://{a.host}:{a.port}/app/{a.key}")


if __name__ == "__main__":
    main()
