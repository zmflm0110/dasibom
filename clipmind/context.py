"""Context-aware suggestion: use the current frontmost app (+ optional free-text
description of what the user is doing) to surface the most relevant past clips.

This is intentionally simple: it doesn't read editor file contents (that needs
per-editor integration / accessibility permissions, out of scope for the MVP).
It uses the frontmost app name as a coarse signal for what "kind" of work is
happening, then runs semantic search scoped to the clip category that matches.
"""
from typing import Optional

from AppKit import NSWorkspace

from .search import semantic_search

CODE_APPS = {
    "Xcode", "Visual Studio Code", "Code", "Cursor", "PyCharm", "PyCharm CE",
    "IntelliJ IDEA", "Terminal", "iTerm2", "iTerm", "Sublime Text", "Vim",
    "WebStorm", "CLion", "Android Studio",
}
WRITING_APPS = {
    "Pages", "Notes", "TextEdit", "Mail", "Microsoft Word", "Notion", "Bear",
}


def frontmost_app_name() -> Optional[str]:
    try:
        app = NSWorkspace.sharedWorkspace().frontmostApplication()
        return str(app.localizedName()) if app else None
    except Exception:
        return None


def infer_context_category(app_name: Optional[str]) -> Optional[str]:
    if app_name in CODE_APPS:
        return "code"
    if app_name in WRITING_APPS:
        return None  # writing apps: don't over-restrict, search across all text
    return None


def suggest(conn, query: Optional[str] = None, top_k: int = 5):
    """Return (app_name, category_filter, results) for the current context."""
    app_name = frontmost_app_name()
    category = infer_context_category(app_name)

    if query:
        results = semantic_search(conn, query, top_k=top_k, category=category)
    elif category:
        # No explicit query: just surface the most recent clips in this category.
        from . import store
        rows = store.list_clips(conn, limit=top_k, category=category)
        results = [(r, 1.0) for r in rows]
    else:
        from . import store
        rows = store.list_clips(conn, limit=top_k)
        results = [(r, 1.0) for r in rows]

    return app_name, category, results
