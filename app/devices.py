"""Enumerate available video input devices, cross-platform.

- macOS: `system_profiler` (no camera is opened, so it won't fight the running
  capture thread). Order maps to OpenCV's AVFoundation indices 0, 1, 2…
- Linux (incl. Raspberry Pi / RHEL / Rocky): read /dev/video* and their names
  from /sys/class/video4linux. The N in videoN maps to OpenCV's V4L2 index.
- Other platforms: empty list (the UI falls back to manual index/URL entry).
"""
import glob
import json
import subprocess
import sys


def list_cameras():
    """Return [{'index': int, 'name': str}, …]. Empty list on any failure."""
    try:
        if sys.platform == "darwin":
            return _macos()
        if sys.platform.startswith("linux"):
            return _linux()
    except Exception:
        pass
    return []


def _macos():
    out = subprocess.run(
        ["system_profiler", "SPCameraDataType", "-json"],
        capture_output=True, text=True, timeout=8,
    )
    data = json.loads(out.stdout or "{}")
    cams = data.get("SPCameraDataType", [])
    return [{"index": i, "name": c.get("_name", f"Camera {i}")}
            for i, c in enumerate(cams)]


def _linux():
    cams = []
    seen_names = set()
    for path in sorted(glob.glob("/dev/video*"),
                       key=lambda p: int("".join(filter(str.isdigit, p)) or 0)):
        digits = "".join(filter(str.isdigit, path))
        if not digits:
            continue
        idx = int(digits)
        name = f"Camera {idx}"
        try:
            with open(f"/sys/class/video4linux/video{idx}/name") as f:
                name = f.read().strip() or name
        except OSError:
            pass
        # one physical camera often exposes several /dev/video nodes with the
        # same name; keep the first (lowest index, the capture node).
        if name in seen_names:
            continue
        seen_names.add(name)
        cams.append({"index": idx, "name": name})
    return cams
