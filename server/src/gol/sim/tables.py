"""US retirement-timing tables (pure data; see docs/DECISIONS.md 2026-07-10).

Coarse but real: standard Social Security actuarial claiming factors around a
fixed FRA of 67, and the IRS Uniform Lifetime Table for RMD divisors.
"""

from __future__ import annotations

FRA_AGE = 67

# Benefit as a fraction of the FRA amount by claiming age (FRA fixed at 67,
# per-year linear steps; docs/API.md v1.1 household section).
SS_CLAIM_FACTORS: dict[int, float] = {
    62: 0.70,
    63: 0.75,
    64: 0.80,
    65: 0.8667,
    66: 0.9333,
    67: 1.0,
    68: 1.08,
    69: 1.16,
    70: 1.24,
}

# SECURE 2.0: RMDs begin at 73 for those born before 1960, 75 for 1960+.
RMD_START_PRE_1960 = 73
RMD_START_1960_PLUS = 75


def rmd_start_age(birth_year: int) -> int:
    return RMD_START_PRE_1960 if birth_year < 1960 else RMD_START_1960_PLUS


# IRS Uniform Lifetime Table divisors by age — Publication 590-B, Table III,
# as effective for distribution years 2022 and later. Annual RMD = tax-deferred
# balance / divisor. Ages above the table's last row use the age-120+ divisor.
RMD_UNIFORM_LIFETIME: dict[int, float] = {
    72: 27.4, 73: 26.5, 74: 25.5, 75: 24.6, 76: 23.7,
    77: 22.9, 78: 22.0, 79: 21.1, 80: 20.2, 81: 19.4,
    82: 18.5, 83: 17.7, 84: 16.8, 85: 16.0, 86: 15.2,
    87: 14.4, 88: 13.7, 89: 12.9, 90: 12.2, 91: 11.5,
    92: 10.8, 93: 10.1, 94: 9.5, 95: 8.9, 96: 8.4,
    97: 7.8, 98: 7.3, 99: 6.8, 100: 6.4, 101: 6.0,
    102: 5.6, 103: 5.2, 104: 4.9, 105: 4.6, 106: 4.3,
    107: 4.1, 108: 3.9, 109: 3.7, 110: 3.5, 111: 3.4,
    112: 3.3, 113: 3.1, 114: 3.0, 115: 2.9, 116: 2.8,
    117: 2.7, 118: 2.5, 119: 2.3, 120: 2.0,
}

_RMD_MAX_AGE = max(RMD_UNIFORM_LIFETIME)


def rmd_divisor(age: int) -> float:
    """Uniform Lifetime Table divisor for `age` (clamped to the 120+ row)."""
    return RMD_UNIFORM_LIFETIME[min(age, _RMD_MAX_AGE)]
