"""Rule-based classifier for clipboard content.

Categories: url, email, path, json, code, korean_text, english_text, mixed_text, short
Code subtypes: python, javascript, html, css, sql, shell, json, generic
"""
import re

URL_RE = re.compile(r"^\s*(https?://|www\.)\S+\s*$", re.IGNORECASE)
EMAIL_RE = re.compile(r"^\s*[\w.+-]+@[\w-]+\.[\w.-]+\s*$")
PATH_RE = re.compile(r"^\s*(~?/[\w.\-/]+|[A-Za-z]:\\[\w.\-\\]+)\s*$")

KOREAN_RE = re.compile(r"[가-힣]")
LATIN_LETTER_RE = re.compile(r"[A-Za-z]")

CODE_SIGNALS = [
    (re.compile(r"\bdef\s+\w+\s*\("), "python"),
    (re.compile(r"\bimport\s+\w+"), "python"),
    (re.compile(r"^\s*from\s+[\w.]+\s+import\s+", re.MULTILINE), "python"),
    (re.compile(r"\bself\.\w+"), "python"),
    (re.compile(r"\bfunction\s+\w*\s*\(|=>\s*{|=>\s*\(|\bconst\s+\w+\s*=|\blet\s+\w+\s*="), "javascript"),
    (re.compile(r"\bconsole\.log\("), "javascript"),
    (re.compile(r"</?[a-zA-Z][^>]*>"), "html"),
    (re.compile(r"\{\s*[.#]?[\w-]+\s*\{|:\s*[\w#%-]+;\s*\}", re.MULTILINE), "css"),
    (re.compile(r"\bSELECT\b.+\bFROM\b", re.IGNORECASE), "sql"),
    (re.compile(r"^\s*(sudo|brew|npm|pip3?|git|cd|ls|curl|export)\s", re.MULTILINE), "shell"),
    (re.compile(r"\bclass\s+\w+[:({]|\bpublic\s+(class|static|void)\b"), "generic"),
]

GENERIC_CODE_PUNCT_RE = re.compile(r"[{};]")


def _looks_like_json(text: str) -> bool:
    t = text.strip()
    if not t or t[0] not in "{[" or t[-1] not in "}]":
        return False
    try:
        import json as _json

        _json.loads(t)
        return True
    except Exception:
        return False


def classify(text: str) -> tuple[str, str | None]:
    """Return (category, subtype)."""
    if text is None:
        return "empty", None
    t = text.strip()
    if not t:
        return "empty", None

    if URL_RE.match(t):
        return "url", None
    if EMAIL_RE.match(t):
        return "email", None
    if PATH_RE.match(t) and "\n" not in t and len(t) < 300:
        return "path", None
    if _looks_like_json(t):
        return "code", "json"

    for pattern, lang in CODE_SIGNALS:
        if pattern.search(t):
            return "code", lang

    # Weak code signal: multi-line + heavy punctuation density
    if "\n" in t:
        lines = [l for l in t.splitlines() if l.strip()]
        punct_lines = sum(1 for l in lines if GENERIC_CODE_PUNCT_RE.search(l))
        if lines and punct_lines / len(lines) > 0.4:
            return "code", "generic"

    if len(t) < 20 and " " not in t and "\n" not in t:
        return "short", None

    korean_chars = len(KOREAN_RE.findall(t))
    latin_chars = len(LATIN_LETTER_RE.findall(t))
    if korean_chars == 0 and latin_chars == 0:
        return "short", None
    if korean_chars > latin_chars:
        return "korean_text", None
    if latin_chars > 0 and korean_chars == 0:
        return "english_text", None
    return "mixed_text", None
