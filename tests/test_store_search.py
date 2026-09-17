import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from clipmind import store
from clipmind.classifier import classify
from clipmind.search import semantic_search, keyword_search
from clipmind.combine import combine_clips

tmp_dir = tempfile.mkdtemp()
db_path = Path(tmp_dir) / "test.db"
conn = store.connect(db_path)

SAMPLES = [
    "def train_model(data):\n    model = fit(data)\n    return model",
    "for batch in DataLoader(dataset, batch_size=32):\n    optimizer.step()",
    "try:\n    result = risky()\nexcept ValueError as e:\n    print(e)",
    "from fastapi import FastAPI\napp = FastAPI()\n@app.get('/')\ndef root():\n    return {'ok': True}",
    "response = openai.ChatCompletion.create(model='gpt-4', messages=messages)",
    "<html><body><h1>Hello</h1></body></html>",
    "오늘 점심 메뉴 추천 좀 해줘",
    "내일 회의 3시에 시작합니다",
    "https://github.com/anthropics/claude-code",
    "SELECT id, name FROM users WHERE active = 1",
    "def create_access_token(user_id):\n    payload = {'sub': user_id, 'exp': expiry}\n    return jwt.encode(payload, SECRET_KEY, algorithm='HS256')",
]

ids = []
for text in SAMPLES:
    cat, sub = classify(text)
    new_id = store.add_clip(conn, text, cat, sub, source_app="TestApp")
    ids.append(new_id)

assert all(i is not None for i in ids), "all inserts should succeed"
print(f"inserted {len(ids)} clips: {ids}")

dup_id = store.add_clip(conn, SAMPLES[-1], "code", "sql", "TestApp")
assert dup_id is None, "exact duplicate of most recent clip should be skipped"
print("PASS  duplicate suppression works")

s = store.stats(conn)
print("stats:", s)
assert s["total"] == len(SAMPLES)
print("PASS  stats total matches insert count")

from clipmind import embeddings as _emb

print(f"\nembedding backend available: {_emb.is_available()}")

print("\n--- semantic_search('데이터로더로 학습 코드') ---")
results = semantic_search(conn, "데이터로더로 배치 학습 코드", top_k=3)
for row, score in results:
    print(f"  #{row['id']} score={score:.3f} {row['content'][:50]!r}")
assert results, "semantic search should return results"
top_ids = [r["id"] for r, _ in results]
if _emb.is_available():
    assert ids[1] in top_ids, "cross-lingual embedding search should surface the DataLoader/batch training snippet"
    print("PASS  cross-lingual embedding search surfaces relevant python training code")
else:
    assert ids[1] in top_ids or ids[0] in top_ids
    print("PASS  (TF-IDF fallback) surfaces relevant python training code")

print("\n--- semantic_search('점심 메뉴') ---")
results2 = semantic_search(conn, "점심 메뉴 추천", top_k=3)
for row, score in results2:
    print(f"  #{row['id']} score={score:.3f} {row['content'][:50]!r}")
assert results2 and results2[0][0]["id"] == ids[6], "top result should be the lunch-menu Korean text"
print("PASS  semantic search correctly ranks Korean natural-language query")

if _emb.is_available():
    from clipmind import reranker as _rerank

    print("\n--- semantic_search('로그인 인증 토큰 발급하는 코드') [no literal token overlap test] ---")
    results3 = semantic_search(conn, "로그인 인증 토큰 발급하는 코드", top_k=3, category="code")
    for row, score in results3:
        print(f"  #{row['id']} score={score:.3f} {row['content'][:50]!r}")
    top_ids3 = [r["id"] for r, _ in results3]
    assert ids[10] in top_ids3, "cross-lingual concept search should surface the JWT token-issuing function"
    if _rerank.is_available():
        assert top_ids3[0] == ids[10], (
            "with the cross-encoder reranker enabled, the JWT snippet should rank #1, "
            "not just appear somewhere in the top-3 (this is what the rerank stage is for)"
        )
        print("PASS  reranker puts the JWT auth code in the #1 spot (not just top-3)")
    else:
        print("PASS  cross-lingual CONCEPT search (no shared literal tokens) surfaces JWT auth code in top-3")

print("\n--- keyword_search('FastAPI') ---")
kw = keyword_search(conn, "FastAPI")
assert len(kw) == 1 and kw[0]["id"] == ids[3]
print("PASS  keyword search finds exact substring match")

print("\n--- combine_clips ---")
combined = combine_clips(conn, [ids[3], ids[4]])
assert "fastapi" in combined.lower() and "openai" in combined.lower()
assert f"#{ids[3]}" in combined and f"#{ids[4]}" in combined
print("PASS  combine merges FastAPI + OpenAI call snippets with headers")

print("\nALL STORE/SEARCH TESTS PASSED")
