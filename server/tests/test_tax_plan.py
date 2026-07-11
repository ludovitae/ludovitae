"""gol.tax.plan — one composed household tax year, scalar and vectorized.

End-to-end expectations are computed by hand from the 2026 tables (IRS Rev.
Proc. 2025-32, cross-checked at
https://taxfoundation.org/data/all/federal/2026-tax-brackets/) and the IRS
Pub 915 worksheet (https://www.irs.gov/publications/p915).
"""

import numpy as np
import pytest

from gol.tax.plan import TaxYearInput, TaxYearResult, compute_tax_year


def test_end_to_end_single_retiree_cited():
    # Single retiree, tax year 2026:
    #   SS benefits 24,000; tax-deferred withdrawals 30,000; no other income.
    #
    # Taxable SS (Pub 915, single thresholds 25,000/34,000):
    #   provisional = 30,000 + 0.5 x 24,000 = 42,000 > 34,000
    #   50% tier: min(0.5 x min(42,000-25,000, 34,000-25,000), 12,000) = 4,500
    #   85% tier: 0.85 x (42,000 - 34,000) = 6,800
    #   taxable SS = min(11,300, 0.85 x 24,000 = 20,400) = 11,300
    #
    # AGI     = 30,000 + 11,300 = 41,300
    # taxable = 41,300 - 16,100 (std ded) = 25,200
    # tax     = 10% x 12,400 + 12% x (25,200 - 12,400)
    #         = 1,240 + 1,536 = 2,776
    # effective = 2,776 / (30,000 + 24,000) = 0.05140740...
    res = compute_tax_year(
        TaxYearInput(
            filing_status="single",
            ss_benefits=24_000.0,
            tax_deferred_withdrawals=30_000.0,
        )
    )
    assert res.taxable_ss == pytest.approx(11_300.0)
    assert res.agi == pytest.approx(41_300.0)
    assert res.taxable_income == pytest.approx(25_200.0)
    assert res.tax == pytest.approx(2_776.0)
    assert res.marginal_rate == 0.12
    assert res.effective_rate == pytest.approx(2_776.0 / 54_000.0)
    assert all(
        isinstance(v, float)
        for v in (res.taxable_ss, res.agi, res.taxable_income, res.tax,
                  res.effective_rate, res.marginal_rate)
    )


def test_end_to_end_mfj_retirees_cited():
    # MFJ household, tax year 2026:
    #   SS benefits 40,000; tax-deferred withdrawals 60,000.
    #
    # Taxable SS (Pub 915, MFJ thresholds 32,000/44,000):
    #   provisional = 60,000 + 20,000 = 80,000 > 44,000
    #   50% tier: min(0.5 x min(48,000, 12,000), 20,000) = 6,000
    #   85% tier: 0.85 x (80,000 - 44,000) = 30,600 -> 36,600
    #   taxable SS = min(36,600, 0.85 x 40,000) = 34,000 (cap binds)
    #
    # AGI     = 60,000 + 34,000 = 94,000
    # taxable = 94,000 - 32,200 (std ded) = 61,800
    # tax     = 10% x 24,800 + 12% x (61,800 - 24,800)
    #         = 2,480 + 4,440 = 6,920
    # effective = 6,920 / (60,000 + 40,000) = 0.0692
    res = compute_tax_year(
        TaxYearInput(
            filing_status="mfj",
            ss_benefits=40_000.0,
            tax_deferred_withdrawals=60_000.0,
        )
    )
    assert res.taxable_ss == pytest.approx(34_000.0)
    assert res.agi == pytest.approx(94_000.0)
    assert res.taxable_income == pytest.approx(61_800.0)
    assert res.tax == pytest.approx(6_920.0)
    assert res.marginal_rate == 0.12
    assert res.effective_rate == pytest.approx(0.0692)


def test_wages_only_single():
    # Single, wages 100,000: taxable = 83,900; tax = 13,170 (see
    # test_tax_federal hand-working). Effective = 13.17%.
    res = compute_tax_year(TaxYearInput(filing_status="single", ordinary_income=100_000.0))
    assert res.taxable_ss == 0.0
    assert res.tax == pytest.approx(13_170.0)
    assert res.effective_rate == pytest.approx(0.1317)
    assert res.marginal_rate == 0.22


def test_no_income_all_zero_no_nan():
    res = compute_tax_year(TaxYearInput(filing_status="mfj"))
    assert res.tax == 0.0
    assert res.effective_rate == 0.0  # guarded division
    assert res.taxable_income == 0.0


