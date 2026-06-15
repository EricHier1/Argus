"""Central configuration. Override any value with an environment variable
(prefix ARGUS_), e.g. ARGUS_SOURCE=1 to use a second camera."""
import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BASE_DIR / "data"
SNAPSHOT_DIR = DATA_DIR / "snapshots"
DB_PATH = DATA_DIR / "argus.db"
WEB_DIR = BASE_DIR / "web"


def _env(name: str, default):
    # ARGUS_ is the current prefix; CVISION_ kept as a fallback for older configs.
    return os.environ.get(f"ARGUS_{name}", os.environ.get(f"CVISION_{name}", default))


# --- Camera source ---------------------------------------------------------
# An integer (0 = default built-in/USB cam, 1 = next camera, ...) OR a URL
# string for an IP/phone camera (e.g. "http://192.168.1.50:4747/video").
SOURCE = _env("SOURCE", "0")

# --- Detection -------------------------------------------------------------
MODEL = _env("MODEL", "yolo11n.pt")          # 'n' = nano (fast). Try yolo11s.pt for more accuracy.
CONFIDENCE = float(_env("CONFIDENCE", "0.45"))  # minimum confidence to record a detection
# Seconds between detections. 0 = detect every frame, which keeps the drawn boxes
# perfectly aligned with the live image (raise it to trade alignment for less load).
DETECT_INTERVAL = float(_env("DETECT_INTERVAL", "0.0"))
SNAPSHOT_INTERVAL = float(_env("SNAPSHOT_INTERVAL", "2.0"))  # min seconds between saved frame snapshots
# Adaptive snapshot cadence for an object that lingers in frame:
#   first PERSIST_INTERVAL seconds apart, then slower the longer it stays.
PERSIST_INTERVAL = float(_env("PERSIST_INTERVAL", "2.0"))   # 0–1 min: every 2s
DWELL_TIER_1 = float(_env("DWELL_TIER_1", "60"))            # after 1 min -> 1/min
DWELL_TIER_2 = float(_env("DWELL_TIER_2", "600"))           # after 10 min -> 1/hour
DWELL_TIER_3 = float(_env("DWELL_TIER_3", "3600"))          # after 1 hour -> stop logging
# If a track isn't seen for this long it's considered to have left; re-entry
# restarts its cadence from the top.
LEAVE_GAP = float(_env("LEAVE_GAP", "60"))

# Inference device: 'auto' picks Apple GPU (mps) / NVIDIA (cuda) if available, else cpu.
DEVICE = _env("DEVICE", "auto")
# Object tracking: assigns a stable ID per object so it's logged once per appearance
# (not every frame). Set ARGUS_TRACK=0 to disable.
TRACK = str(_env("TRACK", "1")).lower() not in ("0", "false", "no")

# --- Cameras ---------------------------------------------------------------
# One or more sources, comma-separated. Each is a camera index (0,1,…) or a
# stream URL. Defaults to the single SOURCE above.
SOURCES = [s.strip() for s in str(_env("SOURCES", SOURCE)).split(",") if s.strip()]

# --- Server ----------------------------------------------------------------
# How the server is exposed:
#   lan       - 0.0.0.0, reachable by anything on your wifi (self-signed cert) [home mode]
#   local     - 127.0.0.1 only, this computer (self-signed cert)
#   tailscale - bound to the Tailscale IP only (trusted cert, works over cell,
#               NOT exposed on wifi)
BIND = _env("BIND", "lan").lower()
HOST = _env("HOST", "")          # explicit override of the bind address (advanced)
PORT = int(_env("PORT", "8000"))
# Serve over HTTPS with a self-signed cert (browsers warn once). ARGUS_HTTPS=0 for http.
HTTPS = str(_env("HTTPS", "1")).lower() not in ("0", "false", "no")

# --- Alerts ----------------------------------------------------------------
ALERT_COOLDOWN = float(_env("ALERT_COOLDOWN", "30"))  # seconds before the same rule can fire again


def source_value():
    """Return SOURCE as an int if it looks like a camera index, else the raw string (URL)."""
    s = str(SOURCE)
    return int(s) if s.isdigit() else s
