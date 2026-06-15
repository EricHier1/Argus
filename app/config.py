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
DETECT_INTERVAL = float(_env("DETECT_INTERVAL", "0.3"))  # seconds between detections (throttle)
SNAPSHOT_INTERVAL = float(_env("SNAPSHOT_INTERVAL", "2.0"))  # min seconds between saved frame snapshots

# --- Server ----------------------------------------------------------------
HOST = _env("HOST", "0.0.0.0")   # 0.0.0.0 = reachable from your phone on the same wifi
PORT = int(_env("PORT", "8000"))

# --- Alerts ----------------------------------------------------------------
ALERT_COOLDOWN = float(_env("ALERT_COOLDOWN", "30"))  # seconds before the same rule can fire again


def source_value():
    """Return SOURCE as an int if it looks like a camera index, else the raw string (URL)."""
    s = str(SOURCE)
    return int(s) if s.isdigit() else s