def test_deduction_override():
    res = compute_tax_year(
        TaxYearInput(filing_status="single", ordinary_income=50_000.0, deduction=0.0)
    )
    assert res.taxable_income == pytest.approx(50_000.0)
    # 10% x 12,400 + 12% x 37,600 = 1,240 + 4,512 = 5,752
    assert res.tax == pytest.approx(5_752.0)


def test_income_below_standard_deduction_owes_nothing():
    res = compute_tax_year(TaxYearInput(filing_status="mfj", ordinary_income=30_000.0))
    assert res.taxable_income == 0.0
    assert res.tax == 0.0


def test_price_index_keeps_real_tax_constant_without_ss():
    # Brackets and standard deduction scale with the index, so doubling all
    # nominal income at index=2 exactly doubles nominal tax (equal real tax).
    base = compute_tax_year(TaxYearInput(filing_status="single", ordinary_income=100_000.0))
    inflated = compute_tax_year(
        TaxYearInput(filing_status="single", ordinary_income=200_000.0, price_index=2.0)
    )
    assert inflated.tax == pytest.approx(2.0 * base.tax)
    assert inflated.effective_rate == pytest.approx(base.effective_rate)


def test_price_index_does_not_scale_ss_thresholds():
    # The SS taxability thresholds are nominal/unindexed (IRC §86(c)), so the
    # same *real* retiree income at index=2 pushes a larger share of the
    # benefit into taxation — the well-known bracket creep on SS.
    base = compute_tax_year(
        TaxYearInput(
            filing_status="single", ss_benefits=24_000.0, tax_deferred_withdrawals=30_000.0
        )
    )
    inflated = compute_tax_year(
        TaxYearInput(
            filing_status="single",
            ss_benefits=48_000.0,
            tax_deferred_withdrawals=60_000.0,
            price_index=2.0,
        )
    )
    assert base.taxable_ss == pytest.approx(11_300.0)
    # Nominal 40,800 (the 85% cap binds at this income) > 2 x 11,300.
    assert inflated.taxable_ss == pytest.approx(40_800.0)
    assert inflated.taxable_ss > 2.0 * base.taxable_ss
    assert inflated.effective_rate > base.effective_rate


def test_vectorized_paths_match_scalar_loop():
    # (n_paths,) arrays through every amount field must equal per-path scalar
    # computation, field by field, exactly.
    rng = np.random.default_rng(42)
    n = 64
    ordinary = rng.uniform(0.0, 150_000.0, n)
    ss = rng.uniform(0.0, 50_000.0, n)
    withdrawals = rng.uniform(0.0, 120_000.0, n)
    index = rng.uniform(1.0, 2.5, n)

    vec = compute_tax_year(
        TaxYearInput(
            filing_status="mfj",
            ordinary_income=ordinary,
            ss_benefits=ss,
            tax_deferred_withdrawals=withdrawals,
            price_index=index,
        )
    )
    assert isinstance(vec, TaxYearResult)
    for field in ("taxable_ss", "agi", "taxable_income", "tax",
                  "effective_rate", "marginal_rate"):
        arr = getattr(vec, field)
        assert isinstance(arr, np.ndarray) and arr.shape == (n,), field

    for i in range(n):
        scalar = compute_tax_year(
            TaxYearInput(
                filing_status="mfj",
                ordinary_income=float(ordinary[i]),
                ss_benefits=float(ss[i]),
                tax_deferred_withdrawals=float(withdrawals[i]),
                price_index=float(index[i]),
            )
        )
        assert vec.tax[i] == scalar.tax
        assert vec.taxable_ss[i] == scalar.taxable_ss
        assert vec.agi[i] == scalar.agi
        assert vec.taxable_income[i] == scalar.taxable_income
        assert vec.effective_rate[i] == scalar.effective_rate
        assert vec.marginal_rate[i] == scalar.marginal_rate


def test_mixed_scalar_and_array_fields_broadcast():
    withdrawals = np.array([0.0, 30_000.0, 100_000.0])
    res = compute_tax_year(
        TaxYearInput(
            filing_status="single", ss_benefits=24_000.0,
            tax_deferred_withdrawals=withdrawals,
        )
    )
    assert res.tax.shape == (3,)
    assert res.taxable_ss.shape == (3,)
    assert res.tax[0] == 0.0  # SS alone, provisional 12,000 < 25,000
    assert res.tax[1] == pytest.approx(2_776.0)  # the cited single example
    assert np.all(np.diff(res.tax) > 0.0)


def test_unknown_filing_status_raises():
    with pytest.raises(ValueError, match="filing_status"):
        compute_tax_year(TaxYearInput(filing_status="head_of_household"))
