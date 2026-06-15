"""Periodic storage cleanup. Reads the `retention_days` setting and prunes old
data on an interval (and once at startup). Runs in its own daemon thread."""
import threading
import time

from . import db

CHECK_INTERVAL = 1800  # seconds between cleanup passes (30 min)

_stop = threading.Event()
_thread = None
last_result = {"ran": False}


def run_once():
    """Run a single cleanup pass using the current retention setting."""
    global last_result
    days = int(float(db.get_setting("retention_days", "0")))
    result = db.cleanup(days)
    result["ran_at"] = time.time()
    result["retention_days"] = days
    last_result = result
    return result


def _loop():
    while not _stop.is_set():
        try:
            run_once()
        except Exception as e:
            last_result["error"] = str(e)
        _stop.wait(CHECK_INTERVAL)


def start():
    global _thread
    if _thread and _thread.is_alive():
        return
    _stop.clear()
    _thread = threading.Thread(target=_loop, daemon=True)
    _thread.start()


def stop():
    _stop.set()
