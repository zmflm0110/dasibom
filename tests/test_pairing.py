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

total, passed = len(results), sum(results)
print(f"\n{passed}/{total} passed")
if passed != total:
    sys.exit(1)
