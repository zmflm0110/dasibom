"""Stage-2 reranker for search: a multilingual cross-encoder that scores
(query, candidate) pairs directly, rather than comparing independently-embedded
vectors. Much more accurate than bi-encoder cosine similarity alone, but too
slow to run over an entire corpus -- so search.py uses it only to re-order a
small shortlist that the bi-encoder (embeddings.py) already retrieved.

This is the standard "retrieve then rerank" pattern used in production
semantic search / RAG systems. Falls back silently (no reordering) if the
model isn't available.
"""
_MODEL_NAME = "cross-encoder/mmarco-mMiniLMv2-L12-H384-v1"
_model = None
_available: bool | None = None


def is_available() -> bool:
    global _available
    if _available is not None:
        return _available
    try:
        import sentence_transformers  # noqa: F401

        _available = True
    except ImportError:
        _available = False
    return _available


def _get_model():
    global _model
    if _model is None:
        from sentence_transformers import CrossEncoder

        _model = CrossEncoder(_MODEL_NAME)
    return _model


def rerank(query: str, candidates: list[tuple]) -> list[tuple]:
    """candidates: list of (row, bi_encoder_score). Returns re-sorted list of
    (row, cross_encoder_score), most relevant first."""
    if not candidates:
        return []
    model = _get_model()
    pairs = [(query, row["content"]) for row, _ in candidates]
    scores = model.predict(pairs)
    reranked = sorted(zip([row for row, _ in candidates], scores), key=lambda p: p[1], reverse=True)
    return [(row, float(score)) for row, score in reranked]
