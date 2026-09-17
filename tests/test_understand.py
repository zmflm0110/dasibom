"""Local-LLM understanding: validation layer and taxonomy behavior.

The generation path needs the ~1.7GB model, so it is skipped when mlx-lm isn't
installed. The validation rules are pure functions and always run -- they are
what catches the failure modes a 3B model actually produces: echoing the schema
placeholder back ("분류명") and drifting into Chinese ("健康生活").
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from dasibom import understand

results = []


def check(label, cond):
    print(f"{'PASS' if cond else 'FAIL'}  {label}")
    results.append(cond)


# --- validation (always runs) ---
check("스키마 플레이스홀더 거부", not understand._valid_label("분류명"))
check("영어 플레이스홀더 거부", not understand._valid_label("label"))
check("한자 드리프트 거부", not understand._valid_label("健康生活"))
check("한 글자 거부", not understand._valid_label("밥"))
check("너무 긴 라벨 거부", not understand._valid_label("반려동물병원예방접종기록"))
check("정상 한국어 라벨 허용", understand._valid_label("면접준비"))
check("짧은 영문 기술어 허용", understand._valid_label("API"))

# 요약도 같은 드리프트를 겪는다 (배치 실행에서 "運動 루틴 정리" 관측)
check("요약의 한자 드리프트 거부", not understand._valid_summary("運動 루틴 정리 및 세부사항"))
check("정상 한국어 요약 허용", understand._valid_summary("운동 루틴 정리 및 세부사항"))
check("빈 요약은 허용", understand._valid_summary(""))

# --- JSON extraction tolerance ---
check("코드펜스 감싼 JSON 파싱",
      understand._extract_json('```json\n{"label":"운동","summary":"s","tags":[]}\n```') is not None)
check("설명 뒤에 붙은 JSON 파싱",
      understand._extract_json('네, 분석했습니다.\n{"label":"운동","summary":"s"}') is not None)
check("JSON 없으면 None", understand._extract_json("그냥 텍스트입니다") is None)

# --- taxonomy reuse (no embeddings: measured that short Korean labels are
#     inseparable by cosine distance, all 66 pairs within 0.865-0.928) ---
check("기존 라벨 정확 재사용", understand.canonicalize("운동", ["운동", "레시피"]) == "운동")
check("띄어쓰기 차이 흡수", understand.canonicalize("면접 준비", ["면접준비"]) == "면접준비")
check("무관한 라벨은 병합 안 함", understand.canonicalize("환율", ["음식점정보"]) == "환율")

# --- generation (only with the model present) ---
if understand.is_available():
    result = understand.understand("성수동 카페 추천\n연무장길 로스터리, 아메리카노 4500원")
    check("실제 생성이 유효한 라벨 반환", bool(result) and understand._valid_label(result["label"]))
    if result:
        print(f"      -> [{result['label']}] {result['summary'][:40]}")
else:
    print("SKIP  실제 생성 (mlx-lm 미설치)")

total, passed = len(results), sum(results)
print(f"\n{passed}/{total} passed")
if passed != total:
    sys.exit(1)
