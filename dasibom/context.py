"""Context-aware suggestion: use the current frontmost app (+ optional free-text
description of what the user is doing) to surface the most relevant past clips.

This is intentionally simple: it doesn't read editor file contents (that needs
per-editor integration / accessibility permissions, out of scope for the MVP).
It uses the frontmost app name as a coarse signal for what "kind" of work is
happening, then runs semantic search scoped to the clip category that matches.
"""
import re
from typing import Optional

from AppKit import NSWorkspace
import Quartz

from .search import semantic_search
from . import store

CODE_APPS = {
    "Xcode", "Visual Studio Code", "Code", "Cursor", "PyCharm", "PyCharm CE",
    "IntelliJ IDEA", "Terminal", "iTerm2", "iTerm", "Sublime Text", "Vim",
    "WebStorm", "CLion", "Android Studio",
}
WRITING_APPS = {
    "Pages", "Notes", "TextEdit", "Mail", "Microsoft Word", "Notion", "Bear",
}

# Extension -> our classifier's `subtype` vocabulary (see classifier.py CODE_SIGNALS).
EXT_LANG = {
    ".py": "python", ".js": "javascript", ".jsx": "javascript", ".mjs": "javascript",
    ".ts": "javascript", ".tsx": "javascript", ".html": "html", ".htm": "html",
    ".css": "css", ".sql": "sql", ".sh": "shell", ".bash": "shell", ".zsh": "shell",
    ".json": "json",
}

_TITLE_SPLIT_RE = re.compile(r"\s+[—–]\s+")  # " — " / " – " (VS Code / Xcode style)


def frontmost_app_name() -> Optional[str]:
    try:
        app = NSWorkspace.sharedWorkspace().frontmostApplication()
        return str(app.localizedName()) if app else None
    except Exception:
        return None


def _list_onscreen_windows():
    """Seam for testing: wraps the raw Quartz call so tests can monkeypatch it."""
    return Quartz.CGWindowListCopyWindowInfo(
        Quartz.kCGWindowListOptionOnScreenOnly | Quartz.kCGWindowListExcludeDesktopElements,
        Quartz.kCGNullWindowID,
    )


def frontmost_window_title(app_name: Optional[str]) -> Optional[str]:
    """Best-effort: the title of the given app's frontmost on-screen window.

    Used only to infer *what kind* of file is open (via its extension) -- never
    stored, logged, or sent anywhere. Falls back to None if unavailable (e.g.
    Screen Recording permission not granted, or the app has no titled window).
    """
    if not app_name:
        return None
    try:
        windows = _list_onscreen_windows()
    except Exception:
        return None
    for w in windows:
        if w.get("kCGWindowOwnerName") == app_name and w.get("kCGWindowLayer") == 0:
            title = w.get("kCGWindowName")
            if title:
                return str(title)
    return None


def infer_language_from_title(title: Optional[str]) -> Optional[str]:
    """Pull a likely open filename's language out of an editor window title."""
    if not title:
        return None
    first_segment = _TITLE_SPLIT_RE.split(title)[0].strip().lstrip("●").strip()
    for ext, lang in EXT_LANG.items():
        if first_segment.lower().endswith(ext):
            return lang
    return None


def infer_context_category(app_name: Optional[str]) -> Optional[str]:
    if app_name in CODE_APPS:
        return "code"
    if app_name in WRITING_APPS:
        return None  # writing apps: don't over-restrict, search across all text
    return None


def _recent_code_prioritized_by_language(conn, language: Optional[str], top_k: int):
    rows = store.list_clips(conn, limit=max(top_k * 4, 20), category="code")
    if not language:
        return rows[:top_k]
    same_lang = [r for r in rows if r["subtype"] == language]
    others = [r for r in rows if r["subtype"] != language]
    return (same_lang + others)[:top_k]


def suggest(conn, query: Optional[str] = None, top_k: int = 5):
    """Return (app_name, category_filter, results, language) for the current context.

    `language` is the file-extension-inferred language of the frontmost editor
    window (e.g. "python"), when we could tell -- used to prioritize same-language
    code clips over generic recency when no explicit query is given.
    """
    app_name = frontmost_app_name()
    category = infer_context_category(app_name)
    window_title = frontmost_window_title(app_name)
    language = infer_language_from_title(window_title) if category == "code" else None

    if query:
        results = semantic_search(conn, query, top_k=top_k, category=category)
    elif category == "code" and language:
        results = [(r, 1.0) for r in _recent_code_prioritized_by_language(conn, language, top_k)]
    elif category:
        results = [(r, 1.0) for r in store.list_clips(conn, limit=top_k, category=category)]
    else:
        results = [(r, 1.0) for r in store.list_clips(conn, limit=top_k)]

    return app_name, category, results, language
