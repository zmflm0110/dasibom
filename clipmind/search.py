"""Local search over stored clips.

Two backends:
  - embeddings.py: real multilingual sentence-embedding cosine search (semantic,
    cross-language). Used automatically when sentence-transformers is installed.
  - TF-IDF (scikit-learn): pure lexical fallback, works with zero extra
    dependencies/downloads but only matches on shared vocabulary.

No external API calls either way -- everything runs locally.
"""
from typing import Optional

import numpy as np
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity

from . import store, embeddings


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
        new_vecs = embeddings.embed([rows[i]["content"] for i in missing_idx])
        for j, i in enumerate(missing_idx):
            vecs[i] = new_vecs[j]
            store.update_embedding(conn, rows[i]["id"], embeddings.to_blob(new_vecs[j]))

    doc_matrix = np.vstack(vecs)
    query_vec = embeddings.embed([query])[0]
    sims = doc_matrix @ query_vec  # embeddings are normalized -> dot product == cosine sim

    ranked = sorted(zip(rows, sims), key=lambda p: p[1], reverse=True)
    return [(r, float(s)) for r, s in ranked[:top_k] if s > 0]


def semantic_search(conn, query: str, top_k: int = 5, category: Optional[str] = None):
    if embeddings.is_available():
        return _embedding_search(conn, query, top_k, category)
    return _tfidf_search(conn, query, top_k, category)


def keyword_search(conn, query: str, limit: int = 20):
    like = f"%{query}%"
    cur = conn.execute(
        "SELECT * FROM clips WHERE content LIKE ? ORDER BY id DESC LIMIT ?",
        (like, limit),
    )
    return cur.fetchall()
