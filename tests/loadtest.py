"""How does this behave with a real library's worth of screenshots?

Everything so far was measured on 53 clips. People have thousands. Search loads
every clip and multiplies the whole matrix on each query, so the interesting
question is where that stops being instant.

Images aren't involved -- OCR isn't what scales badly, the per-query full-corpus
scan is. So rows are synthesized directly.

    python3 tests/loadtest.py
"""
import random
import statistics
import sys
import tempfile
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from dasibom import embeddings, store
from dasibom.search import searchable_text, topic_aware_search

SUBJECTS = ["성수동 카페", "을지로 노포", "제주 숙소", "운동 루틴", "단백질 식단",
            "토마토 파스타", "에어프라이어 삼겹살", "아이폰 케이스", "노트북 최저가",
            "파이썬 데코레이터", "git 되돌리기", "면접 예상 질문", "수강신청",
            "환율 메모", "적금 금리", "전시회 정보", "공연 티켓", "예약 확정",
            "엄마 카톡", "고양이 예방접종", "방 배치 고민", "읽을 책 목록"]
DETAILS = ["가격 {n}원 무료배송", "{n}월 {d}일 오후 {h}시", "주 {k}회 {n}분씩",
           "웨이팅 {k}분, 주차 가능", "쿠폰 적용가 {n}원", "{d}일까지만 운영",
           "메모: 나중에 다시 확인할 것", "링크 저장해둠 instagram.com/saved"]
LABELS = ["카페추천", "맛집", "여행", "운동", "레시피", "쇼핑", "코딩",
          "면접준비", "수강신청", "메모", "전시회", "예약", "메신저", "반려동물"]

QUERIES = ["커피 마실 곳", "몸 만들려면 뭐 했더라", "밥 해먹을 때 참고할 것",
           "코딩하다 막혔을 때 본 거", "예약해둔 거 있었나", "주말에 갈 만한 데"]


def make_rows(n: int):
    rng = random.Random(42)
    rows = []
    for i in range(n):
        subject = rng.choice(SUBJECTS)
        detail = rng.choice(DETAILS).format(n=rng.randint(1000, 90000), d=rng.randint(1, 28),
                                            h=rng.randint(1, 12), k=rng.randint(2, 40))
        rows.append((f"{subject} #{i}\n{detail}", rng.choice(LABELS),
                     f"{subject}에 대한 정보 요약"))
    return rows


def seed(conn, n: int):
    rows = make_rows(n)
    texts = []
    ids = []
    for content, label, summary in rows:
        clip_id = store.add_clip(conn, content, "image", None, "LoadTest", f"images/x{len(ids)}.png")
        store.save_understanding(conn, clip_id, label, summary, [label])
        ids.append(clip_id)

    # Embed in batches, mirroring what search does lazily on first query.
    all_rows = store.all_clips(conn)
    texts = [searchable_text(r) for r in all_rows]
    batch = 256
    for start in range(0, len(texts), batch):
        vectors = embeddings.embed_passages(texts[start:start + batch])
        for row, vector in zip(all_rows[start:start + batch], vectors):
            store.update_embedding(conn, row["id"], embeddings.to_blob(vector))


def measure(conn, n: int) -> dict:
    latencies = []
    for query in QUERIES:
        t0 = time.time()
        topic_aware_search(conn, query, top_k=5)
        latencies.append((time.time() - t0) * 1000)
    return {"n": n, "median_ms": statistics.median(latencies), "max_ms": max(latencies)}


def degradation_check() -> tuple[int, int]:
    """Is the library usable before the LLM has read anything?

    This is what makes a long backlog import acceptable: uploads land instantly,
    search works on raw OCR right away, and understanding improves it in the
    background. If this number were near zero, the 95-minute backlog would mean
    95 minutes of a dead app."""
    import tempfile as _tf
    conn = store.connect(Path(_tf.mkdtemp()) / "pending.db")
    raw = [
        ("성수동 카페 추천\n연무장길 로스터리, 아메리카노 4500원", "성수동"),
        ("운동 루틴 저장\n월수금 상체 화목 하체 주 5회", "운동 루틴"),
        ("토마토 파스타\n마늘 넉넉히, 면수 한 국자", "토마토"),
        ("예약 확인\n10월 3일 오후 7시 2인 예약 완료", "예약"),
        ("파이썬 데코레이터\nfunctools.wraps 안 쓰면", "파이썬"),
        ("환율 메모\n1달러 1380원", "환율"),
        ("면접 예상 질문\n본인의 강점과 실패 경험", "면접"),
        ("엄마 카톡\n김치 보냈다 택배 월요일", "엄마"),
    ]
    for text, _ in raw:
        store.add_clip(conn, text, "image", None, "Test", "images/x.png")

    queries = [("커피 마실 곳", "성수동"), ("몸 만들려면 뭐 했더라", "운동 루틴"),
               ("밥 해먹을 때 참고할 것", "토마토"), ("예약해둔 거 있었나", "예약"),
               ("코딩하다 막혔을 때 본 거", "파이썬"), ("돈 관련해서 메모해둔 거", "환율"),
               ("면접 준비하면서 봤던 거", "면접"), ("엄마가 뭐 보낸다고 했는데", "엄마")]
    hits = 0
    for query, expected in queries:
        results = topic_aware_search(conn, query, top_k=1)
        hits += bool(results) and expected in results[0][0]["content"]
    return hits, len(queries)


def main():
    sizes = [100, 500, 1000, 3000]
    tmp = Path(tempfile.mkdtemp())
    conn = store.connect(tmp / "load.db")

    print(f"{'클립 수':>8} {'질의 중앙값':>12} {'최악':>10}   {'판정':<10}")
    print("-" * 48)

    previous = 0
    results = []
    for size in sizes:
        seed(conn, size - previous)
        previous = size
        result = measure(conn, size)
        results.append(result)
        verdict = "즉각" if result["median_ms"] < 200 else ("체감됨" if result["median_ms"] < 1000 else "느림")
        print(f"{size:>8} {result['median_ms']:>10.0f}ms {result['max_ms']:>8.0f}ms   {verdict:<10}")

    print()
    growth = results[-1]["median_ms"] / max(results[0]["median_ms"], 0.01)
    print(f"100장 -> 3000장 (30배)일 때 지연 {growth:.1f}배")

    understand_minutes = 3000 * 2.1 / 60
    print(f"3000장 최초 이해 소요 (2.1초/장, 백그라운드): 약 {understand_minutes:.0f}분")

    hits, total = degradation_check()
    print(f"이해 완료 전(OCR 원문만) 검색 정답률: {hits}/{total}  -> 이해 후 10/10")
    print("  임포트 직후부터 검색이 되고, 백그라운드가 따라잡으며 좋아진다")
    return 0 if results[-1]["median_ms"] < 1000 and hits >= total * 0.6 else 1


if __name__ == "__main__":
    sys.exit(main())
