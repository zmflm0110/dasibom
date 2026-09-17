"""SQLite storage layer for clipboard items."""
import json
import sqlite3
import hashlib
import time
from pathlib import Path
from typing import Optional

DB_PATH = Path(__file__).resolve().parent.parent / "data" / "dasibom.db"
IMAGES_DIR = DB_PATH.parent / "images"

SCHEMA = """
CREATE TABLE IF NOT EXISTS clips (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    content TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    category TEXT NOT NULL,
    subtype TEXT,
    source_app TEXT,
    created_at REAL NOT NULL,
    char_count INTEGER NOT NULL,
    embedding BLOB,
    image_path TEXT,
    last_surfaced_at REAL,
    topic TEXT,
    label TEXT,
    summary TEXT,
    tags TEXT,
    understood_at REAL,
    event_date TEXT
);
CREATE INDEX IF NOT EXISTS idx_clips_hash ON clips(content_hash);
CREATE INDEX IF NOT EXISTS idx_clips_category ON clips(category);
CREATE INDEX IF NOT EXISTS idx_clips_created ON clips(created_at);

CREATE TABLE IF NOT EXISTS meta (
    key TEXT PRIMARY KEY,
    value TEXT
);
"""

# Columns added after the initial release -- kept as a list so connect() can
# migrate existing databases in place instead of requiring a fresh one.
_MIGRATIONS = [
    ("embedding", "BLOB"),
    ("image_path", "TEXT"),
    ("last_surfaced_at", "REAL"),
    ("topic", "TEXT"),
    ("label", "TEXT"),
    ("summary", "TEXT"),
    ("tags", "TEXT"),
    ("understood_at", "REAL"),
    ("event_date", "TEXT"),
]


def connect(db_path: Path = DB_PATH) -> sqlite3.Connection:
    db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(db_path), timeout=30.0)
    conn.row_factory = sqlite3.Row

    # Three writers share this file: Flask handlers, the understander worker
    # (a write every ~2s), and the clipboard monitor. Measured on the default
    # rollback journal, four concurrent writers produced 183k "database is
    # locked" errors in 6 seconds -- a bulk import while the worker runs would
    # have silently dropped screenshots.
    #   WAL           readers no longer block the writer, and vice versa
    #   busy_timeout  wait for the lock instead of failing instantly
    #   NORMAL sync   safe under WAL, and much faster than FULL
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA busy_timeout=30000")
    conn.execute("PRAGMA synchronous=NORMAL")

    conn.executescript(SCHEMA)
    cols = {row["name"] for row in conn.execute("PRAGMA table_info(clips)")}
    for name, sql_type in _MIGRATIONS:
        if name not in cols:
            conn.execute(f"ALTER TABLE clips ADD COLUMN {name} {sql_type}")
    conn.commit()
    return conn


def get_meta(conn: sqlite3.Connection, key: str) -> Optional[str]:
    row = conn.execute("SELECT value FROM meta WHERE key = ?", (key,)).fetchone()
    return row["value"] if row else None


def set_meta(conn: sqlite3.Connection, key: str, value: str) -> None:
    conn.execute("INSERT INTO meta (key, value) VALUES (?, ?) "
                 "ON CONFLICT(key) DO UPDATE SET value = excluded.value", (key, value))
    conn.commit()


def ensure_embedding_model(conn: sqlite3.Connection, model: str) -> bool:
    """Drop every cached vector when the embedding model changes.

    Different models produce incomparable vectors, and two models can share a
    dimension (both MiniLM and e5-small are 384-d), so a stale cache would mix
    silently into cosine scores instead of failing loudly. Returns True if the
    cache was cleared."""
    previous = get_meta(conn, "embedding_model")
    if previous == model:
        return False
    conn.execute("UPDATE clips SET embedding = NULL WHERE embedding IS NOT NULL")
    set_meta(conn, "embedding_model", model)
    return previous is not None


def update_embedding(conn: sqlite3.Connection, clip_id: int, blob: bytes) -> None:
    conn.execute("UPDATE clips SET embedding = ? WHERE id = ?", (blob, clip_id))
    conn.commit()


def delete_clip(conn: sqlite3.Connection, clip_id: int) -> bool:
    """Delete the row and, when nothing else points at it, the image file too.

    Image filenames are content hashes, so two identical screenshots share one
    file on disk. Deleting unconditionally would blank out the surviving clip's
    thumbnail, so the file only goes when its last referrer does. Without this,
    every delete leaked a file."""
    row = conn.execute("SELECT image_path FROM clips WHERE id = ?", (clip_id,)).fetchone()
    image_path = row["image_path"] if row else None

    cur = conn.execute("DELETE FROM clips WHERE id = ?", (clip_id,))
    conn.commit()
    if cur.rowcount == 0:
        return False

    if image_path:
        still_used = conn.execute(
            "SELECT 1 FROM clips WHERE image_path = ? LIMIT 1", (image_path,)
        ).fetchone()
        if not still_used:
            try:
                (DB_PATH.parent / image_path).unlink(missing_ok=True)
            except OSError:
                pass  # a file we can't remove is a leak, not a failed delete
    return True


def content_hash(content: str) -> str:
    return hashlib.sha256(content.encode("utf-8")).hexdigest()


