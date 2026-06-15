"""Thin wrapper around an Ultralytics YOLO model, with device selection and
optional object tracking (ByteTrack).

With tracking on, the model assigns a stable integer ID to each object across
frames, so the capture loop can log an object once per appearance instead of
every frame. Tracking state lives on the model instance, so each camera needs
its own Detector (which it gets — one per CameraWorker)."""
from ultralytics import YOLO

from . import config


def resolve_device(pref):
    """'auto' -> mps (Apple GPU) / cuda (NVIDIA) if available, else cpu."""
    pref = (pref or "auto").lower()
    if pref != "auto":
        return pref
    try:
        import torch
        if torch.backends.mps.is_available():
            return "mps"
        if torch.cuda.is_available():
            return "cuda"
    except Exception:
        pass
    return "cpu"


class Detector:
    def __init__(self, model_path=None, confidence=None, device=None, track=None):
        self.confidence = confidence if confidence is not None else config.CONFIDENCE
        self.device = resolve_device(device if device is not None else config.DEVICE)
        self.track = config.TRACK if track is None else track
        # YOLO() downloads the weights on first use if they aren't present locally.
        self.model = YOLO(model_path or config.MODEL)
        self.names = self.model.names  # {class_id: name}

    def detect(self, frame):
        """Run inference (or tracking) on a BGR frame.

        Returns a list of dicts {label, confidence, track_id, x1, y1, x2, y2}.
        track_id is None when tracking is disabled or the object isn't tracked.
        Box drawing is done by the caller (CameraWorker._draw)."""
        if self.track:
            results = self.model.track(
                frame, conf=self.confidence, persist=True,
                tracker="bytetrack.yaml", verbose=False, device=self.device,
            )[0]
        else:
            results = self.model(
                frame, conf=self.confidence, verbose=False, device=self.device,
            )[0]

        detections = []
        for box in results.boxes:
            cls_id = int(box.cls[0])
            track_id = int(box.id[0]) if getattr(box, "id", None) is not None else None
            x1, y1, x2, y2 = (float(v) for v in box.xyxy[0])
            detections.append({
                "label": self.names[cls_id],
                "confidence": float(box.conf[0]),
                "track_id": track_id,
                "x1": x1, "y1": y1, "x2": x2, "y2": y2,
            })
        return detections
