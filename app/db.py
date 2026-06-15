"""SQLite storage layer. One connection per thread (sqlite3 default), guarded
by a module lock so the capture thread and the web server can share writes."""
import sqlite3
import threading
import time
from contextlib import contextmanager

from . import config

_lock = threading.Lock()

SCHEMA = """
CREATE TABLE IF NOT EXISTS detections (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    ts          REAL    NOT NULL,          -- unix epoch seconds
    source      TEXT    NOT NULL,
    label       TEXT    NOT NULL,
    confidence  REAL    NOT NULL,
    x1 REAL, y1 REAL, x2 REAL, y2 REAL,    -- bounding box
    snapshot    TEXT                        -- filename in data/snapshots, or NULL
);
CREATE INDEX IF NOT EXISTS idx_det_ts    ON detections(ts);
CREATE INDEX IF NOT EXISTS idx_det_label ON detections(label);

CREATE TABLE IF NOT EXISTS alert_rules (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    label       TEXT    NOT NULL,          -- object type to watch, e.g. 'person'
    min_conf    REAL    NOT NULL DEFAULT 0.5,
    start_hour  INTEGER,                    -- 0-23, NULL = any time
    end_hour    INTEGER,                    -- 0-23, NULL = any time (window may wrap midnight)
    active      INTEGER NOT NULL DEFAULT 1,
    created     REAL    NOT NULL
);

CREATE TABLE IF NOT EXISTS alerts (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    ts          REAL    NOT NULL,
    rule_id     INTEGER,
    label       TEXT    NOT NULL,
    confidence  REAL,
    message     TEXT,
    snapshot    TEXT
);
CREATE INDEX IF NOT EXISTS idx_alert_ts ON alerts(ts);

CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT
);

-- snapshots the user pinned to permanent storage (never removed by cleanup)
CREATE TABLE IF NOT EXISTS kept_snapshots (
    snapshot TEXT PRIMARY KEY,
    ts       REAL NOT NULL,
    note     TEXT
);
"""


def init():
    config.DATA_DIR.mkdir(parents=True, exist_ok=True)
    config.SNAPSHOT_DIR.mkdir(parents=True, exist_ok=True)
    with connect() as c:
        c.executescript(SCHEMA)


@contextmanager
def connect():
    conn = sqlite3.connect(config.DB_PATH, timeout=10)
    conn.row_factory = sqlite3.Row
    try:
        with _lock:
            yield conn
            conn.commit()
    finally:
        conn.close()


# --- Detections ------------------------------------------------------------
def insert_detections(rows):
    """rows: list of dicts with ts, source, label, confidence, x1..y2, snapshot."""
    if not rows:
        return
    with connect() as c:
        c.executemany(
            """INSERT INTO detections (ts, source, label, confidence, x1, y1, x2, y2, snapshot)
               VALUES (:ts, :source, :label, :confidence, :x1, :y1, :x2, :y2, :snapshot)""",
            rows,
        )


def search_detections(label=None, start=None, end=None, limit=200):
    q = "SELECT * FROM detections WHERE 1=1"
    params = {}
    if label:
        q += " AND label = :label"
        params["label"] = label
    if start is not None:
        q += " AND ts >= :start"
        params["start"] = start
    if end is not None:
        q += " AND ts <= :end"
        params["end"] = end
    q += " ORDER BY ts DESC LIMIT :limit"
    params["limit"] = limit
    with connect() as c:
        return [dict(r) for r in c.execute(q, params).fetchall()]


def gallery(label=None, limit=120, pinned=False):
    """Distinct saved snapshots, newest first, with the object types in each
    and whether the snapshot is pinned (kept). pinned=True returns only the
    user's pinned snapshots (driven off kept_snapshots so they show regardless
    of age or limit on the main view)."""
    if pinned:
        q = """SELECT k.snapshot AS snapshot, k.ts AS ts,
                      GROUP_CONCAT(DISTINCT d.label) AS labels,
                      COUNT(d.id) AS n, 1 AS kept
               FROM kept_snapshots k
               LEFT JOIN detections d ON d.snapshot = k.snapshot
               GROUP BY k.snapshot ORDER BY k.ts DESC LIMIT :limit"""
        with connect() as c:
            return [dict(r) for r in c.execute(q, {"limit": limit}).fetchall()]

    q = """SELECT d.snapshot AS snapshot, MIN(d.ts) AS ts,
                  GROUP_CONCAT(DISTINCT d.label) AS labels, COUNT(*) AS n,
                  (k.snapshot IS NOT NULL) AS kept
           FROM detections d
           LEFT JOIN kept_snapshots k ON k.snapshot = d.snapshot
           WHERE d.snapshot IS NOT NULL"""
    params = {}
    if label:
        # only snapshots that contain this label, but still list all their labels
        q += """ AND d.snapshot IN (
                    SELECT snapshot FROM detections
                    WHERE label = :label AND snapshot IS NOT NULL)"""
        params["label"] = label
    q += " GROUP BY d.snapshot ORDER BY ts DESC LIMIT :limit"
    params["limit"] = limit
    with connect() as c:
        return [dict(r) for r in c.execute(q, params).fetchall()]


def label_summary():
    """Counts per label across all detections, for the dashboard filter + stats."""
    with connect() as c:
        rows = c.execute(
            "SELECT label, COUNT(*) n, MAX(ts) last_seen FROM detections GROUP BY label ORDER BY n DESC"
        ).fetchall()
        return [dict(r) for r in rows]


