# T-012 — Bracket-aware tax workstream (parallel, long-running)

Owner: backend-dev agent · Branch: `ws/tax-brackets` (phase 1, merged) /
`ws/tax-integration` (phase 2) · Status: review (phase 2 complete, issue #5)

## Scope (owner: "honesty pass + start brackets in parallel")

Phase 1 (this task): a **standalone, engine-independent** `gol/tax/` module +
design doc. No engine.py changes — integration is a follow-up task after
T-011a merges, to avoid conflicts.

1. `gol/tax/federal.py`: 2026 federal brackets (MFJ + single), standard
   deduction, ordinary-income tax function; LTCG brackets (data only for now).
   Ship rates/thresholds as cited data tables. Inflation-index brackets by a
   supplied factor (the engine will pass its price index).
2. `gol/tax/social_security.py`: provisional-income taxable-share
   computation (0/50/85% tiers, real thresholds, deliberately unindexed —
   cite that this matches current law).
3. `gol/tax/plan.py`: a `TaxYearInput` → `TaxYearResult` pure function
   composing the above: ordinary income, SS, tax-deferred withdrawals →
   effective household tax for one year. Vectorization-ready (accept numpy
   arrays for the amount fields; scalars for statuses).
4. `docs/TAX-DESIGN.md`: integration plan — where the engine's flat-rate
   call sites are (income tax, withdrawal gross-up, RMD tax), what replaces
   each, filing-status source (household: MFJ if 2+ adult members else
   single — propose, don't implement), state tax explicitly out of scope for
   phase 1, and the validation plan (golden households cross-checked against
   a published tax calculator's numbers, cited).
5. Tests: bracket boundary cases, SS provisional-income tiers, MFJ vs
   single, array/scalar parity, a cited end-to-end example per filing status.

## Non-goals (phase 1)

Engine integration, withdrawal-ordering optimization, state tax, AMT/NIIT.

## Log

- 2026-07-11 (coordinator): created; phase 1 is deliberately standalone so it
  can build in parallel with everything else without merge conflicts.
- 2026-07-11 (backend-dev): phase 1 complete on `ws/tax-brackets`; status →
  review. New files only (zero conflict surface): `server/src/gol/tax/`
  (federal.py, social_security.py, plan.py), 3 test files (57 tests, suite
  162 → 219, ruff clean), `docs/TAX-DESIGN.md`. Decisions of note:
  (a) 2026 parameters are the **final published** Rev. Proc. 2025-32 figures
  (post-OBBBA), verified 2026-07-11 against irs.gov and taxfoundation.org —
  not projections; (b) SS taxability thresholds shipped deliberately
  unindexed per IRC §86(c), with a test pinning them against accidental
  indexing; (c) withdrawal gross-up proposal: marginal-rate estimate
  monthly + exact December settle-up (annual tax always exact; closed-form
  piecewise-linear inversion documented as the fallback if true-up cash
  cliffs show up in validation); (d) `effective_tax_rate_pct` proposed to
  become a nullable flat-override, preserving T-005 sim-identity for
  migrated profiles. Flag for coordinator: the proposed `tax_model` field in
  the simulate assumptions block is an API-contract addition (needs a
  ruling, coordinate with T-011a); filing-status rule ≥2-adults→MFJ has an
  `other`-adult wrinkle, refinement proposed in TAX-DESIGN.md §5.
- 2026-07-11 (backend-dev): **phase 2 complete** on `ws/tax-integration`
  (issue #5); status → review. Engine v3: `effective_tax_rate_pct=null`
  runs the bracket model per TAX-DESIGN §3-4; a set value keeps the flat
  v1/v2 path verbatim. Suite 291 → 304, ruff clean.

  **Exact response addition (coordinator ruling 4, also in docs/API.md
  §Simulation, marked v1.2.2/T-012 phase 2):** `assumptions.tax_model:
  "flat" | "brackets"`. Flat mode additionally carries
  `effective_tax_rate_pct` and `ss_taxable_share` exactly as v1.1.1;
  bracket mode instead carries `assumptions.filing_status: "single" |
  "mfj"`. `engine_version: "3"`; `engine_notes` has two entries (the
  bracket-mode change summary and the flat-mode "numerically unchanged
  from engine v2" note). `GET/PUT /profile.effective_tax_rate_pct` is now
  `null | 0..100` (omitted on PUT = null = brackets).

  **Rulings implemented:** (1) nullable override — migration 0005 keeps
  stored values (migrated DBs sim-identical), fresh profiles + demo seed
  are null; (2) filing status mfj iff ≥2 members with role in {self,
  partner}, `other` never counts — documented in TAX-DESIGN §5, asserted
  at API level; (3) annual settlement on the plan-year grid, monthly
  withholding at the year-start projected effective rate, December
  true-up; gross-up at current-marginal estimate; provisional-income SS
  share (flat mode keeps the 85% cap); RMDs enter ordinary income;
  brackets/deduction indexed by the per-path price index, SS thresholds
  nominal; (4) above; (5) below.

  **Flat-mode identity evidence:** every pre-existing golden passed
  UNCHANGED — test_sim_engine.py pinned v2 goldens (seed 1234: success
  0.742, ruin 86.5, det NW 4,335,800.73), and
  test_migration_identity.py's exact-equality (`result == GOLDEN`) run of
  a 0001→head-migrated v1 database, which now includes migration 0005
  (plus a new assertion that the migrated profile keeps its stored 18.0).

  **Bracket-mode goldens (seed 1234, 1000 paths, the standard golden
  household as single filer):** success 0.824, median ruin age 88.0, det
  NW[0] 923,042.70, det NW[-1] 5,749,590.65, p10[0] 829,719.55, p50[-1]
  3,764,762.52, ending {p10 -889,222.81, p50 3,764,762.52, p90
  12,718,615.50}. Documented direction vs flat 18%: this household's
  bracket effective rate is lower (working salary ~14% effective;
  SS taxed on the provisional share), so success 0.742 → 0.824.
  Hand-computed engine-level checks (zero-growth world): wage 60k single
  → tax 5,020; the §7.3 cited retiree SS 24k + RMD 30k → tax 2,776
  (bracket cash 51,224 vs flat 44,928); large-RMD bracket fill (500k RMD
  → 27.7% effective > flat 18%); MFJ deduction/thresholds (60k → 2,840);
  gross-up 10%→12% edge crossing with exact December settle-up; per-year
  engine-vs-`compute_tax_year` agreement under 2.5% inflation incl. the
  §86(c) nominal-threshold creep (taxable SS 0 in year 1, > 0 by horizon).

  **Performance:** bracket mode 1,000 paths ≈ 0.31s (flat ≈ 0.18s) on the
  dev box — >4x inside the 1.5s budget; perf test asserts the budget after
  a warm-up run.

  **Phase-2 decisions where TAX-DESIGN was silent (flagged, not silent):**
  (a) December settlement ordering: settled AFTER the month's shortfall
  step so the year's withdrawal income is included and the annual tax is
  exact; a residual tax bill can leave December cash negative and is
  covered by January's withdrawal, whose deemed income lands in the NEW
  tax year (in the final plan year it simply reduces final net worth —
  no January exists). (b) The year-start withholding projection prices
  the whole year's SS and the RMD estimate (current td balance / divisor;
  amounts are path-dependent, "known schedule" refers to timing) at the
  year-start price index. (c) "Income-so-far" for the marginal estimate =
  non-SS income to date + Pub-915 taxable share of SS to date − the
  indexed standard deduction, floored at 0, indexed at the current month's
  price level. (d) The same projected withholding rate applies to income,
  SS, and RMD credits (per §3's "same estimated withholding rate").
  (e) Settlement grid assumes horizon_months % 12 == 0 (already the
  PlanInputs contract). Out of scope confirmed untouched: withdrawal
  ordering, LTCG, state tax, Roth buckets.
