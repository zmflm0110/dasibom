import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from dasibom.context import infer_language_from_title, infer_context_category, frontmost_window_title
import dasibom.context as context_mod

cases = [
    ("app.py — ClipMind", "python"),
    ("● app.py — ClipMind", "python"),
    ("index.js — my-project", "javascript"),
    ("styles.css — my-project", "css"),
    ("my-file-with-dashes.py — repo", "python"),  # hyphens inside filename must not confuse the splitter
    ("README.md — repo", None),
    (None, None),
    ("no separator here.py", "python"),
]

results = []
for title, expected in cases:
    got = infer_language_from_title(title)
    ok = got == expected
    results.append(ok)
    print(f"{'PASS' if ok else 'FAIL'}  title={title!r} got={got!r} expected={expected!r}")

assert infer_context_category("Visual Studio Code") == "code"
assert infer_context_category("Safari") is None
print("PASS  infer_context_category")

# frontmost_window_title seam: monkeypatch the Quartz-wrapping function
context_mod._list_onscreen_windows = lambda: [
    {"kCGWindowOwnerName": "Visual Studio Code", "kCGWindowLayer": 0, "kCGWindowName": "app.py — ClipMind"},
    {"kCGWindowOwnerName": "Dock", "kCGWindowLayer": 0, "kCGWindowName": ""},
]
title = frontmost_window_title("Visual Studio Code")
assert title == "app.py — ClipMind", f"got {title!r}"
print("PASS  frontmost_window_title picks the matching app's window")

assert frontmost_window_title("Nonexistent App") is None
print("PASS  frontmost_window_title returns None when no window matches")

total, passed = len(results) + 4, sum(results) + 4
print(f"\n{passed}/{total} passed")
if passed != total:
    sys.exit(1)
