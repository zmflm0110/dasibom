"""Clipboard monitor daemon: polls NSPasteboard for changes and stores classified clips."""
import time
import sys

from AppKit import NSPasteboard, NSWorkspace, NSStringPboardType, NSPasteboardTypeString

from . import store
from .classifier import classify

POLL_INTERVAL = 0.5


def _read_pasteboard_string(pb) -> str | None:
    try:
        s = pb.stringForType_(NSPasteboardTypeString)
    except Exception:
        s = None
    if s is None:
        try:
            s = pb.stringForType_(NSStringPboardType)
        except Exception:
            s = None
    return str(s) if s is not None else None


def _frontmost_app_name() -> str | None:
    try:
        app = NSWorkspace.sharedWorkspace().frontmostApplication()
        if app is None:
            return None
        return str(app.localizedName())
    except Exception:
        return None


def run(poll_interval: float = POLL_INTERVAL, max_iterations: int | None = None, verbose: bool = True):
    conn = store.connect()
    pb = NSPasteboard.generalPasteboard()
    last_change_count = pb.changeCount()

    if verbose:
        print(f"[clipmind] monitoring started (poll={poll_interval}s, db={store.DB_PATH})", flush=True)

    iterations = 0
    try:
        while True:
            cc = pb.changeCount()
            if cc != last_change_count:
                last_change_count = cc
                text = _read_pasteboard_string(pb)
                if text:
                    category, subtype = classify(text)
                    app_name = _frontmost_app_name()
                    new_id = store.add_clip(conn, text, category, subtype, app_name)
                    if verbose and new_id:
                        preview = text.replace("\n", " ")[:60]
                        print(f"[clipmind] #{new_id} [{category}{'/' + subtype if subtype else ''}] "
                              f"({app_name}) {preview!r}", flush=True)
            time.sleep(poll_interval)
            iterations += 1
            if max_iterations is not None and iterations >= max_iterations:
                break
    except KeyboardInterrupt:
        if verbose:
            print("\n[clipmind] stopped", flush=True)
    finally:
        conn.close()


if __name__ == "__main__":
    run()
