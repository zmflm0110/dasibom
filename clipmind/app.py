"""ClipMind desktop app: background clipboard capture + a native window
rendering the Notion-style web UI (clipmind/webui/).

    python3 -m clipmind.app
"""
import threading
import time

import webview
from AppKit import NSPasteboard

from . import store
from .monitor import poll_tick
from .webapp import run as run_flask
from . import understander

PORT = 8765


def _capture_loop():
    conn = store.connect()
    pb = NSPasteboard.generalPasteboard()
    last_change_count = pb.changeCount()
    while True:
        last_change_count = poll_tick(pb, conn, last_change_count, verbose=False)
        time.sleep(0.5)


def main():
    threading.Thread(target=_capture_loop, daemon=True).start()
    threading.Thread(target=run_flask, kwargs={"port": PORT}, daemon=True).start()
    understander.start(verbose=True)
    time.sleep(0.4)  # give Flask a moment to bind before pointing the window at it

    webview.create_window(
        "ClipMind",
        f"http://127.0.0.1:{PORT}/",
        width=1000,
        height=680,
        min_size=(760, 480),
        background_color="#ffffff",
    )
    webview.start()


if __name__ == "__main__":
    main()
