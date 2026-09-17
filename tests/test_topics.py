"""Measured accuracy of screenshot topic classification.

The cases are written as OCR text would actually come out of a screenshot --
a title line plus body lines, no hand-holding.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from dasibom.topics import classify_topic, display_name

CASES = [
    ("성수동 카페 추천\n연무장길 로스터리, 아메리카노 4500원", "food"),
    ("을지로 노포 골목\n닭한마리 2인 28000원 웨이팅 30분", "food"),
    ("국립현대미술관\n11월까지 무료 관람, 월요일 휴관", "place"),
    ("제주 3박 4일\n숙소 예약 완료, 렌터카 비교 필요", "place"),
    ("파이썬 데코레이터\nfunctools.wraps 안 쓰면 함수 이름이 사라짐", "dev"),
    ("git reset --hard 복구\nreflog 로 커밋 해시 찾아서 되돌리기", "dev"),
    ("운동 루틴\n월수금 상체, 화목 하체, 주 5회", "workout"),
    ("단백질 섭취량\n체중 1kg당 1.6g, 하루 세 번 나눠서", "workout"),
    ("토마토 파스타 레시피\n마늘 넉넉히, 면수 한 국자, 소금 한 큰술", "cooking"),
    ("에어프라이어 삼겹살\n200도 12분, 중간에 한 번 뒤집기", "cooking"),
    ("아이폰 실리콘 케이스\n29000원 무료배송, 쿠폰 적용가", "shopping"),
    ("노트북 최저가\n할인 쿠폰 받고 구매하면 15% 추가 할인", "shopping"),
    ("예약 확정 안내\n10월 3일 오후 7시 2인 예약이 확정되었습니다", "booking"),
    ("공연 티켓 예매\n11월 2일 8시 좌석 A열 12번", "booking"),
    ("환율 메모\n1달러 1380원, 엔화 900원대", "money"),
    ("적금 금리 비교\n연 4.5% 12개월, 우대 조건 확인", "money"),
    ("읽을 책 목록\n사피엔스, 총균쇠, 팩트풀니스", "study"),
    ("영어 문법 정리\n관계대명사 that 과 which 의 차이", "study"),
    ("앱 아이디어\n스크린샷을 자동으로 정리해주는 서비스 만들기", "idea"),
]

results = []
misses = []
for text, expected in CASES:
    got, conf = classify_topic(text)
    ok = got == expected
    results.append(ok)
    if not ok:
        misses.append((text.splitlines()[0], expected, got, conf))

total, passed = len(results), sum(results)
print(f"분류 정확도: {passed}/{total} ({passed / total * 100:.0f}%)")
if misses:
    print("\n오답:")
    for title, exp, got, conf in misses:
        print(f"  {title[:28]:<30} 정답={display_name(exp):<10} 예측={display_name(got):<10} conf={conf:.2f}")

# Regression floor: a topic layer worse than this is not pulling its weight.
if passed / total < 0.80:
    print(f"\nFAIL: 정확도 80% 미만")
    sys.exit(1)
print("\nPASS")
