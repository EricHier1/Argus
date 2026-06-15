# Argus

A local computer-vision system that watches a camera feed, identifies objects in
real time with **YOLO**, catalogs every detection in a database with a timestamp,
and lets you **search** past detections, **browse** captured snapshots, and set
**alerts** for specific object types. Everything runs on your own machine — no
cloud, no accounts.

Named after Argus Panoptes, the all-seeing giant of Greek myth.

---

## What it does

- **Live detection** — reads from your built-in camera, a USB webcam, or a phone
  / IP camera, and draws labeled boxes on a live feed at ~25 fps.
- **Catalog** — every detected object is stored with its type, confidence,
  timestamp, and a snapshot image, in a local SQLite database.
- **Search** — find past detections by object type and time range.
- **Gallery** — browse all captured snapshots; arrow-key through them full-size.
- **Pinning** — pin important snapshots to permanent storage so cleanup never
  removes them; a dedicated "Pinned" gallery view shows just those.
- **Alerts** — define rules (e.g. "person, confidence ≥ 0.6, between 22:00 and
  06:00"); matches are logged and shown on the dashboard.
- **On/off** — turn detection off from the UI to release the camera and free the
  CPU; your stored data stays searchable.
- **Storage cleanup** — optionally auto-delete data older than N days (pinned
  items are always kept).
- **Source switching** — pick the camera from a menu (auto-detected) or paste a
  stream URL, without restarting.

---

## Requirements

- macOS (developed on Apple Silicon), Python 3.12
- A camera (the Mac will prompt for camera permission on first run)

## Setup

```bash
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
```

## Run

```bash
.venv/bin/python run.py
```

Open **http://localhost:8000**. To view from your phone on the same wifi, open
`http://<your-mac-ip>:8000`.

> First run downloads the YOLO weights (`yolo11n.pt`, ~5 MB) automatically.

To keep it running with the display asleep:

```bash
caffeinate -i .venv/bin/python run.py
```

---

## Using it

- **Dashboard** — live feed, in-frame object chips, recent alerts, alert-rule
  editor, and detection search.
- **Gallery** — All / Pinned tabs, filter by type, click a thumbnail to enlarge.
  In the enlarged view: **Download**, **Pin to permanent**, **Delete**, and
  **arrow keys** to move between captures (Esc closes).
- **Settings menu** (top-right) — turn detection on/off, choose the video source
  (with **Rescan** for newly connected cameras), and set the storage-cleanup
  timeframe.

### Configuration

All settings are environment variables, prefixed `ARGUS_` (see `app/config.py`).
Examples:

```bash
ARGUS_SOURCE=1 .venv/bin/python run.py            # second camera (e.g. USB)
ARGUS_SOURCE="http://192.168.1.50:4747/video" \
    .venv/bin/python run.py                       # phone via an IP-camera app
ARGUS_MODEL=yolo11s.pt .venv/bin/python run.py    # larger, more accurate model
ARGUS_CONFIDENCE=0.6 .venv/bin/python run.py      # only record confident hits
```

Data lives in `data/` (SQLite DB + JPEG snapshots), which is gitignored.

---

## What object types can it detect?

Out of the box the model recognizes the **80 COCO classes**:

> person, bicycle, car, motorcycle, airplane, bus, train, truck, boat, traffic
> light, fire hydrant, stop sign, parking meter, bench, bird, cat, dog, horse,
> sheep, cow, elephant, bear, zebra, giraffe, backpack, umbrella, handbag, tie,
> suitcase, frisbee, skis, snowboard, sports ball, kite, baseball bat, baseball
> glove, skateboard, surfboard, tennis racket, bottle, wine glass, cup, fork,
> knife, spoon, bowl, banana, apple, sandwich, orange, broccoli, carrot, hot dog,
> pizza, donut, cake, chair, couch, potted plant, bed, dining table, toilet, tv,
> laptop, mouse, remote, keyboard, cell phone, microwave, oven, toaster, sink,
> refrigerator, book, clock, vase, scissors, teddy bear, hair drier, toothbrush

If you need to detect something **not** on this list (a specific tool, a logo, a
particular animal breed, a person's identity, license plates, etc.), the base
model can't — that requires a different or custom-trained model (see below).

---

## Room for improvement — model size & weights

Argus currently uses **`yolo11n.pt`** — the "nano" model. It's the smallest and
fastest YOLO11 variant, which is why it runs at ~25 fps on CPU using only about
half a CPU core. The trade-off is accuracy: small models miss more objects and
are less confident, especially for small, distant, dark, or partially hidden
things.

**Why you might want a bigger model (more accuracy):**
YOLO11 comes in escalating sizes — `n` (nano) → `s` (small) → `m` (medium) →
`l` (large) → `x` (extra-large). Each step up detects more objects, draws tighter
boxes, and is more confident — at the cost of speed and CPU/RAM. Swap it in with
no code change:

```bash
ARGUS_MODEL=yolo11s.pt .venv/bin/python run.py   # ~2x slower, noticeably better
ARGUS_MODEL=yolo11m.pt .venv/bin/python run.py   # better still, heavier
```

Rough guidance:

| Model       | Speed (CPU) | Accuracy | Good for |
|-------------|-------------|----------|----------|
| yolo11n     | fastest     | basic    | always-on, low power, clear scenes |
| yolo11s     | fast        | better   | a good default once you want more |
| yolo11m/l/x | slower      | best     | when accuracy matters more than fps |

**Why you might want different *weights* entirely:**
The size variants above are all trained on the same 80 everyday COCO objects. To
detect things outside that list, you change the *weights* (the trained model
file), not just the size:

- **Domain-specific pretrained weights** — e.g. models trained for aerial/drone
  imagery, vehicles & license plates, PPE/safety gear, or retail products.
- **Custom-trained weights** — train YOLO on your own labeled images to detect
  exactly what you care about (a specific package, a particular person, a tool).
  This is the path to recognizing things the generic model has never seen.
- **Specialized tasks** — pose estimation, segmentation, or oriented boxes use
  different model files (`-pose`, `-seg`, `-obb`).

**Other accuracy levers** (no new model needed):
- Better lighting and camera placement help more than a bigger model.
- Lower `ARGUS_CONFIDENCE` to catch more (at the cost of false positives), or
  raise it to reduce noise.
- Run detection more often (`ARGUS_DETECT_INTERVAL`) for fast-moving scenes.

**Hardware:** detection currently runs on CPU. On Apple Silicon it can be moved
to the GPU (Metal/MPS) for a meaningful speed-up, which would let you run a larger
model at the same frame rate. Not enabled yet — a planned improvement.

---

## How it works

```
camera ─► capture.py ─► detector.py (YOLO) ─► db.py (SQLite)
                              │                    ▲
                              └► alerts.py ────────┘
                                                   │
        maintenance.py (cleanup)   web dashboard ◄─┴─ server.py
```

- `app/capture.py` — background thread: grab frames, throttle detection, persist
  detections, save snapshots, evaluate alerts, feed the live MJPEG stream.
- `app/detector.py` — YOLO wrapper.
- `app/db.py` — SQLite (`detections`, `alert_rules`, `alerts`, `settings`,
  `kept_snapshots`) and the search/gallery/cleanup queries.
- `app/alerts.py` — rule evaluation with confidence + time-of-day + cooldown.
- `app/maintenance.py` — periodic storage cleanup honoring the retention setting.
- `app/devices.py` — camera enumeration for the source picker.
- `app/server.py` — FastAPI: stream, search, gallery, rules, settings, snapshots.
- `web/` — the dashboard (plain HTML/CSS/JS, no build step).

---

## Roadmap

- Email / push notifications on alerts (already logged; delivery is a hook away)
- Apple GPU (MPS) inference for higher fps / larger models
- Object tracking IDs so a stationary object isn't re-logged every cycle
- Multiple simultaneous camera sources
- Run as a background service (launchd) that auto-starts on login
