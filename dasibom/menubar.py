"""ClipMind menu bar app (rumps): background capture + quick recall/search UI."""
import rumps
from AppKit import NSPasteboard, NSPasteboardTypeString

from . import store
from .monitor import poll_tick
from .search import semantic_search

RECENT_COUNT = 8
PREVIEW_LEN = 40


def _preview(text: str, n: int = PREVIEW_LEN) -> str:
    flat = text.replace("\n", " ")
    return flat[:n] + ("..." if len(flat) > n else "")


class ClipMindApp(rumps.App):
    def __init__(self):
        super().__init__("📋", quit_button="Quit ClipMind")
        self.conn = store.connect()
        self.pb = NSPasteboard.generalPasteboard()
        self.last_change_count = self.pb.changeCount()

        self.recent_menu = rumps.MenuItem("Recent")
        self.menu = [
            self.recent_menu,
            None,
            rumps.MenuItem("Search…", callback=self.on_search),
            rumps.MenuItem("Suggest for current app", callback=self.on_suggest),
            None,
        ]
        self.refresh_recent()

        self.timer = rumps.Timer(self.tick, 0.5)
        self.timer.start()

    def tick(self, _):
        new_cc = poll_tick(self.pb, self.conn, self.last_change_count, verbose=False)
        if new_cc != self.last_change_count:
            self.last_change_count = new_cc
            self.refresh_recent()

    def refresh_recent(self):
        if self.recent_menu._menu is not None:
            # rumps only creates the underlying NSMenu once an item has been
            # added; clear() would AttributeError on a still-empty submenu.
            self.recent_menu.clear()
        rows = store.list_clips(self.conn, limit=RECENT_COUNT)
        if not rows:
            self.recent_menu.add(rumps.MenuItem("(empty)", callback=None))
            return
        for row in rows:
            tag = row["category"] + (f"/{row['subtype']}" if row["subtype"] else "")
            label = f"[{tag}] {_preview(row['content'])}"
            content = row["content"]
            item = rumps.MenuItem(label, callback=self._make_copy_callback(content))
            self.recent_menu.add(item)

    def _make_copy_callback(self, content: str):
        def _copy(_):
            self.pb.clearContents()
            self.pb.setString_forType_(content, NSPasteboardTypeString)
            self.last_change_count = self.pb.changeCount()
            rumps.notification("ClipMind", "복사됨", _preview(content))
        return _copy

    def on_search(self, _):
        resp = rumps.Window(
            message="검색어를 입력하세요 (의미 기반 검색)",
            title="ClipMind 검색",
            ok="검색",
            cancel="취소",
        ).run()
        if not resp.clicked or not resp.text.strip():
            return
        query = resp.text.strip()
        results = semantic_search(self.conn, query, top_k=5)
        if not results:
            rumps.alert(title=f"'{query}' 검색 결과", message="(결과 없음)")
            return
        lines = [f"#{r['id']} ({s:.2f}) [{r['category']}] {_preview(r['content'], 60)}" for r, s in results]
        rumps.alert(title=f"'{query}' 검색 결과", message="\n".join(lines))

    def on_suggest(self, _):
        from .context import suggest as context_suggest

        app_name, category, results, _language = context_suggest(self.conn, top_k=5)
        header = f"현재 앱: {app_name or '?'}" + (f" (맥락={category})" if category else "")
        if not results:
            rumps.alert(title=header, message="(제안 없음)")
            return
        lines = [f"#{r['id']} [{r['category']}] {_preview(r['content'], 60)}" for r, _ in results]
        rumps.alert(title=header, message="\n".join(lines))


def main():
    ClipMindApp().run()


if __name__ == "__main__":
    main()
