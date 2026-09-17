"""End-to-end recall test: colloquial Korean queries against a live server.

These are the exact queries that failed before the e5-small swap and the topic
layer (raw embedding top-1 was 3/8). Run the app first:  python3 -m dasibom.app
"""
import json
import sys
import urllib.parse
import urllib.request

BASE = "http://127.0.0.1:8765"

# One query per screenshot kind in the seed corpus. Every query is phrased the
# way someone actually half-remembers a thing -- no keyword overlap with the
# screenshot text, which is the whole point.
CASES = [
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


def search(query, top_k=1):
    url = f"{BASE}/api/search?q={urllib.parse.quote(query)}&top_k={top_k}"
    with urllib.request.urlopen(url, timeout=120) as r:
        return json.load(r)


hits = 0
for query, expected in CASES:
    results = search(query)
    if not results:
        print(f"X  {query}  ->  (결과 없음)")
        continue
    top = results[0]
    title = top["content"].splitlines()[0][:32]
    ok = expected in top["content"]
    hits += ok
    print(f"{'O' if ok else 'X'}  {query}")
    print(f"      -> [{top.get('topic_name')}] {title}")

print(f"\n1위 정답률: {hits}/{len(CASES)}")
if hits < len(CASES) * 0.75:
    print("FAIL: 75% 미만")
    sys.exit(1)
print("PASS")
