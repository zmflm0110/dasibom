"""Local search over stored clips.

Retrieval:
  - embeddings.py: real multilingual sentence-embedding cosine search (semantic,
    cross-language). Used automatically when sentence-transformers is installed.
  - TF-IDF (scikit-learn): pure lexical fallback, works with zero extra
    dependencies/downloads but only matches on shared vocabulary.

Reranking (optional second stage):
  - reranker.py: a cross-encoder rescoring the embedding search's top candidates
    directly against the query. Bi-encoder cosine similarity alone is noisy on
    small corpora of short texts; a cross-encoder fixes ordering because it
    attends to the query and candidate jointly instead of comparing two
    independently-computed vectors.

No external API calls anywhere in this pipeline -- everything runs locally.
"""
import json
from typing import Optional

import numpy as np
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity

from . import store, embeddings, reranker

# Bump when the text fed to the embedder changes shape, not just when the model
# changes -- otherwise vectors built from raw OCR silently mix with vectors built
# from AI summaries, and nothing errors because the dimension is identical.
EMBED_TEXT_VERSION = "v2-summary"


def searchable_text(row) -> str:
    """What actually gets embedded for a clip.

    Raw OCR is noisy ("instagram.com/saved", UI chrome, broken line wraps). The
    AI summary and label are a cleaner statement of what the thing IS, so they
    lead; the OCR stays as a tail so exact strings (prices, dates, names) remain
    findable."""
    keys = row.keys() if hasattr(row, "keys") else []
    parts = []
    if "label" in keys and row["label"]:
        parts.append(row["label"])
    if "summary" in keys and row["summary"]:
        parts.append(row["summary"])
    if "tags" in keys and row["tags"]:
        try:
            parts.extend(json.loads(row["tags"]))
        except (json.JSONDecodeError, TypeError):
            pass
    parts.append(row["content"][:600])
    return " / ".join(str(p) for p in parts if p)

RERANK_CANDIDATE_MULTIPLIER = 4
RERANK_CANDIDATE_MAX = 30
# Cosine sims here sit around 0.75-0.95, so 0.06 reliably outranks a same-topic
# clip over a slightly-closer wrong-topic one without burying exact matches.
TOPIC_MATCH_BOOST = 0.06


def _filtered_rows(conn, category: Optional[str]):
    rows = store.all_clips(conn)
    if category:
        rows = [r for r in rows if r["category"] == category]
    return rows


def _tfidf_search(conn, query: str, top_k: int, category: Optional[str]):
    rows = _filtered_rows(conn, category)
    if not rows:
        return []

    corpus = [r["content"] for r in rows]
    vectorizer = TfidfVectorizer(
        max_features=20000,
        ngram_range=(1, 2),
        token_pattern=r"(?u)\b\w[\w'-]*\b",
    )
    try:
        matrix = vectorizer.fit_transform(corpus + [query])
    except ValueError:
        return []

    query_vec = matrix[-1]
    doc_matrix = matrix[:-1]
    sims = cosine_similarity(query_vec, doc_matrix).flatten()

    ranked = sorted(zip(rows, sims), key=lambda p: p[1], reverse=True)
    return [(r, float(s)) for r, s in ranked[:top_k] if s > 0]


def _embedding_search(conn, query: str, top_k: int, category: Optional[str]):
    store.ensure_embedding_model(conn, f"{embeddings.model_name()}#{EMBED_TEXT_VERSION}")
    rows = _filtered_rows(conn, category)
    if not rows:
        return []

    vecs = []
    missing_idx = []
    for i, r in enumerate(rows):
        if r["embedding"] is not None:
            vecs.append(embeddings.from_blob(r["embedding"]))
        else:
            vecs.append(None)
            missing_idx.append(i)

    if missing_idx:
        new_vecs = embeddings.embed_passages([searchable_text(rows[i]) for i in missing_idx])
        for j, i in enumerate(missing_idx):
            vecs[i] = new_vecs[j]
            store.update_embedding(conn, rows[i]["id"], embeddings.to_blob(new_vecs[j]))

    doc_matrix = np.vstack(vecs)
    query_vec = embeddings.embed_query(query)
    sims = doc_matrix @ query_vec  # embeddings are normalized -> dot product == cosine sim

    ranked = sorted(zip(rows, sims), key=lambda p: p[1], reverse=True)
    return [(r, float(s)) for r, s in ranked[:top_k] if s > 0]


def topic_aware_search(conn, query: str, top_k: int = 5, category: Optional[str] = None):
    """Rank by embedding similarity, but boost clips whose topic matches the query's.

    Colloquial recall queries are mostly category queries ("밥 해먹을 때 참고할 것"
    = 요리), and measured query→topic accuracy is 8/8 while raw embedding top-1 on
    the same queries was 5/8. The topic is a boost rather than a hard filter so a
    misclassified clip is demoted, never hidden."""
    from . import topics

    results = _embedding_search(conn, query, max(top_k * 6, 30), category)
    if not results:
        return []

    query_topic, confidence = topics.classify_topic(query)
    if query_topic == topics.OTHER[0] or confidence < topics.MIN_SIMILARITY:
        return results[:top_k]

    boosted = []
    for row, score in results:
        clip_topic = row["topic"] if "topic" in row.keys() else None
        boosted.append((row, score + (TOPIC_MATCH_BOOST if clip_topic == query_topic else 0.0)))
    boosted.sort(key=lambda p: p[1], reverse=True)
    return boosted[:top_k]


def semantic_search(conn, query: str, top_k: int = 5, category: Optional[str] = None, rerank: bool = False):
    # rerank defaults OFF: measured on 8 colloquial Korean queries, the mMARCO
    # cross-encoder made results WORSE (top-1 5/8 -> 4/8), swapping the 운동/요리
    # answers outright. It was trained on machine-translated MS MARCO, so it
    # handles documenty queries fine but not conversational Korean. Kept behind
    # the flag rather than deleted -- it still helped on code/English queries.
    if not embeddings.is_available():
        return _tfidf_search(conn, query, top_k, category)

    candidate_k = min(max(top_k * RERANK_CANDIDATE_MULTIPLIER, top_k), RERANK_CANDIDATE_MAX)
    candidates = _embedding_search(conn, query, candidate_k, category)

    if rerank and candidates and reranker.is_available():
        return reranker.rerank(query, candidates)[:top_k]
    return candidates[:top_k]


def keyword_search(conn, query: str, limit: int = 20):
    like = f"%{query}%"
    cur = conn.execute(
        "SELECT * FROM clips WHERE content LIKE ? ORDER BY id DESC LIMIT ?",
        (like, limit),
    )
    return cur.fetchall()
