"""Local LLM that actually reads a screenshot's text and says what it is.

Why this replaces hand-written rules: topics.py matched screenshots against 10
categories I picked, using keyword lists and anchor sentences. That is pattern
matching, not understanding -- and it showed: "만들" false-matched "몸 만들려면",
and the anchors needed hand-tuning twice. Real screenshots do not fit ten boxes
someone chose in advance.

So the label is NOT chosen from a fixed list. The model sees which labels it
already uses and either reuses one or invents a new one, so the taxonomy emerges
from what the user actually saves.

Runs on-device via MLX (Apple Silicon). No network, no API key.
"""
import json
import re
from typing import Optional

MODEL_NAME = "mlx-community/Qwen2.5-3B-Instruct-4bit"

_model = None
_tokenizer = None
_available: Optional[bool] = None

PROMPT = """다음은 사용자가 저장해둔 스크린샷에서 추출한 글자입니다.

---
{text}
---
{existing}
이 스크린샷이 무엇인지 파악해서 JSON으로만 답하세요. 설명 금지.
{{"label": "분류명", "summary": "한 문장 요약", "tags": ["태그1", "태그2"]}}

label 규칙:
- 이 스크린샷의 주제를 그대로 가리키는 이름을 쓰세요
- 위 목록은 참고용입니다. 주제가 정확히 같을 때만 그 이름을 재사용하세요
- 조금이라도 다른 주제면 반드시 새 이름을 지으세요 (억지로 끼워맞추지 말 것)
- 좋은 예: 맛집, 여행, 레시피, 운동, 면접준비, 코딩, 쇼핑, 메신저
- 2~5글자, 띄어쓰기 없이"""

EXISTING_BLOCK = """
지금까지 쓰고 있는 분류: {labels}
"""


def is_available() -> bool:
    global _available
    if _available is not None:
        return _available
    try:
        import mlx_lm  # noqa: F401

        _available = True
    except ImportError:
        _available = False
    return _available


def _load():
    global _model, _tokenizer
    if _model is None:
        from mlx_lm import load

        _model, _tokenizer = load(MODEL_NAME)
    return _model, _tokenizer


def _extract_json(raw: str) -> Optional[dict]:
    """Small models wrap JSON in prose or code fences often enough that this
    has to be tolerant rather than trusting json.loads on the whole output."""
    match = re.search(r"\{.*?\}", raw, re.DOTALL)
    if not match:
        return None
    try:
        return json.loads(match.group(0))
    except json.JSONDecodeError:
        return None


# A 3B model drifts in predictable ways, all of them cheap to catch:
# it echoes the schema placeholder back ("분류명"), and it slips into Chinese
# ("健康生活") because Qwen's base is Chinese. Validate rather than keep
# wrestling the prompt -- a bigger model isn't an option in 8GB.
_PLACEHOLDERS = {"분류명", "label", "태그", "요약", "summary", "tags", "태그1", "분류"}
_HANGUL = re.compile(r"[가-힣]")
_CJK_IDEOGRAPH = re.compile(r"[一-鿿]")


def _valid_summary(summary: str) -> bool:
    """Same Chinese-drift guard as the label. Found in a batched run: the model
    wrote "運動 루틴 정리" as a summary while the label was clean, so guarding
    only the label let drift through to the part the user actually reads."""
    if not summary:
        return True  # a missing summary is acceptable; a wrong-language one is not
    return not _CJK_IDEOGRAPH.search(summary)


def _valid_label(label: str) -> bool:
    if not (2 <= len(label) <= 8):
        return False
    if label.lower() in _PLACEHOLDERS:
        return False
    if _CJK_IDEOGRAPH.search(label):
        return False
    # Korean-first app: a label with no Hangul is almost always model drift,
    # except for short ASCII technical words we genuinely want (예: "API").
    if not _HANGUL.search(label) and not label.isascii():
        return False
    return True


def _generate_once(text: str, max_tokens: int, strict: bool,
                   existing_labels: Optional[list[str]] = None) -> Optional[dict]:
    from mlx_lm import generate

    model, tokenizer = _load()
    # Showing the model what it already uses is what keeps the taxonomy from
    # fragmenting. Embedding-distance merging can't do this job: measured on 12
    # short Korean labels, ALL 66 pairs landed in a 0.865-0.928 band, so no
    # threshold separates "same thing" from "unrelated".
    existing = EXISTING_BLOCK.format(labels=", ".join(existing_labels[:20])) if existing_labels else ""
    instruction = PROMPT.format(text=text[:1200], existing=existing)
    if strict:
        instruction += "\n\n반드시 한국어 명사로만 쓰고, 예시 단어를 그대로 복사하지 마세요."
    prompt = tokenizer.apply_chat_template(
        [{"role": "user", "content": instruction}],
        add_generation_prompt=True,
        tokenize=False,
    )
    raw = generate(model, tokenizer, prompt=prompt, max_tokens=max_tokens, verbose=False)
    return _extract_json(raw)


def understand(ocr_text: str, max_tokens: int = 120,
               existing_labels: Optional[list[str]] = None) -> Optional[dict]:
    """Return {'label', 'summary', 'tags'} or None if the model gave nothing usable."""
    text = (ocr_text or "").strip()
    if not text or not is_available():
        return None

    for attempt in range(2):
        parsed = _generate_once(text, max_tokens, strict=attempt > 0,
                                existing_labels=existing_labels)
        if not parsed:
            continue

        label = str(parsed.get("label", "")).strip().replace(" ", "")[:20]
        if not _valid_label(label):
            continue

        summary = str(parsed.get("summary", "")).strip()[:200]
        if not _valid_summary(summary):
            continue
        tags = parsed.get("tags") or []
        if isinstance(tags, str):
            tags = [tags]
        tags = [str(t).strip()[:20] for t in tags if str(t).strip()][:5]
        return {"label": label, "summary": summary, "tags": tags}

    return None


def canonicalize(label: str, existing_labels: list[str]) -> str:
    """Case/spacing-insensitive reuse of an existing label.

    Deliberately NOT embedding-based: measured on 12 short Korean labels, every
    one of the 66 pairs scored 0.865-0.928 cosine, so a distance threshold
    merged unrelated words ("환율" with "음식점정보") and collapsed a 50-clip
    library into a single bogus category. Keeping labels consistent is the
    LLM's job now -- it sees the existing list in its prompt."""
    label = label.strip()
    if not label or not existing_labels:
        return label
    normalized = label.replace(" ", "").lower()
    for existing in existing_labels:
        if existing.replace(" ", "").lower() == normalized:
            return existing
    return label
