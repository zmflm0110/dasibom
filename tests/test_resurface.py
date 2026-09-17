import sys
import tempfile
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from dasibom import store

tmp_dir = tempfile.mkdtemp()
conn = store.connect(Path(tmp_dir) / "test.db")

results = []


def check(label, cond):
    print(f"{'PASS' if cond else 'FAIL'}  {label}")
    results.append(cond)


# Insert 3 "old" image clips (backdated) and 1 "fresh" one.
old_ids = []
for i in range(3):
    cid = store.add_clip(conn, f"idea screenshot {i}", "image", None, "iPhone", f"images/{i}.png")
    old_ids.append(cid)
conn.execute("UPDATE clips SET created_at = ? WHERE id IN (%s)" % ",".join("?" * len(old_ids)),
             [time.time() - 10 * 86400, *old_ids])
conn.commit()

fresh_id = store.add_clip(conn, "brand new screenshot", "image", None, "iPhone", "images/fresh.png")

candidates = store.resurface_candidates(conn, "image", min_age_seconds=3 * 86400, limit=10)
candidate_ids = {r["id"] for r in candidates}
check("only clips older than the age cutoff are candidates", candidate_ids == set(old_ids))
check("a freshly-added clip is excluded", fresh_id not in candidate_ids)

# mark_surfaced should push those ids to the back of the queue.
store.mark_surfaced(conn, old_ids[:2])
next_round = store.resurface_candidates(conn, "image", min_age_seconds=3 * 86400, limit=1)
check("never-surfaced clip is preferred over already-surfaced ones",
      next_round[0]["id"] == old_ids[2])

total, passed = len(results), sum(results)
print(f"\n{passed}/{total} passed")
if passed != total:
    sys.exit(1)
