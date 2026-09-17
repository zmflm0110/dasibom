"""Check the phone layout by measuring the real rendering engine.

Screenshots of this window can't be captured reliably here (it lands on a
different macOS Space), so instead this loads the page in WebKit at phone width
and asks the DOM for the facts that actually matter: does anything overflow
sideways, did the sidebar switch to the horizontal layout, are tap targets big
enough. That's stronger evidence than a picture anyway.

    python3 -m dasibom.webapp     # server in another terminal
    python3 tests/mobile_layout.py
"""
import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import webview

PHONE_WIDTH = 390   # iPhone 14/15 CSS width
PHONE_HEIGHT = 844

PROBE_JS = """
(function () {
  const body = document.body;
  const sidebar = document.querySelector('.sidebar');
  const nav = document.querySelector('.nav');
  const topbar = document.querySelector('.topbar');
  const search = document.querySelector('.search-wrap');
  // Only buttons that are actually on screen: the select-bar is hidden until
  // something is selected, and a hidden element reports height 0.
  const buttons = [...document.querySelectorAll('.ghost-btn')]
    .filter(b => b.getBoundingClientRect().height > 0 && b.offsetParent !== null);
  const rows = [...document.querySelectorAll('.clip-row')];
  const actions = document.querySelector('.clip-actions');

  // Elements inside a horizontally-scrollable strip (the category rail) are
  // SUPPOSED to extend past the viewport -- that's what makes it scrollable.
  // Only content that pushes the page itself sideways is a bug.
  const inScroller = (el) => {
    for (let p = el.parentElement; p; p = p.parentElement) {
      const ox = getComputedStyle(p).overflowX;
      if (ox === 'auto' || ox === 'scroll') return true;
    }
    return false;
  };
  const overflowing = [...document.querySelectorAll('body *')]
    .filter(el => el.getBoundingClientRect().right > window.innerWidth + 1)
    .filter(el => !inScroller(el))
    .map(el => el.className || el.tagName)
    .slice(0, 5);

  return JSON.stringify({
    viewport: [window.innerWidth, window.innerHeight],
    horizontalScroll: body.scrollWidth > window.innerWidth,
    scrollWidth: body.scrollWidth,
    sidebarDirection: sidebar ? getComputedStyle(sidebar).flexDirection : null,
    sidebarHeight: sidebar ? Math.round(sidebar.getBoundingClientRect().height) : null,
    navDirection: nav ? getComputedStyle(nav).flexDirection : null,
    topbarWraps: topbar ? getComputedStyle(topbar).flexWrap : null,
    searchWidth: search ? Math.round(search.getBoundingClientRect().width) : null,
    smallestButtonHeight: buttons.length ? Math.round(Math.min(...buttons.map(b => b.getBoundingClientRect().height))) : null,
    clipRows: rows.length,
    firstRowWidth: rows.length ? Math.round(rows[0].getBoundingClientRect().width) : null,
    actionsVisible: actions ? getComputedStyle(actions).opacity : null,
    overflowing: overflowing
  });
})()
"""

result = {}


def on_loaded(window):
    time.sleep(3)  # let the clip list render
    try:
        result["probe"] = json.loads(window.evaluate_js(PROBE_JS))
    except Exception as e:
        result["error"] = f"{type(e).__name__}: {e}"
    window.destroy()


def main():
    window = webview.create_window("다시봄 레이아웃 점검", "http://127.0.0.1:8765/",
                                   width=PHONE_WIDTH, height=PHONE_HEIGHT)
    webview.start(on_loaded, window)

    if "error" in result:
        print("측정 실패:", result["error"])
        return 1

    probe = result.get("probe")
    if not probe:
        print("측정값 없음 (서버가 떠 있나요?)")
        return 1

    print(f"뷰포트 {probe['viewport'][0]}x{probe['viewport'][1]} (아이폰 폭)\n")
    checks = [
        ("가로 스크롤 없음", not probe["horizontalScroll"],
         f"scrollWidth={probe['scrollWidth']}"),
        ("사이드바가 가로 배치로 전환", probe["sidebarDirection"] == "row",
         f"flex-direction={probe['sidebarDirection']}"),
        ("사이드바가 화면을 잡아먹지 않음", (probe["sidebarHeight"] or 999) < 160,
         f"height={probe['sidebarHeight']}px"),
        ("분류 목록이 가로 스크롤", probe["navDirection"] == "row",
         f"flex-direction={probe['navDirection']}"),
        ("상단바 줄바꿈 허용", probe["topbarWraps"] == "wrap",
         f"flex-wrap={probe['topbarWraps']}"),
        ("검색창이 폭을 채움", (probe["searchWidth"] or 0) > PHONE_WIDTH * 0.8,
         f"width={probe['searchWidth']}px"),
        ("버튼 탭 영역 충분(>=32px)", (probe["smallestButtonHeight"] or 0) >= 32,
         f"min-height={probe['smallestButtonHeight']}px"),
        ("카드가 화면 안에 들어감", (probe["firstRowWidth"] or 0) <= PHONE_WIDTH,
         f"width={probe['firstRowWidth']}px"),
        ("터치에는 액션 버튼 항상 노출", probe["actionsVisible"] == "1",
         f"opacity={probe['actionsVisible']}"),
    ]

    passed = 0
    for label, ok, detail in checks:
        passed += ok
        print(f"{'PASS' if ok else 'FAIL'}  {label:<26} {detail}")

    if probe["overflowing"]:
        print(f"\n화면 밖으로 삐져나온 요소: {probe['overflowing']}")

    print(f"\n{passed}/{len(checks)} passed  (카드 {probe['clipRows']}개 렌더링됨)")
    return 0 if passed == len(checks) else 1


if __name__ == "__main__":
    sys.exit(main())
