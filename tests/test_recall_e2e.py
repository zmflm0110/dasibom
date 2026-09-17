"""End-to-end recall test: colloquial Korean queries against a live server.

These are the exact queries that failed before the e5-small swap and the topic
layer (raw embedding top-1 was 3/8). Run the app first:  python3 -m clipmind.app
"""
import json
import sys
import urllib.parse
import urllib.request

BASE = "http://127.0.0.1:8765"

CASES = [
    ("몸 만들려면 뭐 했더라", "운동"),
    ("밥 해먹을 때 참고할 것", "레시피"),
    ("주말에 갈 만한 데", "전시회"),
    ("커피 마실 곳", "카페"),
    ("코딩하다 막혔을 때 본 거", "파이썬"),
    ("돈 관련해서 메모해둔 거", "환율"),
    ("예약해둔 거 있었나", "예약"),
    ("읽을 만한 책", "책"),
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
