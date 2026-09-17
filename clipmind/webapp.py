"""Flask backend serving the ClipMind web UI (static assets + JSON API).

Runs on all interfaces (0.0.0.0) so a phone on the same WiFi can reach it too,
but never calls out anywhere itself. The desktop app (pywebview, always on
127.0.0.1) is trusted implicitly; any other device must pair with a PIN first
-- see pairing.py.
"""
import io
import socket
from pathlib import Path

from flask import Flask, Response, jsonify, request, send_from_directory
from AppKit import NSPasteboard, NSPasteboardTypeString

from . import store
from .search import semantic_search, keyword_search
from .combine import combine_clips
from .context import suggest as context_suggest
from .pairing import Pairing

WEBUI_DIR = Path(__file__).resolve().parent / "webui"
PORT = 8765
TRUSTED_LOCAL_ADDRS = {"127.0.0.1", "::1"}

app = Flask(__name__, static_folder=str(WEBUI_DIR / "static"), static_url_path="/static")
pairing = Pairing()


def lan_ip() -> str:
    """Best-effort LAN IP for this Mac, for the phone-pairing QR code.
    Opens no real connection -- a UDP "connect" just asks the OS which local
    interface would be used to route to 8.8.8.8, without sending a packet."""
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("8.8.8.8", 80))
        return s.getsockname()[0]
    except Exception:
        return "127.0.0.1"
    finally:
        s.close()


def _is_trusted_request() -> bool:
    if request.remote_addr in TRUSTED_LOCAL_ADDRS:
        return True
    auth = request.headers.get("Authorization", "")
    token = auth[len("Bearer "):] if auth.startswith("Bearer ") else None
    return pairing.is_valid_token(token)


@app.before_request
def _gate_api_access():
    if request.path.startswith("/api/") and request.path not in ("/api/pair",):
        if not _is_trusted_request():
            return jsonify({"error": "pairing_required"}), 401
    return None


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
    app_name, category, results, language = context_suggest(conn, query=query, top_k=top_k)
    return jsonify({
        "app_name": app_name,
        "category": category,
        "language": language,
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


@app.post("/api/pair")
def api_pair():
    data = request.get_json(force=True, silent=True) or {}
    token = pairing.try_pair(str(data.get("pin", "")), request.remote_addr)
    if not token:
        return jsonify({"ok": False}), 401
    return jsonify({"ok": True, "token": token})


@app.get("/api/pair-info")
def api_pair_info():
    """Only the desktop app (localhost) may see the current PIN/URL to show a QR code."""
    if request.remote_addr not in TRUSTED_LOCAL_ADDRS:
        return jsonify({"error": "forbidden"}), 403
    ip = lan_ip()
    return jsonify({
        "pin": pairing.pin,
        "port": PORT,
        "lan_url": f"http://{ip}:{PORT}",
        "hostname_url": f"http://{socket.gethostname().split('.')[0]}.local:{PORT}",
    })


@app.get("/api/qr.png")
def api_qr():
    if request.remote_addr not in TRUSTED_LOCAL_ADDRS:
        return Response(status=403)
    import qrcode

    url = f"http://{lan_ip()}:{PORT}/?pin={pairing.pin}"
    img = qrcode.make(url, border=2)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return Response(buf.getvalue(), mimetype="image/png")


def run(port: int = PORT, debug: bool = False, host: str = "0.0.0.0"):
    app.run(host=host, port=port, debug=debug, use_reloader=False)


if __name__ == "__main__":
    run(debug=True, host="127.0.0.1")
