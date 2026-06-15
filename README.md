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
  / IP camera, and draws labeled boxes (color-coded by confidence) on a live feed.
- **Object tracking** — assigns a stable ID to each object (ByteTrack), so a thing
  is cataloged once per appearance instead of every frame.
- **GPU acceleration** — auto-uses the Apple GPU (Metal/MPS) or NVIDIA CUDA when
  available, falling back to CPU.
- **Multi-camera** — run several cameras at once; the dashboard shows all feeds.
- **Catalog** — every detection stored with type, confidence, timestamp, track id,
  camera source, and a snapshot image, in a local SQLite database.
- **Search** — find past detections by object type and time range.
- **Activity timeline** — a 24-hour chart of detection volume on the dashboard.
- **Gallery** — browse all captured snapshots; arrow-key through them full-size,
  download, pin, or delete.
- **Pinning** — pin important snapshots to permanent storage so cleanup never
  removes them; a dedicated "Pinned" gallery view shows just those.
- **Alerts** — define rules (e.g. "person, confidence ≥ 0.6, between 22:00 and
  06:00"); matches are logged and shown on the dashboard.
- **On/off + clean shutdown** — turn detection off to stop YOLO/snapshots/alerts
  (the live feed keeps streaming), or cleanly stop the whole server from the menu.
- **Storage cleanup** — auto-delete data older than N days and/or cap the number
  of snapshots kept (pinned items are always kept).
- **Camera management** — add/remove cameras from a menu (auto-detected) or by
  pasting a stream URL, without restarting.
- **Live views** — a multi-camera **Quad** grid and a single-camera full-screen
  **View** tab, in addition to the dashboard feed.

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

It prints the URL to open. Served over **HTTPS**.

> First run downloads the YOLO weights (`yolo11n.pt`, ~5 MB) and generates the
> cert automatically.

### Access modes — `ARGUS_BIND`

| Mode | Command | Reachable from | Cert |
|------|---------|----------------|------|
| `lan` (default) | `.venv/bin/python run.py` | this Mac **and anything on your wifi** | self-signed (browser warns once) |
| `local` | `ARGUS_BIND=local .venv/bin/python run.py` | this Mac only | self-signed |
| `tailscale` | `ARGUS_BIND=tailscale .venv/bin/python run.py` | your devices over Tailscale, **incl. cellular** — **not** exposed on wifi | trusted (no warning) |

- **Home / unsecured:** the default `lan` mode. Open the printed
  `https://<your-mac-ip>:8000` from a phone on the same wi-fi (accept the
  one-time self-signed warning). If the phone can't connect, check the macOS
  firewall (System Settings → Network → Firewall) allows Python, and that the
  phone is on the same network (not a guest SSID with client isolation).
- **Remote / cellular (recommended):** `tailscale` mode. Requires
  [Tailscale](https://tailscale.com) on the Mac and phone, with **MagicDNS** and
  **HTTPS Certificates** enabled in the [admin console](https://login.tailscale.com/admin/dns).
  Argus mints a trusted cert via `tailscale cert` and binds to the Tailscale IP
  only, so it works from anywhere (including cell) with no certificate warning
  and **no exposure on your wifi**. Open `https://<device>.<tailnet>.ts.net:8000`.
- `ARGUS_HTTPS=0` serves plain http; `ARGUS_HOST=<addr>` overrides the bind
  address directly (advanced).

> iOS Safari is strict about self-signed certs — in `lan`/`local` mode use Chrome
> on the phone, or use `tailscale` mode (trusted cert, works in Safari).

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

**Hardware:** detection auto-selects the best device — Apple GPU (Metal/MPS) or
NVIDIA CUDA when available, else CPU (`ARGUS_DEVICE=auto`). The GPU speed-up lets
you run a larger model at the same frame rate; force a device with
`ARGUS_DEVICE=mps|cuda|cpu`.

---

## How it works

```
camera ─► capture.py ─► detector.py (YOLO) ─► db.py (SQLite)
                              │                    ▲
                              └► alerts.py ────────┘
                                                   │
        maintenance.py (cleanup)   web dashboard ◄─┴─ server.py
```

- `run.py` — **the entry point** (`python run.py`); launches the web server.
- `app/server.py` — FastAPI app: stream, status, search, gallery, rules,
  settings, camera management, activity, shutdown, snapshots.
- `app/manager.py` — owns the camera workers (multi-camera).
- `app/capture.py` — per-camera background thread: grab frames, detect/track,
  log detections, save snapshots, evaluate alerts, publish the latest JPEG frame.
- `app/detector.py` — YOLO wrapper with device selection + tracking.
- `app/onvif.py` — ONVIF discovery, RTSP-URL resolution, and WS-Security helpers.
- `app/db.py` — SQLite (`detections`, `alert_rules`, `alerts`, `settings`,
  `kept_snapshots`) and the search/gallery/activity/cleanup queries.
- `app/alerts.py` — rule evaluation with confidence + time-of-day + per-camera cooldown.
- `app/maintenance.py` — periodic storage cleanup (age + count caps).
- `app/devices.py` — cross-platform camera enumeration (macOS + Linux).
- `web/` — the dashboard (plain HTML/CSS/JS, no build step).

---

## Security & sharing

The **source code is safe to publish** — it contains no secrets or credentials,
all database access is parameterized (no SQL injection), snapshot paths are
validated against traversal, and `.gitignore` keeps your `data/` (the database
and snapshot images, which may show people) out of git.

**Before exposing it on a network, understand the deployment risks:**

- **No authentication yet.** Anyone who can reach the port can view your camera
  feeds, browse/delete snapshots, change settings, add cameras, and shut the
  server down. So *how* you expose it matters — use the `ARGUS_BIND` modes above:
  - `tailscale` — only your own Tailscale devices can reach it; nothing on wifi
    can. This is the safe way to use it remotely.
  - `local` — only this Mac.
  - `lan` — open to your whole wifi; fine on a trusted home network, but don't
    use it on untrusted/guest wifi, and never port-forward it to the internet.
- The "custom source" field opens any URL/device you give it — only enter sources
  you trust.

In short: **publish the code freely; for remote use run it in `tailscale` mode.**

---

## Roadmap

- Authentication / login (so `lan` mode can be exposed more safely)
- Email / push notifications on alerts (already logged; delivery is a hook away)
- Run as a background service (launchd / systemd) that auto-starts on boot
- Zone/line alert rules (trigger only when something crosses a region you draw)
- NCNN/ONNX export path for Raspberry Pi performance

Done recently: GPU (MPS/CUDA) inference · object tracking · multi-camera ·
grouped gallery with toggleable overlay boxes · activity timeline · adaptive
snapshot cadence · count-based cleanup · mobile-responsive UI · HTTPS · trusted
remote access via Tailscale (`ARGUS_BIND=tailscale`) · clean shutdown · ONVIF
camera onboarding.
