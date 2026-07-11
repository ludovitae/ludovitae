# T-012 — Bracket-aware tax workstream (parallel, long-running)

Owner: backend-dev agent · Branch: `ws/tax-brackets` · Status: todo (fires
with the post-review wave; standalone module, integrates AFTER T-011a lands)

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
