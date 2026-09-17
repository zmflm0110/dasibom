import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from dasibom.pairing import Pairing, generate_pin

results = []


def check(label, cond):
    print(f"{'PASS' if cond else 'FAIL'}  {label}")
    results.append(cond)


pin = generate_pin()
check("generate_pin returns a 6-digit numeric string", len(pin) == 6 and pin.isdigit())

p = Pairing()
check("wrong pin is rejected", p.try_pair("000000" if p.pin != "000000" else "111111", "1.2.3.4") is None)

token = p.try_pair(p.pin, "1.2.3.4")
check("correct pin returns a token", token is not None and len(token) > 10)
check("issued token is valid", p.is_valid_token(token))
check("random token is invalid", not p.is_valid_token("not-a-real-token"))
check("empty/None token is invalid", not p.is_valid_token(None) and not p.is_valid_token(""))

p.revoke_all()
check("revoke_all invalidates previously issued tokens", not p.is_valid_token(token))

# Rate limiting: hammer with wrong PINs from the same address.
p2 = Pairing()
wrong = "000000" if p2.pin != "000000" else "111111"
outcomes = [p2.try_pair(wrong, "9.9.9.9") for _ in range(20)]
check("all wrong attempts fail", all(o is None for o in outcomes))
# Even the *correct* PIN should now be locked out after too many attempts from this IP.
check("correct pin is locked out after too many failed attempts from same IP",
      p2.try_pair(p2.pin, "9.9.9.9") is None)
# A different source address is unaffected by another address's failed attempts.
check("a different IP is not rate-limited by someone else's failures",
      p2.try_pair(p2.pin, "8.8.8.8") is not None)

# --- 영속화: 앱을 재시작해도 폰이 연결된 상태로 남아야 한다 ---
# (이전엔 토큰이 메모리에만 있어서 재시작마다 QR을 다시 찍어야 했다)
storage: list[str] = []
p3 = Pairing(load=lambda: list(storage), save=lambda h: storage.__setitem__(slice(None), h))
token3 = p3.try_pair(p3.pin, "10.0.0.1")
check("페어링 시 저장소에 기록됨", len(storage) == 1)
check("저장된 값이 원문 토큰이 아님(해시)", token3 not in storage)

restarted = Pairing(load=lambda: list(storage), save=lambda h: storage.__setitem__(slice(None), h))
check("재시작 후에도 기존 토큰이 유효", restarted.is_valid_token(token3))
check("재시작 시 PIN 은 새로 발급 (기기 추가는 여전히 재스캔 필요)",
      len(restarted.pin) == 6 and restarted.pin.isdigit())
check("재시작본에서 해제하면 저장소도 비워짐",
      (restarted.revoke_all(), len(storage) == 0)[1])
check("해제 후에는 토큰 무효", not restarted.is_valid_token(token3))

total, passed = len(results), sum(results)
print(f"\n{passed}/{total} passed")
if passed != total:
    sys.exit(1)
