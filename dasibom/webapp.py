"""Flask backend serving the ClipMind web UI (static assets + JSON API).

Runs on all interfaces (0.0.0.0) so a phone on the same WiFi can reach it too,
but never calls out anywhere itself. The desktop app (pywebview, always on
127.0.0.1) is trusted implicitly; any other device must pair with a PIN first
-- see pairing.py.
"""
import datetime
import hashlib
import io
import json
import socket
from pathlib import Path
from typing import Optional

from flask import Flask, Response, jsonify, request, send_file, send_from_directory
from AppKit import NSPasteboard, NSPasteboardTypeString

from . import store, monitor
from .classifier import classify
from .ocr import extract_text
from . import topics
from .search import semantic_search, keyword_search, topic_aware_search
from .combine import combine_clips
from .context import suggest as context_suggest
from .pairing import Pairing

WEBUI_DIR = Path(__file__).resolve().parent / "webui"
PORT = 8765
TRUSTED_LOCAL_ADDRS = {"127.0.0.1", "::1"}
MAX_IMAGE_BYTES = 15 * 1024 * 1024  # 15MB, generous for a phone screenshot
RESURFACE_MIN_AGE_SECONDS = 3 * 24 * 3600  # only nudge about screenshots at least 3 days old
RESURFACE_COUNT = 3
UPCOMING_HORIZON_DAYS = 7  # how far ahead an event still counts as "다가오는"

app = Flask(__name__, static_folder=str(WEBUI_DIR / "static"), static_url_path="/static")
pairing = Pairing()


def _image_format(raw: bytes) -> Optional[str]:
    """Return a normalized extension if the bytes really are an image."""
    try:
        from PIL import Image

        with Image.open(io.BytesIO(raw)) as img:
            img.verify()
            fmt = (img.format or "").lower()
    except Exception:
        return None
    return {"jpeg": "jpg", "png": "png", "webp": "webp", "heif": "heic", "gif": "gif"}.get(fmt)


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
    if auth.startswith("Bearer ") and pairing.is_valid_token(auth[len("Bearer "):]):
        return True
    # <img src> can't carry an Authorization header, so the paired phone also
    # keeps the token in a cookie -- same token, same trust level.
    return pairing.is_valid_token(request.cookies.get("dasibom_token"))


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
        "has_image": bool(row["image_path"]),
        "topic": row["topic"],
        "topic_name": topics.display_name(row["topic"]) if row["topic"] else None,
        "label": row["label"],
        "summary": row["summary"],
        "tags": json.loads(row["tags"]) if row["tags"] else [],
        "understood": row["understood_at"] is not None,
        "event_date": row["event_date"],
    }


@app.get("/")
def index():
    return send_from_directory(str(WEBUI_DIR), "index.html")


@app.get("/api/clips")
def api_clips():
    conn = store.connect()
    category = request.args.get("category") or None
    label = request.args.get("label") or None
    limit = int(request.args.get("limit", 100))
    if label:
        rows = conn.execute("SELECT * FROM clips WHERE label = ? ORDER BY id DESC LIMIT ?",
                            (label, limit)).fetchall()
    else:
        rows = store.list_clips(conn, limit=limit, category=category)
    return jsonify([_row_to_dict(r) for r in rows])


@app.post("/api/clips")
def api_create_clip():
    """Manual add -- mainly for the phone's "붙여넣기 → 보내기" box. iOS gives no
    app (native or web) a way to observe clipboard changes in the background, so
    this explicit paste-and-send is the only reliable phone -> Mac path."""
    data = request.get_json(force=True, silent=True) or {}
    content = (data.get("content") or "").strip()[:monitor.MAX_CONTENT_CHARS]
    if not content:
        return jsonify({"ok": False, "error": "empty"}), 400
    conn = store.connect()
    category, subtype = classify(content)
    source = "Mac (직접 추가)" if request.remote_addr in TRUSTED_LOCAL_ADDRS else "iPhone"
    new_id = store.add_clip(conn, content, category, subtype, source_app=source)
    return jsonify({"ok": True, "id": new_id})


