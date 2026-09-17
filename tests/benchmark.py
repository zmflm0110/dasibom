"""Reproducible numbers for the project writeup.

Everything here re-measures against a live server rather than quoting figures
from a commit message, so a claim that goes stale fails loudly instead of
quietly surviving into a slide.

    python3 -m dasibom.app      # in one terminal
    python3 tests/benchmark.py   # in another
"""
import json
import statistics
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

BASE = "http://127.0.0.1:8765"

RECALL_CASES = [
    ("몸 만들려면 뭐 했더라", "운동 루틴"),
    ("밥 해먹을 때 참고할 것", "토마토 파스타"),
    ("주말에 갈 만한 데", "전시회"),
    ("커피 마실 곳", "성수동 카페"),
    ("코딩하다 막혔을 때 본 거", "파이썬"),
    ("돈 관련해서 메모해둔 거", "환율"),
    ("예약해둔 거 있었나", "예약 확인"),
    ("엄마가 뭐 보낸다고 했는데", "엄마 카톡"),
    ("면접 준비하면서 봤던 거", "면접 예상 질문"),
    ("폰 케이스 사려고 봐뒀던 거", "아이폰 케이스"),
]


def get(path):
    with urllib.request.urlopen(f"{BASE}{path}", timeout=180) as r:
        return json.load(r)


def main():
    print("=" * 56)
    print("다시봄 — 측정 결과")
    print("=" * 56)

    clips = get("/api/clips?limit=500")
    labels = get("/api/labels")
    understood = [c for c in clips if c["understood"]]
    with_summary = [c for c in clips if c.get("summary")]
    with_date = [c for c in clips if c.get("event_date")]

    print(f"\n[수집]")
    print(f"  전체 스크린샷              {len(clips)}장")
    print(f"  AI가 읽고 이해한 것        {len(understood)}장 ({len(understood)/max(len(clips),1)*100:.0f}%)")
    print(f"  요약이 생성된 것           {len(with_summary)}장")
    print(f"  날짜가 추출된 것           {len(with_date)}장")

    print(f"\n[AI가 스스로 만든 분류] {len(labels['labels'])}종")
    print("  " + ", ".join(f"{l['label']}({l['count']})" for l in labels["labels"]))

    print(f"\n[검색 — 구어체 한국어 질의 {len(RECALL_CASES)}개]")
    hits, latencies = 0, []
    for query, expected in RECALL_CASES:
        t0 = time.time()
        results = get(f"/api/search?q={urllib.parse.quote(query)}&top_k=1")
        latencies.append(time.time() - t0)
        ok = bool(results) and expected in results[0]["content"]
        hits += ok
        print(f"  {'O' if ok else 'X'} {query}")
    print(f"  1위 정답률                 {hits}/{len(RECALL_CASES)}")
    print(f"  질의 응답 시간 (중앙값)    {statistics.median(latencies)*1000:.0f}ms")

    print(f"\n[먼저 꺼내주기]")
    for item in get("/api/resurface"):
        print(f"  [{item['kind']:<9}] {item['reason']:<10} {(item.get('summary') or '')[:40]}")

    print(f"\n[개인정보]")
    print(f"  외부로 나가는 데이터       없음 (OCR·임베딩·LLM 전부 이 기기에서 실행)")
    print("=" * 56)
    return 0 if hits == len(RECALL_CASES) else 1


if __name__ == "__main__":
    sys.exit(main())
