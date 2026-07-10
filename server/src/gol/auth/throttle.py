"""Login throttling: exponential backoff per source IP plus a global counter.

In-memory is fine — single user, single process (ARCHITECTURE.md).
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field

FREE_ATTEMPTS = 3
MAX_DELAY_SECONDS = 300.0


def _delay_for(failures: int) -> float:
    if failures < FREE_ATTEMPTS:
        return 0.0
    return min(2.0 ** (failures - FREE_ATTEMPTS), MAX_DELAY_SECONDS)


@dataclass
class _Bucket:
    failures: int = 0
    locked_until: float = 0.0


@dataclass
class LoginThrottle:
    per_ip: dict[str, _Bucket] = field(default_factory=dict)
    global_bucket: _Bucket = field(default_factory=_Bucket)

    def retry_after(self, ip: str, now: float | None = None) -> float:
        """Seconds until another attempt is allowed (0 = allowed now)."""
        now = time.monotonic() if now is None else now
        waits = [self.global_bucket.locked_until - now]
        if ip in self.per_ip:
            waits.append(self.per_ip[ip].locked_until - now)
        return max(0.0, *waits)

    def record_failure(self, ip: str, now: float | None = None) -> None:
        now = time.monotonic() if now is None else now
        bucket = self.per_ip.setdefault(ip, _Bucket())
        for b, free in ((bucket, 0), (self.global_bucket, FREE_ATTEMPTS * 3)):
            b.failures += 1
            b.locked_until = now + _delay_for(b.failures - free)

    def record_success(self, ip: str) -> None:
        self.per_ip.pop(ip, None)
        self.global_bucket = _Bucket()
