"""Vision OCR emits a bare "X" for glyphs it can't render, so an emoji in a
KakaoTalk screenshot arrives as "김치 보냈다 X". Cleaning that is easy to get
wrong in two directions: too greedy eats real text ("3세트 x 12회"), and \\s
instead of [ \\t] welds two OCR lines together.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from dasibom.ocr import clean

CASES = [
    (["엄마: 김치 보냈다 X", "택배 월요일 도착한대"],
     "엄마: 김치 보냈다\n택배 월요일 도착한대", "줄 끝 이모지 제거, 줄바꿈 보존"),
    (["고마워요 X 잘 먹을게"], "고마워요 잘 먹을게", "문장 중간 이모지 제거"),
    (["스쿼트 3세트 x 12회"], "스쿼트 3세트 x 12회", "곱하기 x 보존"),
    (["사이즈 L X 2개"], "사이즈 L X 2개", "영문 사이 X 보존"),
    (["X 로 시작하는 줄"], "X 로 시작하는 줄", "한글 뒤가 아니면 보존"),
    (["가격 10000원", "배송 무료"], "가격 10000원\n배송 무료", "X 없으면 그대로"),
    ([], "", "빈 입력"),
]

results = []
for lines, expected, label in CASES:
    got = clean(lines)
    ok = got == expected
    results.append(ok)
    print(f"{'PASS' if ok else 'FAIL'}  {label}")
    if not ok:
        print(f"      got={got!r}\n      expected={expected!r}")

total, passed = len(results), sum(results)
print(f"\n{passed}/{total} passed")
if passed != total:
    sys.exit(1)
