"""FastAPI app: live MJPEG stream, detection search, alert rules, snapshots."""
from contextlib import asynccontextmanager

from fastapi import FastAPI, Query
from fastapi.responses import StreamingResponse, FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from . import capture, config, db, devices, maintenance
from .manager import manager


@asynccontextmanager
async def lifespan(app: FastAPI):
    db.init()
    manager.start()
    maintenance.start()
    yield
    maintenance.stop()
    manager.stop_all()


app = FastAPI(title="Argus", lifespan=lifespan)


# --- live feed -------------------------------------------------------------
@app.get("/stream")
def stream(source: str = Query(None)):
    """MJPEG stream for one camera (defaults to the primary camera)."""
    w = manager.get(source)
    if w is None:
        return JSONResponse({"error": "no such camera"}, status_code=404)
    return StreamingResponse(
        w.mjpeg_frames(),
        media_type="multipart/x-mixed-replace; boundary=frame",
    )


@app.get("/api/status")
def status():
    """Status for every active camera, plus the live-box toggle state."""
    return {"cameras": manager.statuses(), "show_boxes": capture.get_show_boxes()}


@app.post("/api/boxes")
def set_boxes(payload: dict):
    """Toggle bounding boxes on the live feed. `on`: true|false."""
    capture.set_show_boxes(bool(payload.get("on", True)))
    return {"show_boxes": capture.get_show_boxes()}


@app.post("/api/power")
def power(payload: dict):
    """Turn detection on/off to save compute. `on`: true|false. Optional `source`
    targets one camera; omitted = all cameras."""
    on = bool(payload.get("on"))
    source = payload.get("source")
    if source is not None:
        w = manager.get(str(source))
        if w is None:
            return JSONResponse({"error": "no such camera"}, status_code=404)
        w.resume() if on else w.pause()
    else:
        manager.resume_all() if on else manager.pause_all()
    return {"cameras": manager.statuses()}


# --- camera management -----------------------------------------------------
@app.get("/api/devices")
def list_devices():
    """Detected cameras on this machine, plus the sources currently in use."""
    return {"devices": devices.list_cameras(), "active": manager.sources()}


@app.post("/api/cameras")
def add_camera(payload: dict):
    """Add a camera. `source` = a camera index ('0','1',…) or a stream URL."""
    source = str(payload.get("source", "")).strip()
    if not source:
        return JSONResponse({"error": "source is required"}, status_code=400)
    manager.add(source)
    return {"ok": True, "active": manager.sources()}


@app.post("/api/cameras/remove")
def remove_camera(payload: dict):
    """Remove (stop) a camera by its source string."""
    source = str(payload.get("source", "")).strip()
    removed = manager.remove(source)
    return {"ok": removed, "active": manager.sources()}


@app.get("/api/activity")
def activity(hours: int = Query(24, ge=1, le=168), buckets: int = Query(24, ge=4, le=96)):
    """Detection counts over time, for the dashboard timeline chart."""
    return db.activity(hours=hours, buckets=buckets)


@app.post("/api/shutdown")
def shutdown():
    """Cleanly stop all cameras and exit the process. Reliable where Ctrl-C isn't
    (the live MJPEG streams block uvicorn's graceful shutdown, so we force-exit
    after releasing the cameras)."""
    import os
    import threading

    def _kill():
        try:
            maintenance.stop()
            manager.stop_all()
        finally:
            os._exit(0)

    threading.Timer(0.3, _kill).start()  # let this HTTP response flush first
    return {"ok": True, "message": "Argus is shutting down."}


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
    """Gallery grouped by object (each item is one object appearance)."""
    return db.gallery(label=label or None, limit=limit, pinned=pinned)


@app.get("/api/gallery/group")
def gallery_group(gkey: str = Query(...)):
    """All snapshots for one object group, for the expanded (stacked) view."""
    return db.gallery_group(gkey)


@app.get("/api/snapshot-boxes")
def snapshot_boxes(name: str = Query(...)):
    """Box geometry for a snapshot, for the toggleable gallery overlay."""
    return db.get_snapshot_boxes(name)


@app.delete("/api/gallery/group")
def delete_gallery_group(gkey: str = Query(...)):
    """Delete all snapshots belonging to one object group."""
    return {"ok": True, "deleted": db.delete_group(gkey)}


# --- storage settings, pinning, cleanup ------------------------------------
@app.get("/api/settings")
def get_settings():
    return {
        "retention_days": int(float(db.get_setting("retention_days", "0"))),
        "max_snapshots": int(float(db.get_setting("max_snapshots", "0"))),
    }


@app.post("/api/settings")
def update_settings(payload: dict):
    if "retention_days" in payload:
        db.set_setting("retention_days", max(0, int(payload["retention_days"])))
    if "max_snapshots" in payload:
        db.set_setting("max_snapshots", max(0, int(payload["max_snapshots"])))
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
