"""Background capture + detection worker.

Runs in its own thread: grabs frames from the camera, throttles YOLO inference,
writes detections to the DB, saves periodic annotated snapshots, evaluates alert
rules, and keeps the latest annotated frame (as JPEG bytes) for the web stream."""
import threading
import time

import cv2

from . import alerts, config, db
from .detector import Detector


class CameraWorker:
    def __init__(self):
        self.detector = None
        self.cap = None
        self.source = str(config.SOURCE)
        self._thread = None
        self._stop = threading.Event()
        self._frame_lock = threading.Lock()
        self._latest_jpeg = None
        self.status = {
            "running": False,
            "paused": False,
            "source": self.source,
            "model": config.MODEL,
            "error": None,
            "fps": 0.0,
            "last_detection_count": 0,
        }

    def _source_value(self):
        """The current source as an int (camera index) or str (URL)."""
        s = str(self.source)
        return int(s) if s.isdigit() else s

    # --- lifecycle ---------------------------------------------------------
    def start(self):
        if self._thread and self._thread.is_alive():
            return
        self._stop.clear()
        self._thread = threading.Thread(target=self._run, daemon=True)
        self._thread.start()

    def stop(self):
        self._stop.set()
        if self._thread:
            self._thread.join(timeout=5)

    def pause(self):
        """Turn detection OFF: stop the thread, release the camera, free the CPU."""
        self.stop()
        self.status["paused"] = True
        self.status["running"] = False
        self.status["fps"] = 0.0
        self.status["last_detection_count"] = 0
        with self._frame_lock:
            self._latest_jpeg = None

    def resume(self):
        """Turn detection back ON."""
        self.status["paused"] = False
        self.start()

    def set_source(self, source):
        """Switch the video input at runtime: stop, swap source, restart."""
        self.stop()
        self.source = str(source)
        config.SOURCE = self.source            # keep config in sync for snapshots/logs
        self.status["source"] = self.source
        self.status["error"] = None
        self.status["fps"] = 0.0
        with self._frame_lock:
            self._latest_jpeg = None           # drop the stale last frame
        self.start()
        return self.source

    # --- main loop ---------------------------------------------------------
    def _run(self):
        try:
            self.detector = Detector()
        except Exception as e:  # model load failure
            self.status["error"] = f"model load failed: {e}"
            return

        src = self._source_value()
        self.cap = cv2.VideoCapture(src)
        if not self.cap.isOpened():
            self.status["error"] = (
                f"could not open camera source {src!r}. "
                "Check the camera is connected and not in use by another app, "
                "and that Terminal has camera permission in System Settings > Privacy."
            )
            return

        self.status["running"] = True
        self.status["error"] = None
        last_detect = 0.0
        last_snapshot = 0.0
        last_fps_t = time.time()
        frames = 0
        last_detections = []   # most recent boxes, redrawn every frame to avoid flicker

        while not self._stop.is_set():
            ok, frame = self.cap.read()
            if not ok:
                time.sleep(0.05)
                continue

            frames += 1
            now = time.time()

            # FPS (rolling, updated ~1/sec)
            if now - last_fps_t >= 1.0:
                self.status["fps"] = round(frames / (now - last_fps_t), 1)
                frames = 0
                last_fps_t = now

            if now - last_detect >= config.DETECT_INTERVAL:
                last_detect = now
                detections = self.detector.detect(frame)
                last_detections = detections
                self.status["last_detection_count"] = len(detections)

                if detections:
                    drawn = self._draw(frame, detections)  # frame with boxes, for snapshots
                    snapshot_name = None
                    if now - last_snapshot >= config.SNAPSHOT_INTERVAL:
                        last_snapshot = now
                        snapshot_name = self._save_snapshot(drawn, now)

                    rows = [{
                        "ts": now, "source": self.source,
                        "label": d["label"], "confidence": d["confidence"],
                        "x1": d["x1"], "y1": d["y1"], "x2": d["x2"], "y2": d["y2"],
                        "snapshot": snapshot_name,
                    } for d in detections]
                    db.insert_detections(rows)
                    # Save an alert snapshot lazily — only if a rule actually fires,
                    # reusing this cycle's snapshot if we already wrote one.
                    cache = {"name": snapshot_name}

                    def save_alert_snapshot():
                        if cache["name"] is None:
                            cache["name"] = self._save_snapshot(drawn, now)
                        return cache["name"]

                    alerts.evaluate(detections, save_alert_snapshot, now=now)

            # Redraw the latest boxes on EVERY frame so they stay visible and
            # move smoothly between detection cycles (no flicker).
            self._publish(self._draw(frame, last_detections))

        self.status["running"] = False
        if self.cap:
            self.cap.release()

    # --- helpers -----------------------------------------------------------
    def _draw(self, frame, detections):
        """Draw bounding boxes + labels onto a copy of the frame."""
        if not detections:
            return frame
        img = frame.copy()
        color = (80, 220, 100)  # BGR green
        for d in detections:
            x1, y1, x2, y2 = int(d["x1"]), int(d["y1"]), int(d["x2"]), int(d["y2"])
            cv2.rectangle(img, (x1, y1), (x2, y2), color, 2)
            label = f'{d["label"]} {d["confidence"] * 100:.0f}%'
            (tw, th), _ = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, 0.5, 1)
            cv2.rectangle(img, (x1, y1 - th - 6), (x1 + tw + 4, y1), color, -1)
            cv2.putText(img, label, (x1 + 2, y1 - 4),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.5, (20, 20, 20), 1, cv2.LINE_AA)
        return img

    def _save_snapshot(self, frame, ts):
        name = f"{int(ts * 1000)}.jpg"
        path = config.SNAPSHOT_DIR / name
        cv2.imwrite(str(path), frame)
        return name

    def _publish(self, frame):
        ok, buf = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 80])
        if ok:
            with self._frame_lock:
                self._latest_jpeg = buf.tobytes()

    def get_jpeg(self):
        with self._frame_lock:
            return self._latest_jpeg

    def mjpeg_frames(self):
        """Generator yielding multipart MJPEG chunks for the live stream."""
        boundary = b"--frame"
        while True:
            jpeg = self.get_jpeg()
            if jpeg is not None:
                yield (boundary + b"\r\nContent-Type: image/jpeg\r\n"
                       + f"Content-Length: {len(jpeg)}\r\n\r\n".encode()
                       + jpeg + b"\r\n")
            time.sleep(0.04)  # ~25 fps cap on the stream


worker = CameraWorker()
