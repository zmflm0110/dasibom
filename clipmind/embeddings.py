"""Optional real semantic embedding backend (multilingual sentence-transformers).

Falls back gracefully when the model/package isn't available; callers should
check is_available() and fall back to TF-IDF search (see search.py).
"""
import numpy as np

_MODEL_NAME = "paraphrase-multilingual-MiniLM-L12-v2"
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
        from sentence_transformers import SentenceTransformer

        _model = SentenceTransformer(_MODEL_NAME)
    return _model


def embed(texts: list[str]) -> np.ndarray:
    model = _get_model()
    return model.encode(texts, convert_to_numpy=True, normalize_embeddings=True)


def to_blob(vec: np.ndarray) -> bytes:
    return vec.astype(np.float32).tobytes()


def from_blob(blob: bytes) -> np.ndarray:
    return np.frombuffer(blob, dtype=np.float32)
