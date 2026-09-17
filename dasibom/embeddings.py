"""Optional real semantic embedding backend (multilingual sentence-transformers).

Falls back gracefully when the model/package isn't available; callers should
check is_available() and fall back to TF-IDF search (see search.py).
"""
import numpy as np

# Measured on 8 colloquial Korean queries ("몸 만들려면 뭐 했더라", "밥 해먹을 때 참고할 것", …):
#   paraphrase-multilingual-MiniLM-L12-v2 → top-1 3/8, top-3 5/8
#   intfloat/multilingual-e5-small        → top-1 5/8, top-3 8/8   ← chosen
#   intfloat/multilingual-e5-base         → top-1 6/8, top-3 6/8
# Stage 1 exists to get the answer into the candidate pool, so top-3 recall is
# what matters here, not top-1. E5 models REQUIRE the query:/passage: prefixes;
# dropping them measurably degrades retrieval.
_MODEL_NAME = "intfloat/multilingual-e5-small"
QUERY_PREFIX = "query: "
PASSAGE_PREFIX = "passage: "
_model = None
_available: bool | None = None


def model_name() -> str:
    return _MODEL_NAME


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
        from sentence_transformers import SentenceTransformer

        _model = SentenceTransformer(_MODEL_NAME)
    return _model


def embed_passages(texts: list[str]) -> np.ndarray:
    model = _get_model()
    return model.encode([PASSAGE_PREFIX + t for t in texts],
                        convert_to_numpy=True, normalize_embeddings=True)


def embed_query(text: str) -> np.ndarray:
    model = _get_model()
    return model.encode([QUERY_PREFIX + text],
                        convert_to_numpy=True, normalize_embeddings=True)[0]


def to_blob(vec: np.ndarray) -> bytes:
    return vec.astype(np.float32).tobytes()


def from_blob(blob: bytes) -> np.ndarray:
    return np.frombuffer(blob, dtype=np.float32)
