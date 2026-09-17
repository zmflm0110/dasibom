"""Background worker that reads pending clips with the local LLM.

Kept off the upload path on purpose: ingesting a screenshot (save + OCR) takes
~0.12s, while the LLM takes seconds. Blocking uploads on understanding would
turn a 50-screenshot import from 6 seconds into minutes of a frozen picker.
So uploads land immediately and this fills in label/summary/tags afterwards,
which the UI polls and shows as it arrives.
"""
import threading
import time

from . import store, topics, understand

IDLE_SLEEP_SECONDS = 3.0
BATCH_SIZE = 4


def process_batch(conn, limit: int = BATCH_SIZE, verbose: bool = False) -> int:
    """Understand up to `limit` pending clips. Returns how many were processed."""
    rows = store.pending_understanding(conn, limit=limit)
    if not rows:
        return 0

    known_labels = store.distinct_labels(conn)
    processed = 0
    for row in rows:
        try:
            result = understand.understand(row["content"], existing_labels=known_labels)
        except Exception as e:
            if verbose:
                print(f"[understander] #{row['id']} 실패: {type(e).__name__}", flush=True)
            store.mark_understanding_failed(conn, row["id"])
            continue

        if not result:
            # LLM failed validation twice -- fall back to the rule layer so the
            # clip still gets *a* label instead of showing up unclassified.
            fallback_topic, confidence = topics.classify_topic(row["content"])
            if fallback_topic != topics.OTHER[0]:
                store.save_understanding(conn, row["id"], topics.display_name(fallback_topic), "", [])
                processed += 1
                if verbose:
                    print(f"[understander] #{row['id']} 규칙 폴백 [{topics.display_name(fallback_topic)}]", flush=True)
            else:
                store.mark_understanding_failed(conn, row["id"])
            continue

        label = understand.canonicalize(result["label"], known_labels)
        if label not in known_labels:
            known_labels.append(label)
        store.save_understanding(conn, row["id"], label, result["summary"], result["tags"])
        processed += 1
        if verbose:
            print(f"[understander] #{row['id']} [{label}] {result['summary'][:40]}", flush=True)

    return processed


def run_forever(verbose: bool = False):
    if not understand.is_available():
        if verbose:
            print("[understander] mlx-lm 없음 — 이해 단계 건너뜀", flush=True)
        return
    conn = store.connect()
    while True:
        try:
            if process_batch(conn, verbose=verbose) == 0:
                time.sleep(IDLE_SLEEP_SECONDS)
        except Exception as e:
            if verbose:
                print(f"[understander] 루프 오류: {type(e).__name__}", flush=True)
            time.sleep(IDLE_SLEEP_SECONDS)


def start(verbose: bool = False) -> threading.Thread:
    thread = threading.Thread(target=run_forever, kwargs={"verbose": verbose}, daemon=True)
    thread.start()
    return thread
