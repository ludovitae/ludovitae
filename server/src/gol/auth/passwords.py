"""Password hashing with argon2id. Plaintext never touches the database."""

from __future__ import annotations

from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError
from argon2.low_level import Type

# argon2id parameters pinned explicitly (not left to library defaults) so an
# upstream default change can never silently weaken hashing. These meet/exceed
# the OWASP argon2id minimum (memory >= 19 MiB, time_cost >= 2, parallelism 1).
_hasher = PasswordHasher(
    type=Type.ID,
    time_cost=3,
    memory_cost=64 * 1024,  # 64 MiB
    parallelism=4,
    hash_len=32,
    salt_len=16,
)

MIN_PASSWORD_LENGTH = 10


def hash_password(password: str) -> str:
    return _hasher.hash(password)


def verify_password(password_hash: str, password: str) -> bool:
    try:
        return _hasher.verify(password_hash, password)
    except VerifyMismatchError:
        return False
    except Exception:
        return False