@app.post("/api/clips/image")
def api_create_image_clip():
    """"아이디어 스크린샷" intake: phone picks an image (from its Photos library
    via the native file picker) and we OCR it locally with Vision so it becomes
    searchable text like everything else, plus keep the picture for the
    resurface nudge."""
    file = request.files.get("image")
    if not file:
        return jsonify({"ok": False, "error": "no file"}), 400
    raw = file.read(MAX_IMAGE_BYTES + 1)
    if not raw:
        return jsonify({"ok": False, "error": "empty"}), 400
    if len(raw) > MAX_IMAGE_BYTES:
        return jsonify({"ok": False, "error": "too_large"}), 413

    # Trusting the extension let a .txt file and 200 random bytes through as
    # "screenshots" -- they stored fine and then rendered as broken images.
    # Decode the actual bytes instead.
    fmt = _image_format(raw)
    if fmt is None:
        return jsonify({"ok": False, "error": "not_an_image"}), 415
    ext = f".{fmt}"
    digest = hashlib.sha256(raw).hexdigest()
    store.IMAGES_DIR.mkdir(parents=True, exist_ok=True)
    image_path = store.IMAGES_DIR / f"{digest}{ext}"
    if not image_path.exists():
        image_path.write_bytes(raw)

    ocr_text = extract_text(image_path).strip()
    content = ocr_text if ocr_text else "(텍스트 없는 이미지)"
    source = "Mac (직접 추가)" if request.remote_addr in TRUSTED_LOCAL_ADDRS else "iPhone"
    topic, _confidence = topics.classify_topic(ocr_text)

    conn = store.connect()
    new_id = store.add_clip(
        conn, content, category="image", subtype=None, source_app=source,
        image_path=str(image_path.relative_to(store.IMAGES_DIR.parent)),
        topic=topic,
    )
    return jsonify({"ok": True, "id": new_id, "ocr_text": ocr_text,
                    "topic": topic, "topic_name": topics.display_name(topic)})


@app.get("/api/images/<int:clip_id>")
def api_get_image(clip_id):
    conn = store.connect()
    row = store.get_clip(conn, clip_id)
    if not row or not row["image_path"]:
        return Response(status=404)
    path = store.DB_PATH.parent / row["image_path"]
    if not path.exists():
        return Response(status=404)
    return send_file(path)


@app.get("/api/resurface")
def api_resurface():
    """Two tiers, in order of how much they deserve attention:

    1. 다가오는 일 -- a clip whose extracted event date is within the horizon.
       A reservation two days out is worth interrupting for.
    2. 잊힌 것 -- old, dateless clips the user never came back to. This is the
       original nudge, and it only runs when tier 1 has nothing.
    """
    conn = store.connect()
    today = datetime.date.today()
    horizon = today + datetime.timedelta(days=UPCOMING_HORIZON_DAYS)

    upcoming = store.upcoming_clips(conn, today.isoformat(), horizon.isoformat(), RESURFACE_COUNT)
    items = []
    for row in upcoming:
        item = _row_to_dict(row)
        event = datetime.date.fromisoformat(row["event_date"])
        days = (event - today).days
        item["reason"] = "오늘" if days == 0 else ("내일" if days == 1 else f"{days}일 뒤")
        item["kind"] = "upcoming"
        items.append(item)

    if len(items) < RESURFACE_COUNT:
        forgotten = store.resurface_candidates(
            conn, "image", RESURFACE_MIN_AGE_SECONDS, RESURFACE_COUNT - len(items))
        for row in forgotten:
            item = _row_to_dict(row)
            item["reason"] = "한동안 안 봤어요"
            item["kind"] = "forgotten"
            items.append(item)
        if forgotten:
            store.mark_surfaced(conn, [r["id"] for r in forgotten])

    return jsonify(items)


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
    results = topic_aware_search(conn, query, top_k=top_k, category=category)
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


@app.get("/api/labels")
def api_labels():
    """The taxonomy the local LLM invented for this library -- nothing here was
    predefined, so the sidebar is built from what the user actually saved."""
    conn = store.connect()
    rows = conn.execute(
        "SELECT label, COUNT(*) c FROM clips WHERE label IS NOT NULL AND label != '' "
        "GROUP BY label ORDER BY c DESC"
    ).fetchall()
    pending = conn.execute(
        "SELECT COUNT(*) c FROM clips WHERE understood_at IS NULL"
    ).fetchone()["c"]
    return jsonify({"labels": [{"label": r["label"], "count": r["c"]} for r in rows],
                    "pending": pending})


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