def add_clip(
    conn: sqlite3.Connection,
    content: str,
    category: str,
    subtype: Optional[str] = None,
    source_app: Optional[str] = None,
    image_path: Optional[str] = None,
    topic: Optional[str] = None,
) -> Optional[int]:
    """Insert a clip. Skips exact duplicate of the most recent clip. Returns new row id, or None if skipped."""
    h = content_hash(content)
    row = conn.execute(
        "SELECT content_hash FROM clips ORDER BY id DESC LIMIT 1"
    ).fetchone()
    if row is not None and row["content_hash"] == h:
        return None
    cur = conn.execute(
        "INSERT INTO clips (content, content_hash, category, subtype, source_app, created_at, char_count, image_path, topic) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (content, h, category, subtype, source_app, time.time(), len(content), image_path, topic),
    )
    conn.commit()
    return cur.lastrowid


def mark_surfaced(conn: sqlite3.Connection, clip_ids: list[int]) -> None:
    now = time.time()
    conn.executemany(
        "UPDATE clips SET last_surfaced_at = ? WHERE id = ?",
        [(now, cid) for cid in clip_ids],
    )
    conn.commit()


def set_event_date(conn: sqlite3.Connection, clip_id: int, iso_date: Optional[str]) -> None:
    conn.execute("UPDATE clips SET event_date = ? WHERE id = ?", (iso_date, clip_id))
    conn.commit()


def upcoming_clips(conn: sqlite3.Connection, today_iso: str, horizon_iso: str, limit: int):
    """Clips whose extracted event date falls between today and the horizon.

    This is the resurface tier that actually earns attention: a reservation two
    days out is worth interrupting for, a random old screenshot is not."""
    return conn.execute(
        "SELECT * FROM clips WHERE event_date IS NOT NULL AND event_date >= ? AND event_date <= ? "
        "ORDER BY event_date ASC LIMIT ?",
        (today_iso, horizon_iso, limit),
    ).fetchall()


def resurface_candidates(conn: sqlite3.Connection, category: str, min_age_seconds: float,
                         limit: int, today_iso: Optional[str] = None):
    """Fallback tier: old clips that aren't an upcoming event right now.

    Includes clips whose date has already passed. They used to fall through a
    gap -- the upcoming tier wanted event_date >= today, this one wanted
    event_date IS NULL -- so a screenshot with a date became permanently
    invisible to the nudge the day after its event. Over months that dead zone
    only grows, and it's exactly the "찍어두고 잊은" case the feature exists for.

    Oldest-surfaced first, so the same few images don't keep coming back."""
    cutoff = time.time() - min_age_seconds
    today_iso = today_iso or time.strftime("%Y-%m-%d")
    return conn.execute(
        "SELECT * FROM clips WHERE category = ? AND created_at < ? "
        "AND (event_date IS NULL OR event_date < ?) "
        "ORDER BY last_surfaced_at IS NOT NULL, last_surfaced_at ASC, RANDOM() LIMIT ?",
        (category, cutoff, today_iso, limit),
    ).fetchall()


def list_clips(conn: sqlite3.Connection, limit: int = 20, category: Optional[str] = None):
    if category:
        cur = conn.execute(
            "SELECT * FROM clips WHERE category = ? ORDER BY id DESC LIMIT ?",
            (category, limit),
        )
    else:
        cur = conn.execute("SELECT * FROM clips ORDER BY id DESC LIMIT ?", (limit,))
    return cur.fetchall()


def get_clip(conn: sqlite3.Connection, clip_id: int):
    return conn.execute("SELECT * FROM clips WHERE id = ?", (clip_id,)).fetchone()


def get_clips_by_ids(conn: sqlite3.Connection, ids: list[int]):
    q = f"SELECT * FROM clips WHERE id IN ({','.join('?' for _ in ids)})"
    rows = conn.execute(q, ids).fetchall()
    by_id = {r["id"]: r for r in rows}
    return [by_id[i] for i in ids if i in by_id]


def all_clips(conn: sqlite3.Connection):
    return conn.execute("SELECT * FROM clips ORDER BY id ASC").fetchall()


def stats(conn: sqlite3.Connection) -> dict:
    total = conn.execute("SELECT COUNT(*) c FROM clips").fetchone()["c"]
    by_cat = conn.execute(
        "SELECT category, COUNT(*) c FROM clips GROUP BY category ORDER BY c DESC"
    ).fetchall()
    return {"total": total, "by_category": {r["category"]: r["c"] for r in by_cat}}


def pending_understanding(conn: sqlite3.Connection, limit: int = 20):
    """Clips the local LLM hasn't read yet. Screenshots first -- they're the ones
    whose OCR text is meaningless to a human scanning a list."""
    return conn.execute(
        "SELECT * FROM clips WHERE understood_at IS NULL AND content != '(텍스트 없는 이미지)' "
        "ORDER BY (category = 'image') DESC, id DESC LIMIT ?",
        (limit,),
    ).fetchall()


def save_understanding(conn: sqlite3.Connection, clip_id: int, label: str,
                       summary: str, tags: list[str]) -> None:
    conn.execute(
        # embedding = NULL: the summary just arrived, so the cached vector was
        # built from raw OCR only and is now stale.
        "UPDATE clips SET label = ?, summary = ?, tags = ?, understood_at = ?, embedding = NULL WHERE id = ?",
        (label, summary, json.dumps(tags, ensure_ascii=False), time.time(), clip_id),
    )
    conn.commit()


def mark_understanding_failed(conn: sqlite3.Connection, clip_id: int) -> None:
    """Stamp it so a clip the model can't parse doesn't jam the queue forever."""
    conn.execute("UPDATE clips SET understood_at = ? WHERE id = ?", (time.time(), clip_id))
    conn.commit()


def distinct_labels(conn: sqlite3.Connection) -> list[str]:
    rows = conn.execute(
        "SELECT label, COUNT(*) c FROM clips WHERE label IS NOT NULL AND label != '' "
        "GROUP BY label ORDER BY c DESC"
    ).fetchall()
    return [r["label"] for r in rows]
