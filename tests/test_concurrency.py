"""Can the background understander and incoming uploads write at the same time?

The app runs three writers against one SQLite file: Flask request handlers
(uploads, deletes), the understander worker (a write every ~2 seconds), and the
optional clipboard monitor. SQLite serializes writers with a lock, and the
default failure mode is a hard "database is locked" error rather than a wait.
A 50-screenshot import happening while the worker chews through the backlog is
exactly when that would bite.
"""
import sys
import tempfile
import threading
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from dasibom import store

DURATION_SECONDS = 6
WRITER_THREADS = 4

errors: list[str] = []
counts = {"writes": 0}
lock = threading.Lock()


def writer(db_path: Path, name: str, stop: threading.Event):
    """Each thread opens its own connection -- sqlite3 objects can't cross threads."""
    conn = store.connect(db_path)
    i = 0
    while not stop.is_set():
        try:
            clip_id = store.add_clip(conn, f"{name} 클립 {i}", "image", None, name,
                                     f"images/{name}_{i}.png")
            if clip_id:
                store.save_understanding(conn, clip_id, "테스트", f"{name} 요약 {i}", ["태그"])
                store.set_event_date(conn, clip_id, "2026-10-03")
            with lock:
                counts["writes"] += 1
        except Exception as e:
            with lock:
                errors.append(f"{name}: {type(e).__name__}: {e}")
        i += 1


def reader(db_path: Path, stop: threading.Event):
    conn = store.connect(db_path)
    while not stop.is_set():
        try:
            store.list_clips(conn, limit=20)
            store.stats(conn)
            store.distinct_labels(conn)
        except Exception as e:
            with lock:
                errors.append(f"reader: {type(e).__name__}: {e}")
        time.sleep(0.01)


def main():
    db_path = Path(tempfile.mkdtemp()) / "concurrent.db"
    store.connect(db_path).close()

    stop = threading.Event()
    threads = [threading.Thread(target=writer, args=(db_path, f"w{i}", stop), daemon=True)
               for i in range(WRITER_THREADS)]
    threads.append(threading.Thread(target=reader, args=(db_path, stop), daemon=True))

    for t in threads:
        t.start()
    time.sleep(DURATION_SECONDS)
    stop.set()
    for t in threads:
        t.join(timeout=5)

    print(f"{WRITER_THREADS}개 쓰기 스레드 + 1개 읽기 스레드, {DURATION_SECONDS}초")
    print(f"  성공한 쓰기: {counts['writes']}건 ({counts['writes'] / DURATION_SECONDS:.0f}건/초)")
    print(f"  오류: {len(errors)}건")

    locked = [e for e in errors if "locked" in e.lower()]
    if errors:
        for e in errors[:5]:
            print(f"    {e}")
    print()
    if locked:
        print(f"FAIL  'database is locked' {len(locked)}건 — 동시 쓰기에서 실패함")
        return 1
    if errors:
        print(f"FAIL  다른 오류 {len(errors)}건")
        return 1
    print("PASS  동시 쓰기/읽기 중 오류 없음")

    conn = store.connect(db_path)
    total = conn.execute("SELECT COUNT(*) c FROM clips").fetchone()["c"]
    print(f"PASS  최종 {total}건 저장 (유실 없음)" if total == counts["writes"]
          else f"FAIL  저장된 건수 불일치: {total} != {counts['writes']}")
    return 0 if total == counts["writes"] else 1


if __name__ == "__main__":
    sys.exit(main())
