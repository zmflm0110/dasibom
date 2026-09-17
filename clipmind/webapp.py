"""Flask backend serving the ClipMind web UI (static assets + JSON API).

Runs entirely on localhost, no external network calls. Meant to be embedded
in a pywebview native window (see app.py) or opened directly in a browser
for development (`python3 -m clipmind.webapp`).
"""
from pathlib import Path

from flask import Flask, jsonify, request, send_from_directory
from AppKit import NSPasteboard, NSPasteboardTypeString

from . import store
from .search import semantic_search, keyword_search
from .combine import combine_clips
from .context import suggest as context_suggest

WEBUI_DIR = Path(__file__).resolve().parent / "webui"

app = Flask(__name__, static_folder=str(WEBUI_DIR / "static"), static_url_path="/static")


def _row_to_dict(row) -> dict:
    return {
        "id": row["id"],
        "content": row["content"],
        "category": row["category"],
        "subtype": row["subtype"],
        "source_app": row["source_app"],
        "created_at": row["created_at"],
        "char_count": row["char_count"],
    }


@app.get("/")
def index():
    return send_from_directory(str(WEBUI_DIR), "index.html")


@app.get("/api/clips")
def api_clips():
    conn = store.connect()
    category = request.args.get("category") or None
    limit = int(request.args.get("limit", 100))
    rows = store.list_clips(conn, limit=limit, category=category)
    return jsonify([_row_to_dict(r) for r in rows])


@app.get("/api/search")
def api_search():
    conn = store.connect()
    query = request.args.get("q", "").strip()
    category = request.args.get("category") or None
    top_k = int(request.args.get("top_k", 30))
    if not query:
        return jsonify([])
    if request.args.get("keyword") == "1":
        rows = keyword_search(conn, query, limit=top_k)
        return jsonify([{**_row_to_dict(r), "score": None} for r in rows])
    results = semantic_search(conn, query, top_k=top_k, category=category)
    return jsonify([{**_row_to_dict(r), "score": round(score, 3)} for r, score in results])


@app.get("/api/suggest")
def api_suggest():
    conn = store.connect()
    query = request.args.get("q") or None
    top_k = int(request.args.get("top_k", 8))
    app_name, category, results = context_suggest(conn, query=query, top_k=top_k)
    return jsonify({
        "app_name": app_name,
        "category": category,
        "results": [{**_row_to_dict(r), "score": round(score, 3)} for r, score in results],
    })


@app.get("/api/stats")
def api_stats():
    conn = store.connect()
    return jsonify(store.stats(conn))


@app.post("/api/combine")
def api_combine():
    conn = store.connect()
    ids = request.get_json(force=True).get("ids", [])
    text = combine_clips(conn, ids)
    pb = NSPasteboard.generalPasteboard()
    pb.clearContents()
    pb.setString_forType_(text, NSPasteboardTypeString)
    return jsonify({"text": text})


@app.post("/api/copy/<int:clip_id>")
def api_copy(clip_id):
    conn = store.connect()
    row = store.get_clip(conn, clip_id)
    if not row:
        return jsonify({"ok": False}), 404
    pb = NSPasteboard.generalPasteboard()
    pb.clearContents()
    pb.setString_forType_(row["content"], NSPasteboardTypeString)
    return jsonify({"ok": True})


@app.delete("/api/clips/<int:clip_id>")
def api_delete(clip_id):
    conn = store.connect()
    ok = store.delete_clip(conn, clip_id)
    return jsonify({"ok": ok})


def run(port: int = 8765, debug: bool = False):
    app.run(host="127.0.0.1", port=port, debug=debug, use_reloader=False)


if __name__ == "__main__":
    run(debug=True)
