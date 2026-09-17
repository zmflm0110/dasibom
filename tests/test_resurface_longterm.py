"""What does the nudge look like after a few weeks of use?

A resurfacing feature fails in two opposite ways and both are invisible in a
single-day test: it repeats the same couple of items until you stop reading it,
or it quietly develops a set of clips it will never show again. This simulates
app opens across several weeks and measures both.
"""
import datetime
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from dasibom import store

RESURFACE_COUNT = 3
UPCOMING_HORIZON_DAYS = 7
MIN_AGE_SECONDS = 3 * 24 * 3600

results = []


def check(label, cond, detail=""):
    print(f"{'PASS' if cond else 'FAIL'}  {label}{('  ' + detail) if detail else ''}")
    results.append(cond)


def resurface(conn, today: datetime.date):
    """Mirror of the /api/resurface handler, parameterized by date."""
    horizon = today + datetime.timedelta(days=UPCOMING_HORIZON_DAYS)
    upcoming = store.upcoming_clips(conn, today.isoformat(), horizon.isoformat(), RESURFACE_COUNT)
    items = [(r["id"], "upcoming") for r in upcoming]
    if len(items) < RESURFACE_COUNT:
        forgotten = store.resurface_candidates(
            conn, "image", MIN_AGE_SECONDS, RESURFACE_COUNT - len(items),
            today_iso=today.isoformat())
        items += [(r["id"], "forgotten") for r in forgotten]
        if forgotten:
            store.mark_surfaced(conn, [r["id"] for r in forgotten])
    return items


conn = store.connect(Path(tempfile.mkdtemp()) / "lt.db")
today = datetime.date(2026, 9, 17)
old = 30 * 86400  # backdate so everything clears the "3 days old" bar

dated_ids, undated_ids = [], []
for i in range(4):
    cid = store.add_clip(conn, f"예약 스크린샷 {i}", "image", None, "t", f"images/d{i}.png")
    store.set_event_date(conn, cid, (today + datetime.timedelta(days=2 + i * 3)).isoformat())
    dated_ids.append(cid)
for i in range(12):
    cid = store.add_clip(conn, f"아이디어 스크린샷 {i}", "image", None, "t", f"images/u{i}.png")
    undated_ids.append(cid)

import time as _t
conn.execute("UPDATE clips SET created_at = ?", (_t.time() - old,))
conn.commit()

# --- 3주간 하루 한 번 앱을 연다고 가정 ---
seen_per_day = []
for day_offset in range(21):
    day = today + datetime.timedelta(days=day_offset)
    seen_per_day.append(resurface(conn, day))

flat = [cid for day in seen_per_day for cid, _ in day]
undated_shown = {cid for cid in flat if cid in undated_ids}
dated_shown = {cid for cid in flat if cid in dated_ids}

check("날짜 없는 아이디어가 골고루 노출됨",
      len(undated_shown) >= len(undated_ids) * 0.8,
      f"{len(undated_shown)}/{len(undated_ids)}종")

worst_repeat = max(flat.count(cid) for cid in undated_shown) if undated_shown else 0
check("같은 아이디어가 3주간 과도하게 반복되지 않음", worst_repeat <= 4,
      f"최다 {worst_repeat}회")

# --- 날짜가 지난 항목은 이후에도 다시 떠오를 수 있어야 한다 ---
# 후보에 "들어가는가"를 본다. 어느 3건이 실제로 뽑히는지는 동점일 때 RANDOM()이
# 정하므로, 뽑힘 여부로 단언하면 테스트가 플래키해진다 (실측 5회 중 1회 실패).
far_future = today + datetime.timedelta(days=60)
eligible = store.resurface_candidates(conn, "image", MIN_AGE_SECONDS, 100,
                                      today_iso=far_future.isoformat())
eligible_ids = {r["id"] for r in eligible}
revivable = eligible_ids & set(dated_ids)
check("날짜가 지난 스크린샷도 다시 후보에 포함됨", len(revivable) == len(dated_ids),
      f"{len(revivable)}/{len(dated_ids)}건" if revivable else "영영 안 보임")

# 오늘 기준으로는 다가오는 일정이므로 후보에서 빠져 있어야 한다 (중복 노출 방지)
today_eligible = {r["id"] for r in store.resurface_candidates(
    conn, "image", MIN_AGE_SECONDS, 100, today_iso=today.isoformat())}
check("아직 안 지난 일정은 '잊힌 것' 후보에 안 들어감",
      not (today_eligible & set(dated_ids)))

# --- 다가오는 일정은 그 날까지만, 지나면 사라져야 한다 ---
day_before = resurface(conn, today + datetime.timedelta(days=1))
has_upcoming = any(kind == "upcoming" for _, kind in day_before)
check("일정이 가까우면 upcoming 으로 뜬다", has_upcoming)

after_all = resurface(conn, far_future)
still_upcoming = [cid for cid, kind in after_all if kind == "upcoming"]
check("지난 일정은 upcoming 에서 빠진다", not still_upcoming)

total, passed = len(results), sum(results)
print(f"\n{passed}/{total} passed")
if passed != total:
    sys.exit(1)