# --- Alert rules -----------------------------------------------------------
def add_rule(label, min_conf=0.5, start_hour=None, end_hour=None):
    with connect() as c:
        cur = c.execute(
            "INSERT INTO alert_rules (label, min_conf, start_hour, end_hour, active, created) "
            "VALUES (?,?,?,?,1,?)",
            (label, min_conf, start_hour, end_hour, time.time()),
        )
        return cur.lastrowid


def list_rules():
    with connect() as c:
        return [dict(r) for r in c.execute("SELECT * FROM alert_rules ORDER BY created DESC").fetchall()]


def set_rule_active(rule_id, active):
    with connect() as c:
        c.execute("UPDATE alert_rules SET active=? WHERE id=?", (1 if active else 0, rule_id))


def delete_rule(rule_id):
    with connect() as c:
        c.execute("DELETE FROM alert_rules WHERE id=?", (rule_id,))


# --- Alerts ----------------------------------------------------------------
def insert_alert(rule_id, label, confidence, message, snapshot):
    with connect() as c:
        c.execute(
            "INSERT INTO alerts (ts, rule_id, label, confidence, message, snapshot) VALUES (?,?,?,?,?,?)",
            (time.time(), rule_id, label, confidence, message, snapshot),
        )


def recent_alerts(limit=100, since=None):
    q = "SELECT * FROM alerts"
    params = []
    if since is not None:
        q += " WHERE ts > ?"
        params.append(since)
    q += " ORDER BY ts DESC LIMIT ?"
    params.append(limit)
    with connect() as c:
        return [dict(r) for r in c.execute(q, params).fetchall()]


# --- Settings --------------------------------------------------------------
def get_setting(key, default=None):
    with connect() as c:
        row = c.execute("SELECT value FROM settings WHERE key=?", (key,)).fetchone()
        return row["value"] if row else default


def set_setting(key, value):
    with connect() as c:
        c.execute(
            "INSERT INTO settings (key, value) VALUES (?, ?) "
            "ON CONFLICT(key) DO UPDATE SET value=excluded.value",
            (key, str(value)),
        )


# --- Pinned (kept) snapshots ----------------------------------------------
def set_kept(snapshot, kept, note=None):
    with connect() as c:
        if kept:
            row = c.execute("SELECT ts FROM detections WHERE snapshot=? LIMIT 1", (snapshot,)).fetchone()
            ts = row["ts"] if row else 0.0
            c.execute(
                "INSERT OR REPLACE INTO kept_snapshots (snapshot, ts, note) VALUES (?,?,?)",
                (snapshot, ts, note),
            )
        else:
            c.execute("DELETE FROM kept_snapshots WHERE snapshot=?", (snapshot,))


def is_kept(snapshot):
    with connect() as c:
        return c.execute("SELECT 1 FROM kept_snapshots WHERE snapshot=?", (snapshot,)).fetchone() is not None


def list_kept():
    with connect() as c:
        return {r["snapshot"] for r in c.execute("SELECT snapshot FROM kept_snapshots").fetchall()}


def delete_snapshot(snapshot):
    """Delete a snapshot everywhere: its detection rows, alert refs, pin, and file."""
    with connect() as c:
        c.execute("DELETE FROM detections WHERE snapshot=?", (snapshot,))
        c.execute("DELETE FROM kept_snapshots WHERE snapshot=?", (snapshot,))
        c.execute("UPDATE alerts SET snapshot=NULL WHERE snapshot=?", (snapshot,))
    path = config.SNAPSHOT_DIR / snapshot
    if path.exists() and ".." not in snapshot and "/" not in snapshot:
        try:
            path.unlink()
        except OSError:
            pass


# --- Cleanup / retention ---------------------------------------------------
def cleanup(retention_days):
    """Delete detections & alerts older than `retention_days`, plus any snapshot
    files no longer referenced — EXCEPT snapshots the user pinned (kept). Returns
    a summary dict. retention_days <= 0 means 'keep forever' (no-op)."""
    if not retention_days or retention_days <= 0:
        return {"skipped": True}

    import os
    import time as _time

    cutoff = _time.time() - retention_days * 86400
    with connect() as c:
        # rows older than cutoff, but never touch pinned snapshots
        det = c.execute(
            "DELETE FROM detections WHERE ts < ? AND (snapshot IS NULL OR "
            "snapshot NOT IN (SELECT snapshot FROM kept_snapshots))", (cutoff,)
        ).rowcount
        alr = c.execute(
            "DELETE FROM alerts WHERE ts < ? AND (snapshot IS NULL OR "
            "snapshot NOT IN (SELECT snapshot FROM kept_snapshots))", (cutoff,)
        ).rowcount
        # snapshots still referenced or pinned must be preserved
        referenced = set()
        for tbl in ("detections", "alerts", "kept_snapshots"):
            for r in c.execute(f"SELECT DISTINCT snapshot FROM {tbl} WHERE snapshot IS NOT NULL"):
                referenced.add(r["snapshot"])

    # remove orphaned image files on disk
    removed_files = 0
    if config.SNAPSHOT_DIR.exists():
        for f in config.SNAPSHOT_DIR.iterdir():
            if f.name not in referenced:
                try:
                    f.unlink()
                    removed_files += 1
                except OSError:
                    pass
    return {"detections_deleted": det, "alerts_deleted": alr, "files_deleted": removed_files}
