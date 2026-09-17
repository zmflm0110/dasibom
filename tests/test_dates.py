import datetime
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from dasibom.dates import extract_event_date, days_until

TODAY = datetime.date(2026, 9, 17)

CASES = [
    ("예약 확인\n10월 3일 오후 7시 2인 예약 완료", datetime.date(2026, 10, 3)),
    ("공연 티켓\n11월 2일 8시 좌석 A열 12번", datetime.date(2026, 11, 2)),
    ("국립현대미술관\n11월까지 무료 관람", datetime.date(2026, 11, 30)),
    ("예방접종\n2026년 11월 15일 종합백신 2차", datetime.date(2026, 11, 15)),
    ("배송 조회\n2026-10-08 도착 예정", datetime.date(2026, 10, 8)),
    ("세미나\n2026.12.01 오후 2시", datetime.date(2026, 12, 1)),
    # 이미 지난 날짜(한 달 이상) -> 내년 것으로 해석
    ("벚꽃 축제\n4월 5일 여의도", datetime.date(2027, 4, 5)),
    # 최근에 지난 날짜는 올해로 유지 (어제 예약을 못 찾으면 안 됨)
    ("예약\n9월 10일 오후 3시", datetime.date(2026, 9, 10)),
    # 날짜 아님
    ("성수동 카페\n아메리카노 4500원", None),
    ("운동 루틴\n주 5회 30분씩", None),
    # 존재하지 않는 날짜
    ("이상한 날짜\n13월 45일", None),
    ("", None),
]

results = []
for text, expected in CASES:
    got = extract_event_date(text, today=TODAY)
    ok = got == expected
    results.append(ok)
    label = text.splitlines()[0] if text else "(빈 문자열)"
    print(f"{'PASS' if ok else 'FAIL'}  {label:<22} got={got} expected={expected}")

d = extract_event_date("예약 확인\n9월 20일 오후 7시", today=TODAY)
ok = days_until(d, TODAY) == 3
results.append(ok)
print(f"{'PASS' if ok else 'FAIL'}  days_until 계산 (9/20 - 9/17 = 3)")

total, passed = len(results), sum(results)
print(f"\n{passed}/{total} passed")
if passed != total:
    sys.exit(1)
