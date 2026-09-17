"""Topic classification for screenshots ("이건 무엇에 관한 스크린샷인가").

Why this exists: colloquial recall queries are almost always CATEGORY queries.
"밥 해먹을 때 참고할 것" means 요리, "몸 만들려면" means 운동, "주말에 갈 만한 데"
means 장소. Measured: asking the embedding model to infer the category implicitly
failed on exactly those queries (top-1 3/8 with MiniLM, 5/8 with e5-small), while
the same queries are trivial once the category is an explicit, filterable field.

Two-stage, cheapest-first:
  1. keyword rules  -- fast, exact, and the only thing that reliably catches
     price/date/address patterns that embeddings blur together
  2. embedding similarity against per-topic anchor sentences -- catches the rest
"""
from typing import Optional

import numpy as np

from . import embeddings

# label -> (한국어 표시명, 앵커 문장들, 키워드)
TOPICS: dict[str, tuple[str, list[str], list[str]]] = {
    "food": ("맛집·카페", [
        "맛있는 식당과 카페를 추천하는 글",
        "메뉴와 가격이 적힌 음식점 정보",
    ], ["맛집", "카페", "식당", "메뉴", "아메리카노", "라떼", "맛있", "브런치", "디저트", "restaurant", "cafe"]),
    "place": ("장소·나들이", [
        "전시회, 공원, 여행지 등 가볼 만한 장소 정보",
        "주말에 방문할 곳과 운영 시간 안내",
    ], ["전시", "미술관", "박물관", "공원", "여행", "숙소", "호텔", "관람", "입장료", "운영시간"]),
    "study": ("공부·정보", [
        "공부하거나 배운 내용을 정리한 메모",
        "개념 설명과 학습 자료 정리",
    ], ["공부", "정리", "개념", "강의", "책", "독서", "추천 도서", "시험", "문법", "단어"]),
    "dev": ("개발·코드", [
        "프로그래밍 코드와 개발 관련 오류 해결 방법",
        "함수 사용법과 라이브러리 설명",
    ], ["코드", "파이썬", "python", "javascript", "함수", "에러", "오류", "def ", "import ", "github", "api"]),
    "shopping": ("쇼핑·구매", [
        "사고 싶은 상품과 가격 정보",
        "할인 정보와 구매 링크",
    ], ["원 무료배송", "무료배송", "할인", "쿠폰", "구매", "장바구니", "품절", "배송", "최저가"]),
    "workout": ("운동·건강", [
        "운동 루틴과 헬스 기록",
        "식단과 건강 관리 방법",
        "몸을 만들기 위한 운동 방법과 횟수",
    ], ["운동", "헬스", "루틴", "스쿼트", "러닝", "체중", "식단", "단백질", "상체", "하체"]),
    "cooking": ("요리·레시피", [
        "요리 레시피와 조리 방법",
        "재료와 만드는 순서 설명",
    ], ["레시피", "요리", "재료", "조리", "볶", "끓", "굽", "파스타", "양념", "한 큰술"]),
    "booking": ("예약·일정", [
        "예약 확인과 약속 일정 안내",
        "날짜와 시간이 적힌 예약 내역",
    ], ["예약", "확정", "일정", "약속", "티켓", "좌석", "예매", "입금", "취소 수수료"]),
    "money": ("돈·금융", [
        "환율, 금리, 지출 등 돈에 관한 메모",
        "결제 내역과 금융 정보",
    ], ["환율", "달러", "금리", "적금", "주식", "월세", "보험", "세금", "결제", "청구"]),
    "idea": ("아이디어", [
        "새로운 아이디어와 기획 메모",
        "새로 시작할 서비스나 사업 구상",  # NOT "만들고 싶은 것": it matched "몸 만들려면"
    # "만들" is deliberately absent: it false-matched "몸 만들려면" (운동) and
    # would match 요리/공작 too. Keep idea keywords to words that only appear
    # when someone is actually planning to build something.
    ], ["아이디어", "기획안", "창업", "서비스 기획", "앱 아이디어"]),
}

OTHER = ("other", "기타")
_anchor_cache: Optional[tuple[list[str], np.ndarray]] = None
MIN_SIMILARITY = 0.80  # below this, the topic is a guess, not a signal


def display_name(label: str) -> str:
    if label in TOPICS:
        return TOPICS[label][0]
    return OTHER[1]


def _keyword_scores(text: str) -> dict[str, int]:
    low = text.lower()
    scores = {}
    for label, (_, _, keywords) in TOPICS.items():
        hits = sum(1 for kw in keywords if kw.lower() in low)
        if hits:
            scores[label] = hits
    return scores


def _anchors() -> tuple[list[str], np.ndarray]:
    global _anchor_cache
    if _anchor_cache is None:
        labels, sentences = [], []
        for label, (_, anchor_sentences, _) in TOPICS.items():
            for s in anchor_sentences:
                labels.append(label)
                sentences.append(s)
        _anchor_cache = (labels, embeddings.embed_passages(sentences))
    return _anchor_cache


def classify_topic(text: str) -> tuple[str, float]:
    """Return (topic label, confidence 0-1). Falls back to 'other'."""
    text = (text or "").strip()
    if not text:
        return OTHER[0], 0.0

    keyword_scores = _keyword_scores(text)
    if keyword_scores:
        best = max(keyword_scores.items(), key=lambda kv: kv[1])
        # 2+ distinct keyword hits is a strong, unambiguous signal on its own.
        if best[1] >= 2:
            return best[0], 1.0

    if not embeddings.is_available():
        return (max(keyword_scores, key=keyword_scores.get), 0.5) if keyword_scores else (OTHER[0], 0.0)

    labels, anchor_matrix = _anchors()
    vec = embeddings.embed_query(text[:1000])
    sims = anchor_matrix @ vec

    by_label: dict[str, float] = {}
    for label, sim in zip(labels, sims):
        by_label[label] = max(by_label.get(label, -1.0), float(sim))

    # A single keyword hit nudges rather than decides.
    for label, hits in keyword_scores.items():
        by_label[label] = by_label.get(label, 0.0) + 0.02 * hits

    best_label = max(by_label, key=by_label.get)
    best_sim = by_label[best_label]
    if best_sim < MIN_SIMILARITY:
        return OTHER[0], float(best_sim)
    return best_label, float(best_sim)
