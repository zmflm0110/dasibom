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
import hashlib
import secrets
import time
from typing import Callable, Optional

PIN_LENGTH = 6
MAX_ATTEMPTS = 8
ATTEMPT_WINDOW_SECONDS = 60


def generate_pin() -> str:
    return f"{secrets.randbelow(10 ** PIN_LENGTH):0{PIN_LENGTH}d}"


def _hash(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


class Pairing:
    """PIN pairing with optional persistence.

    Tokens used to live only in memory, which meant every app restart silently
    logged the phone out -- re-scan the QR each time you reopened the Mac app.
    They're persisted now, as SHA-256 hashes: the DB already holds the
    screenshots so hashing isn't a real secret barrier, but a stored hash can't
    be replayed straight out of a backup.

    `load`/`save` are injected so this class stays testable without a database.
    """

    def __init__(self, load: Optional[Callable[[], list[str]]] = None,
                 save: Optional[Callable[[list[str]], None]] = None):
        self.pin = generate_pin()
        self._save = save
        self._token_hashes: set[str] = set(load() or []) if load else set()
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
        self._token_hashes.add(_hash(token))
        self._persist()
        return token

    def is_valid_token(self, token: str | None) -> bool:
        if not token:
            return False
        candidate = _hash(token)
        # compare_digest against each stored hash rather than a set lookup, so
        # the check doesn't leak timing information about which prefix matched
        return any(secrets.compare_digest(candidate, known) for known in self._token_hashes)

    def revoke_all(self):
        self._token_hashes.clear()
        self._persist()

    def _persist(self):
        if self._save:
            self._save(sorted(self._token_hashes))
