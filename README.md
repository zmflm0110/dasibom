# ClipMind

AI 기반 클립보드 기억 시스템. 단순 저장이 아니라 **복사 → 자동 분류 → 로컬 임베딩 → 의미 검색 → 조합**까지
전부 로컬에서, 외부 AI API 호출 없이 동작한다.

## 구조

```
복사 (NSPasteboard 폴링)
    -> classifier.py   규칙 기반 분류 (url/email/path/code[언어]/한국어·영어 텍스트)
    -> store.py        SQLite 저장 (내용, 분류, 캡처 당시 활성 앱, 임베딩)
    -> embeddings.py   다국어 문장 임베딩 (paraphrase-multilingual-MiniLM-L12-v2)
                        미설치 시 search.py가 TF-IDF로 자동 폴백
    -> search.py        의미 검색 (코사인 유사도) / 키워드 검색
    -> combine.py       여러 클립을 하나로 병합
```

## 설치

```bash
pip3 install -r requirements.txt
```

`sentence-transformers`가 없어도 전부 동작한다 (TF-IDF 폴백). 단, 이 경우
"로그인 코드 찾아줘" 같은 한국어 질의로 영어 코드를 찾는 진짜 의미/교차언어 검색은
안 되고, **질의와 문자열이 겹칠 때만** 찾아진다. 교차언어 의미 검색을 쓰려면
sentence-transformers가 필요하다 (설치 시 첫 실행에 모델 ~420MB 다운로드).

## 사용법

```bash
# 데몬 시작 (클립보드 감시)
python3 -m clipmind.cli start

# 최근 클립 목록
python3 -m clipmind.cli list --limit 20

# 의미 검색
python3 -m clipmind.cli search "JWT 토큰 발급하는 코드"

# 키워드(부분 문자열) 검색
python3 -m clipmind.cli search "FastAPI" --keyword

# 클립 전체 내용 보기
python3 -m clipmind.cli show 5

# 여러 클립을 하나로 합치기
python3 -m clipmind.cli combine 2 5 7

# 카테고리별 통계
python3 -m clipmind.cli stats

# 지금 어떤 앱을 보고 있는지에 따라 맥락 맞춤 추천 (코드 에디터면 code 카테고리로 좁혀 검색)
python3 -m clipmind.cli suggest
python3 -m clipmind.cli suggest "JWT 인증 관련 코드"
```

## 테스트

```bash
python3 tests/test_classifier.py
python3 tests/test_store_search.py
```

## 검증된 것 (실제로 돌려본 결과)

- 분류기: url/email/path/code(python/js/html/sql/shell/json)/한국어·영어 텍스트 15/15 케이스 통과.
- 실시간 캡처: `pbcopy`로 클립보드를 바꾸면 0.3~0.5초 내 감지, 분류, 활성 앱과 함께 SQLite에 저장됨을 확인.
- 의미 검색: "회의 일정" 질의가 "내일 오전 10시에 팀 회의..." 텍스트를 score 0.72로 정확히 1위로 찾음.
- 교차언어 검색: 한국어 질의("로그인 인증 토큰 발급하는 코드")가 영어 JWT 코드 스니펫을
  (문자열이 전혀 안 겹치는데도) top-3 안에서 찾아냄 — 진짜 의미 기반 임베딩이 동작함을 확인.
- 중복 억제: 동일한 내용을 연속으로 복사해도 한 번만 저장.

## 알려진 한계 (현실성 판단)

- **소규모 표본에서 랭킹이 흔들림.** MiniLM 기반 경량 모델이라 항목이 몇 개 안 될 때는
  관련 없는 항목이 1위로 오는 경우가 있었다 (예: 짧은 텍스트/이메일이 코드보다 위로 감).
  항목 수가 늘어날수록(문서가 많아질수록) 상대적 랭킹은 보통 개선된다 — 더 큰 실사용
  데이터로 재검증 필요.
- **활성 앱 감지는 GUI 세션에서만 의미 있음.** 터미널/헤드리스 컨텍스트에서 캡처하면
  `frontmostApplication()`이 `loginwindow` 등 엉뚱한 값을 반환할 수 있음 — 실제 데스크톱
  세션(사용자가 직접 로그인해서 Dock이 떠 있는 상태)에서 재확인 필요.
- **상시 실행(로그인 시 자동 시작)은 아직 없음.** `clipmind start`를 수동 실행해야 함.
  다음 단계로 launchd plist를 붙이면 로그인 시 자동 시작 가능 (시스템 자동시작 항목을
  건드리는 작업이라 별도 확인 후 진행 예정).
- **"현재 작업 맥락 보고 추천"은 기초 수준까지만 구현됨** (`clipmind suggest`).
  현재 최전면 앱 이름만으로 code/기타 맥락을 추정해 검색 범위를 좁힘 — 실제 VS Code 파일
  내용이나 커서 위치를 읽는 건 접근성 권한이 필요한 다음 단계이고 아직 없음.
- **메뉴바 UI 없음.** 현재는 CLI만 있음. `rumps`로 메뉴바 앱을 얹는 게 다음 자연스러운 단계.
