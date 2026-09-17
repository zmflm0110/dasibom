import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from clipmind.classifier import classify


def check(text, expected_category, expected_subtype=None):
    cat, sub = classify(text)
    ok = cat == expected_category and (expected_subtype is None or sub == expected_subtype)
    status = "PASS" if ok else "FAIL"
    print(f"{status}  got=({cat!r},{sub!r}) expected=({expected_category!r},{expected_subtype!r})  text={text[:40]!r}")
    return ok


cases = [
    ("https://example.com/foo?bar=1", "url"),
    ("www.naver.com", "url"),
    ("test.user123@naver.com", "email"),
    ("/Users/chrismoon/ClipMind/data", "path"),
    ('{"name": "chris", "age": 20}', "code", "json"),
    ("def train_model():\n    return model", "code", "python"),
    ("import torch\nfrom torch import nn", "code", "python"),
    ("const x = () => {\n  console.log('hi')\n}", "code", "javascript"),
    ("<div class=\"box\"><span>hi</span></div>", "code", "html"),
    ("SELECT * FROM users WHERE id = 1", "code", "sql"),
    ("git status\ngit add .\ngit commit -m 'x'", "code", "shell"),
    ("오늘 회의는 3시에 시작합니다", "korean_text"),
    ("The quick brown fox jumps over the lazy dog", "english_text"),
    ("hello123", "short"),
    ("", "empty"),
]

results = [check(*c) for c in cases]
total, passed = len(results), sum(results)
print(f"\n{passed}/{total} passed")
if passed != total:
    sys.exit(1)
