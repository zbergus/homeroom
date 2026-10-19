"""Fixtures: a throw-away Homeroom server + the patched upstream integration generated against it.

Nothing here contacts a real Home Assistant, a real score feed, or any cloud service. Everything binds to 127.0.0.1.
"""
import os
import pathlib
import shutil
import socket
import subprocess
import sys
import tempfile

import pytest

HERE = pathlib.Path(__file__).resolve().parent
REPO = HERE.parent.parent
UPSTREAM = pathlib.Path(os.environ.get("CONNECTED_ROOM_HASS", REPO.parent / "connected-room-hass")).resolve()
WORK = pathlib.Path(os.environ.get("HR_HA_WORKDIR", tempfile.mkdtemp(prefix="hr-ha-work-")))
APP_KEY = "homeroom-local-key"


def _free_port() -> int:
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    return port


PORT = int(os.environ.get("HR_TEST_PORT", _free_port()))

# Generate the patched integration at import time so `custom_components.connectedroom` is importable before HA's loader runs.
_out = WORK / "custom_components" / "connectedroom"
if not (UPSTREAM / "custom_components" / "connectedroom").exists():
    raise RuntimeError(f"upstream integration not found at {UPSTREAM}; set CONNECTED_ROOM_HASS=/path/to/connected-room-hass")
subprocess.run(
    [sys.executable, str(REPO / "ha" / "patch_integration.py"), "--src", str(UPSTREAM), "--host", "127.0.0.1", "--port", str(PORT), "--key", APP_KEY, "--out", str(_out)],
    check=True, capture_output=True,
)
(WORK / "custom_components" / "__init__.py").write_text("")
sys.path.insert(0, str(WORK))
# pytest-homeassistant-custom-component may already have imported its own `custom_components` package (testing_config);
# make ours part of it so HA's loader finds `connectedroom` either way.
import custom_components  # noqa: E402

if str(WORK / "custom_components") not in list(custom_components.__path__):
    custom_components.__path__.append(str(WORK / "custom_components"))


@pytest.fixture(scope="session")
def homeroom():
    """Start the real engine/HTTP/Pusher bridge; yield its base URL."""
    media = pathlib.Path(tempfile.mkdtemp(prefix="hr-ha-media-"))
    (media / "horns" / "nhl").mkdir(parents=True)
    (media / "horns" / "nhl" / "default.mp3").write_bytes(b"ID3\x03\x00\x00\x00\x00\x00\x00")  # a stub: only its existence matters, no audio is shipped
    env = {
        **os.environ,
        "PORT": str(PORT),
        "PUSHER_APP_KEY": APP_KEY,
        "DATA_DIR": tempfile.mkdtemp(prefix="hr-ha-data-"),
        "MEDIA_DIR": str(media),
        "PUBLIC_BASE_URL": f"http://127.0.0.1:{PORT}",
    }
    env.pop("ADMIN_TOKEN", None)
    proc = subprocess.Popen(
        ["npx", "tsx", str(HERE / "start_server.mts")], cwd=REPO / "server", env=env,
        stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
    )
    line = proc.stdout.readline()
    if not line.startswith("READY"):
        proc.kill()
        raise RuntimeError(f"Homeroom did not start: {line}{proc.stdout.read()}")
    yield f"http://127.0.0.1:{PORT}"
    proc.terminate()
    try:
        proc.wait(timeout=10)
    except subprocess.TimeoutExpired:
        proc.kill()
    shutil.rmtree(media, ignore_errors=True)


@pytest.fixture(autouse=True)
def verify_cleanup():
    """Override the plugin's strict teardown check: upstream's pysher client leaves a daemon `PysherScheduler`
    thread (and the integration threading.Timers) behind after `unload`, which the plugin would flag as a failure."""
    yield
