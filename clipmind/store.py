"""SQLite storage layer for clipboard items."""
import sqlite3
import hashlib
import time
from pathlib import Path
from typing import Optional

DB_PATH = Path(__file__).resolve().parent.parent / "data" / "clipboard.db"

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
    embedding BLOB
);
CREATE INDEX IF NOT EXISTS idx_clips_hash ON clips(content_hash);
CREATE INDEX IF NOT EXISTS idx_clips_category ON clips(category);
CREATE INDEX IF NOT EXISTS idx_clips_created ON clips(created_at);
"""


def connect(db_path: Path = DB_PATH) -> sqlite3.Connection:
    db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    conn.executescript(SCHEMA)
    cols = {row["name"] for row in conn.execute("PRAGMA table_info(clips)")}
    if "embedding" not in cols:
        conn.execute("ALTER TABLE clips ADD COLUMN embedding BLOB")
        conn.commit()
    return conn


def update_embedding(conn: sqlite3.Connection, clip_id: int, blob: bytes) -> None:
    conn.execute("UPDATE clips SET embedding = ? WHERE id = ?", (blob, clip_id))
    conn.commit()


def delete_clip(conn: sqlite3.Connection, clip_id: int) -> bool:
    cur = conn.execute("DELETE FROM clips WHERE id = ?", (clip_id,))
    conn.commit()
    return cur.rowcount > 0


def content_hash(content: str) -> str:
    return hashlib.sha256(content.encode("utf-8")).hexdigest()


def add_clip(
    conn: sqlite3.Connection,
    content: str,
    category: str,
    subtype: Optional[str] = None,
    source_app: Optional[str] = None,
) -> Optional[int]:
    """Insert a clip. Skips exact duplicate of the most recent clip. Returns new row id, or None if skipped."""
    h = content_hash(content)
    row = conn.execute(
        "SELECT content_hash FROM clips ORDER BY id DESC LIMIT 1"
    ).fetchone()
    if row is not None and row["content_hash"] == h:
        return None
    cur = conn.execute(
        "INSERT INTO clips (content, content_hash, category, subtype, source_app, created_at, char_count) "
        "VALUES (?, ?, ?, ?, ?, ?, ?)",
        (content, h, category, subtype, source_app, time.time(), len(content)),
    )
    conn.commit()
    return cur.lastrowid


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
