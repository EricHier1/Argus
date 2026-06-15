"""FastAPI app: live MJPEG stream, detection search, alert rules, snapshots."""
from contextlib import asynccontextmanager

from fastapi import FastAPI, Query
from fastapi.responses import StreamingResponse, FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from . import config, db, devices, maintenance
from .capture import worker


@asynccontextmanager
async def lifespan(app: FastAPI):
    db.init()
    worker.start()
    maintenance.start()
    yield
    maintenance.stop()
    worker.stop()


app = FastAPI(title="Argus", lifespan=lifespan)


# --- live feed -------------------------------------------------------------
@app.get("/stream")
def stream():
    return StreamingResponse(
        worker.mjpeg_frames(),
        media_type="multipart/x-mixed-replace; boundary=frame",
    )


@app.get("/api/status")
def status():
    return worker.status


@app.post("/api/power")
def power(payload: dict):
    """Turn detection on/off to save compute. `on`: true | false."""
    if payload.get("on"):
        worker.resume()
    else:
        worker.pause()
    return {"paused": worker.status["paused"]}


@app.get("/api/devices")
def list_devices():
    """Available cameras plus the currently selected source."""
    return {"devices": devices.list_cameras(), "current": worker.source}


@app.post("/api/source")
def set_source(payload: dict):
    """Switch the video input. `source` may be a camera index ('0', '1', …)
    or a stream URL (e.g. a phone/IP camera)."""
    source = str(payload.get("source", "")).strip()
    if not source:
        return JSONResponse({"error": "source is required"}, status_code=400)
    worker.set_source(source)
    return {"ok": True, "source": worker.source}


# --- detections & search ---------------------------------------------------
@app.get("/api/detections")
def detections(label: str = Query(None), start: float = Query(None),
               end: float = Query(None), limit: int = Query(200, le=1000)):
    return db.search_detections(label=label or None, start=start, end=end, limit=limit)


@app.get("/api/labels")
def labels():
    return db.label_summary()


@app.get("/api/gallery")
def gallery(label: str = Query(None), limit: int = Query(120, le=500),
            pinned: bool = Query(False)):
    return db.gallery(label=label or None, limit=limit, pinned=pinned)


# --- storage settings, pinning, cleanup ------------------------------------
@app.get("/api/settings")
def get_settings():
    return {"retention_days": int(float(db.get_setting("retention_days", "0")))}


@app.post("/api/settings")
def update_settings(payload: dict):
    if "retention_days" in payload:
        days = int(payload["retention_days"])
        db.set_setting("retention_days", max(0, days))
    return get_settings()


@app.post("/api/keep")
def keep(payload: dict):
    """Pin/unpin a snapshot so cleanup never deletes it. `snapshot`, `kept` bool."""
    snapshot = str(payload.get("snapshot", "")).strip()
    if not snapshot:
        return JSONResponse({"error": "snapshot required"}, status_code=400)
    db.set_kept(snapshot, bool(payload.get("kept", True)), payload.get("note"))
    return {"snapshot": snapshot, "kept": bool(payload.get("kept", True))}


@app.post("/api/cleanup")
def cleanup_now():
    """Run a cleanup pass immediately using the current retention setting."""
    return maintenance.run_once()


@app.delete("/api/snapshot/{name}")
def delete_snapshot(name: str):
    """Permanently delete one snapshot and its detection records."""
    if ".." in name or "/" in name:
        return JSONResponse({"error": "bad name"}, status_code=400)
    db.delete_snapshot(name)
    return {"ok": True, "deleted": name}


# --- alert rules -----------------------------------------------------------
@app.get("/api/rules")
def get_rules():
    return db.list_rules()


@app.post("/api/rules")
def create_rule(payload: dict):
    rule_id = db.add_rule(
        label=payload["label"],
        min_conf=float(payload.get("min_conf", 0.5)),
        start_hour=payload.get("start_hour"),
        end_hour=payload.get("end_hour"),
    )
    return {"id": rule_id}


@app.post("/api/rules/{rule_id}/toggle")
def toggle_rule(rule_id: int, payload: dict):
    db.set_rule_active(rule_id, bool(payload.get("active", True)))
    return {"ok": True}


@app.delete("/api/rules/{rule_id}")
def remove_rule(rule_id: int):
    db.delete_rule(rule_id)
    return {"ok": True}


# --- alerts ----------------------------------------------------------------
@app.get("/api/alerts")
def alerts_feed(since: float = Query(None), limit: int = Query(100, le=500)):
    return db.recent_alerts(limit=limit, since=since)


# --- snapshots & static web ------------------------------------------------
@app.get("/snapshots/{name}")
def snapshot(name: str, download: bool = Query(False)):
    path = config.SNAPSHOT_DIR / name
    if not path.exists() or ".." in name or "/" in name:
        return JSONResponse({"error": "not found"}, status_code=404)
    if download:
        return FileResponse(path, media_type="image/jpeg", filename=f"argus-{name}")
    return FileResponse(path)


app.mount("/", StaticFiles(directory=str(config.WEB_DIR), html=True), name="web")
