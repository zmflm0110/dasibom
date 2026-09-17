"""LAN pairing for the phone client.

The Mac desktop app always talks to the server over 127.0.0.1 and is trusted
implicitly (see webapp.py's _is_trusted_request). Everything here exists
only to gate *other* devices on the same WiFi network: without it, binding
Flask to 0.0.0.0 would hand your entire clipboard history to anyone on the
same network with no authentication at all.

Design: a random 6-digit PIN is generated per app launch. A device proves it
saw that PIN once (by scanning the QR code shown in the desktop app, or
typing it in) and gets back a long-lived opaque bearer token to use after
that. Failed PIN attempts are rate-limited per source IP.
"""
import secrets
import time

PIN_LENGTH = 6
MAX_ATTEMPTS = 8
ATTEMPT_WINDOW_SECONDS = 60


def generate_pin() -> str:
    return f"{secrets.randbelow(10 ** PIN_LENGTH):0{PIN_LENGTH}d}"


class Pairing:
    def __init__(self):
        self.pin = generate_pin()
        self.tokens: set[str] = set()
        self._attempts: dict[str, list[float]] = {}

    def rotate_pin(self) -> str:
        self.pin = generate_pin()
        return self.pin

    def _too_many_attempts(self, remote_addr: str) -> bool:
        now = time.time()
        history = [t for t in self._attempts.get(remote_addr, []) if now - t < ATTEMPT_WINDOW_SECONDS]
        self._attempts[remote_addr] = history
        return len(history) >= MAX_ATTEMPTS

    def try_pair(self, pin: str, remote_addr: str) -> str | None:
        if self._too_many_attempts(remote_addr):
            return None
        self._attempts.setdefault(remote_addr, []).append(time.time())
        if not secrets.compare_digest(str(pin or ""), self.pin):
            return None
        token = secrets.token_hex(24)
        self.tokens.add(token)
        return token

    def is_valid_token(self, token: str | None) -> bool:
        return bool(token) and token in self.tokens

    def revoke_all(self):
        self.tokens.clear()
