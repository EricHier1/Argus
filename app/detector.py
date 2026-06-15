"""Thin wrapper around an Ultralytics YOLO model."""
from ultralytics import YOLO

from . import config


class Detector:
    def __init__(self, model_path=None, confidence=None):
        self.confidence = confidence if confidence is not None else config.CONFIDENCE
        # YOLO() downloads the weights on first use if they aren't present locally.
        self.model = YOLO(model_path or config.MODEL)
        self.names = self.model.names  # {class_id: name}

    def detect(self, frame):
        """Run inference on a BGR frame.

        Returns a list of dicts {label, confidence, x1, y1, x2, y2}.
        (Box drawing is done by the caller so boxes can persist between
        detection cycles — see CameraWorker._draw.)
        """
        results = self.model(frame, conf=self.confidence, verbose=False)[0]
        detections = []
        for box in results.boxes:
            cls_id = int(box.cls[0])
            x1, y1, x2, y2 = (float(v) for v in box.xyxy[0])
            detections.append({
                "label": self.names[cls_id],
                "confidence": float(box.conf[0]),
                "x1": x1, "y1": y1, "x2": x2, "y2": y2,
            })
        return detections
