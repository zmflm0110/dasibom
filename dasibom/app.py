"""다시봄 — 찍어두고 잊은 것을 다시 꺼내주는 앱.

    python3 -m dasibom.app

Runs three things in one process: the local web server, the native window that
renders it, and the background worker that reads new screenshots with the local
LLM. Clipboard capture is off by default -- see CAPTURE_CLIPBOARD.
"""
import os
import threading
import time

import webview
from AppKit import NSPasteboard

from . import store
from .monitor import poll_tick
from .webapp import run as run_flask
from . import understander

PORT = 8765
APP_NAME = "다시봄"

# Opt-in, not default. This started as a clipboard tool, but the product is about
# screenshots now, and an app that silently records everything you copy is not
# something a screenshot app should do without being asked. Set DASIBOM_CLIPBOARD=1
# to turn the old behavior back on.
CAPTURE_CLIPBOARD = os.environ.get("DASIBOM_CLIPBOARD") == "1"


def _capture_loop():
    conn = store.connect()
    pb = NSPasteboard.generalPasteboard()
    last_change_count = pb.changeCount()
    while True:
        last_change_count = poll_tick(pb, conn, last_change_count, verbose=False)
        time.sleep(0.5)


def main():
    if CAPTURE_CLIPBOARD:
        threading.Thread(target=_capture_loop, daemon=True).start()
        print("[다시봄] 클립보드 감시 켜짐 (DASIBOM_CLIPBOARD=1)", flush=True)

    threading.Thread(target=run_flask, kwargs={"port": PORT}, daemon=True).start()
    understander.start(verbose=True)
    time.sleep(0.4)  # give Flask a moment to bind before pointing the window at it

    webview.create_window(
        APP_NAME,
        f"http://127.0.0.1:{PORT}/",
        width=1000,
        height=680,
        min_size=(760, 480),
        background_color="#ffffff",
    )
    webview.start()


if __name__ == "__main__":
    main()
