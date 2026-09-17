"""Deleting a clip must take its image file with it -- but only when no other
clip still points at that file.

Image filenames are content hashes, so saving the same screenshot twice yields
one file with two rows referencing it. Before this was handled, every delete
left the file behind (a slow disk leak); deleting unconditionally would have
been worse, blanking the surviving clip's thumbnail.
"""
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from dasibom import store

results = []


def check(label, cond):
    print(f"{'PASS' if cond else 'FAIL'}  {label}")
    results.append(cond)


tmp = Path(tempfile.mkdtemp())
db_path = tmp / "t.db"
images_dir = tmp / "images"
images_dir.mkdir()

# store resolves image paths relative to the DB's parent directory
original_db, original_images = store.DB_PATH, store.IMAGES_DIR
store.DB_PATH, store.IMAGES_DIR = db_path, images_dir
try:
    conn = store.connect(db_path)

    shared = images_dir / "shared.png"
    lonely = images_dir / "lonely.png"
    shared.write_bytes(b"fake-png")
    lonely.write_bytes(b"fake-png-2")

    a = store.add_clip(conn, "첫 번째 스크린샷", "image", None, "t", "images/shared.png")
    b = store.add_clip(conn, "같은 이미지의 두 번째 클립", "image", None, "t", "images/shared.png")
    c = store.add_clip(conn, "혼자 쓰는 이미지", "image", None, "t", "images/lonely.png")

    check("삭제 전 두 파일 모두 존재", shared.exists() and lonely.exists())

    store.delete_clip(conn, a)
    check("아직 다른 클립이 쓰는 파일은 남는다", shared.exists())

    store.delete_clip(conn, b)
    check("마지막 참조가 사라지면 파일도 삭제", not shared.exists())

    store.delete_clip(conn, c)
    check("단독 참조 파일도 삭제", not lonely.exists())

    check("없는 클립 삭제는 False", store.delete_clip(conn, 99999) is False)

    # 파일이 이미 사라진 뒤 삭제해도 예외가 나면 안 된다
    d = store.add_clip(conn, "파일 없는 클립", "image", None, "t", "images/missing.png")
    check("파일이 없어도 삭제가 실패하지 않음", store.delete_clip(conn, d) is True)
finally:
    store.DB_PATH, store.IMAGES_DIR = original_db, original_images

total, passed = len(results), sum(results)
print(f"\n{passed}/{total} passed")
if passed != total:
    sys.exit(1)
