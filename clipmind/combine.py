"""Combine multiple stored clips into a single block, ordered as requested."""
from . import store


def combine_clips(conn, ids: list[int], separator: str = "\n\n") -> str:
    clips = store.get_clips_by_ids(conn, ids)
    parts = []
    for c in clips:
        header = f"# --- clip #{c['id']} ({c['category']}"
        if c["subtype"]:
            header += f"/{c['subtype']}"
        header += ") ---"
        parts.append(f"{header}\n{c['content']}")
    return separator.join(parts)
