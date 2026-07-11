# Bracket-aware tax: design & integration plan (T-012)

Status: phase 1 shipped (standalone `gol/tax/` module + this plan). Phase 2
(engine integration) is a follow-up task that starts **after T-011a merges**,
per the coordinator's sequencing. Nothing in this document changes engine
behavior today.

Motivation: PM review 2026-07-11, finding 3 — the v1.1 timing features (SS
claim-age sliders, RMD milestones) invite the owner to optimize decisions
whose dollar impact is precisely the thing a flat `effective_tax_rate_pct`
cannot see (provisional-income SS taxation, bracket fill from forced
distributions), and the engine currently taxes 100% of SS when at most 85% is
taxable by law.

## 1. Module surface (phase 1, shipped)

`server/src/gol/tax/` — pure functions, no ORM or `gol.sim` imports. Every
amount parameter takes `float | np.ndarray` (broadcast together) and the
result matches shape — plain floats for all-scalar inputs. Filing status is a
scalar string, `"single" | "mfj"`.

- `federal.py` — `TaxBrackets` (validated thresholds/rates data),
  `ORDINARY_BRACKETS` / `LTCG_BRACKETS` / `STANDARD_DEDUCTION` (2026 data),
  `bracket_tax`, `marginal_rate`, `ordinary_tax`, `ordinary_marginal_rate`,
  `standard_deduction` — all accepting an `index` inflation factor that
  scales thresholds/deduction.
- `social_security.py` — `SS_TAXABILITY_THRESHOLDS`, `provisional_income`,
  `taxable_social_security` (IRS Pub 915 worksheet, no-exclusions case).
- `plan.py` — `TaxYearInput` → `compute_tax_year` → `TaxYearResult`
  (taxable_ss, agi, taxable_income, tax, effective_rate, marginal_rate): one
  household tax year, composable per plan year and vectorized over Monte
  Carlo paths.

## 2. Tax-year parameters (2026) and their citations

Rates and thresholds ship as **data**; a new tax year is a data edit, not a
code change.

- Ordinary brackets, standard deduction, LTCG breakpoints: tax year 2026
  under post-OBBBA (TCJA-extension) law, IRS Rev. Proc. 2025-32
  (<https://www.irs.gov/pub/irs-drop/rp-25-32.pdf>; announcement:
  <https://www.irs.gov/newsroom/irs-releases-tax-inflation-adjustments-for-tax-year-2026-including-amendments-from-the-one-big-beautiful-bill>).
  Cross-checked 2026-07-11 against Tax Foundation, "2026 Tax Brackets"
  (<https://taxfoundation.org/data/all/federal/2026-tax-brackets/>); the two
  sources agree on every figure we ship. Confidence is high; these are the
  final published 2026 figures, not projections.
- SS taxability thresholds: IRC §86(c) — 25,000/34,000 single, 32,000/44,000
  MFJ, **fixed in nominal dollars by statute** (set 1983 for the 50% tier,
  1993 for the 85% tier; never inflation-adjusted). Sources: IRS Pub 915
  (<https://www.irs.gov/publications/p915>), SSA
  (<https://www.ssa.gov/benefits/retirement/planner/taxes.html>). The module
  deliberately does **not** index them — the resulting "more of SS becomes
  taxable every year" creep is real law and exactly the effect finding 3
  wants modeled. A test pins the values against accidental indexing.

### Indexation semantics

Real law indexes brackets annually by chained CPI with rounding rules. The
module instead scales thresholds by a continuous factor (`index` /
`price_index`), which the engine will supply from its per-path cumulative
price index. This keeps taxes *real-terms-stable* under the sim's own
inflation model and is consistent per path. Divergence from the statutory
rounding is < 0.1% of tax and irrelevant at the sim's resolution. Because
the sim's AR(1) inflation is CPI-U-like rather than chained-CPI, brackets in
the sim index slightly *faster* than real law (chained CPI runs ~0.25pp/yr
lower) — a small pro-taxpayer bias, documented here, acceptable at phase-1/2
resolution.

## 3. Engine call-site map (phase 2)

The engine settles taxes **annually on the plan-year grid** (December of
each plan year, `t % 12 == 11`), replacing the three per-month flat-rate
touches. Per-path year accumulators (numpy `(n_paths,)` vectors) collect:
gross income-flow dollars, gross SS received (nominal), and tax-deferred
distributions (RMDs + the deemed tax-deferred share of shortfall
withdrawals). In December the engine calls `compute_tax_year(...,
price_index=price[:, t])` once — fully vectorized over paths — and settles
the year's liability against cash, net of the estimated tax already
withheld monthly (below). Plan years are aligned to the sim grid, not the
calendar year; the ≤11-month phase offset is noise at this resolution.

| # | Call site (engine.py @ 18e827a) | Today | Replacement |
|---|---|---|---|
| 1 | line 213: `cash += (income_fixed[t] + ss_base[t]*p) * (1 - tax)` | flat rate on 100% of income **and 100% of SS** | credit income/SS **gross**, less monthly estimated withholding (below); accumulate into the year's `ordinary_income` / `ss_benefits`; December settle-up computes true tax with only the Pub-915 taxable share of SS |
| 2 | lines 174/239: `wtax = tax * retirement_share`; `gross = shortfall / (1 - wtax)` | flat gross-up, rate independent of withdrawal size | gross up at the household's **current-year marginal rate**: `g = S / (1 - r·m̂)`; accumulate `r·g` into `tax_deferred_withdrawals`; December true-up corrects the estimate (see §4) |
| 3 | line 235: `cash += dist * (1 - tax)` (RMDs) | flat rate at distribution time | credit the distribution gross (less the same estimated withholding rate), accumulate into `tax_deferred_withdrawals`; taxed correctly at settle-up — this is what makes "RMDs fill brackets" visible |

`r = retirement_share` keeps its v1 meaning: the fixed fraction of the
invested bucket held in retirement accounts, used as the deemed
ordinary-income share of a shortfall withdrawal. The taxable-side share of a
withdrawal is treated as return of basis (no LTCG) in phase 2 — a known
understatement; `LTCG_BRACKETS` ship now so phase 3 can add gain-fraction
tracking as a data-plus-plumbing change.

**Monthly withholding.** To avoid a distorting December cash cliff (a big
tax bill would itself trigger shortfall withdrawals), each month credits
income at `(1 - w)` where `w` is the year's *projected* effective rate,
computed once at each plan-year start from the deterministic flow arrays and
known SS/RMD schedules via `compute_tax_year` (withdrawals unknown → assumed
0 for the projection). December settles `true_tax - withheld`. Residual
December swings are second-order (only the path-dependent withdrawal tax).

## 4. The hard problem: bracket-aware withdrawal gross-up

The gross-up rate now depends on the withdrawal itself: withdrawing `g`
pushes `r·g` of ordinary income into the year, possibly across bracket
edges, which changes the tax on the withdrawal, which changes the required
`g`. Two facts make this tractable:

1. **The exact inverse exists in closed form.** With `Y` = the year's other
   taxable ordinary income, tax function `T` piecewise linear, the net cash
   from a gross withdrawal is `N(g) = g - [T(Y + r·g) - T(Y)]` — piecewise
   linear, strictly increasing (slope `1 - r·rate ≥ 1 - 0.37 > 0`). So
   `g = N⁻¹(S)` can be computed exactly by walking the (≤7) bracket
   segments — vectorizable over paths as one `(n_paths × 7)` clip/select.
   No iteration is ever *required*.
2. **The cheap estimate is boundedly wrong and self-correcting.** Phase 2
   uses `g = S / (1 - r·m̂)` with `m̂` = marginal rate at the household's
   income-so-far (one `ordinary_marginal_rate` call). The estimate errs only
   when the slice `[Y, Y + r·g]` crosses a bracket edge. Error bound: the
   net delivered differs from `S` by at most `r · g · Δm / (1 - r·m')`
   where `Δm` is the largest rate step the slice crosses (max adjacent step
   in the 2026 schedule: 10pp at 12→22%) and `m'` the highest rate touched
   — i.e. **≤ ~11% of the ordinary-income share of the single withdrawal
   that straddles an edge**, and zero for every withdrawal that doesn't.
   The December settle-up then charges/refunds the exact difference, so the
   *annual* tax is always exact; the residual error is only intra-year cash
   timing — a few months of returns on the mis-estimated slice, bounded by
   `0.10 · r · g · (monthly return ≈ 0.6%) · (months to December)` ≈ well
   under 1% of one month's withdrawal. Undetectable next to the Monte Carlo
   band width.

**Proposal:** ship phase 2 with estimate + annual exact settle-up (simpler
inner loop, exact annual totals). Keep the closed-form inversion in the back
pocket; adopt it only if validation shows the December true-up visibly
distorting shortfall dynamics on thin-cash paths.

## 5. Filing status derivation (propose only — not implemented)

Derive from the household: **MFJ if ≥ 2 members with `role in ADULT_ROLES`
(`self`, `partner`, `other`), else single.** Assembly computes it; the engine
and `gol/tax` just receive the scalar string.

Open question for the coordinator: `other` adults (e.g. a resident parent)
are not spouses; `partner` presence is the truer MFJ test, and a 2-adult
`self`+`other` household would file single + a dependent in reality. Given
the app models one filer per household, the ≥2-adults rule is proposed as
the default for simplicity, with `self`+`partner` → MFJ, else single, as the
recommended refinement if QA's golden households make the difference matter.
Head-of-household is out of scope (statuses ship as data; adding it later is
a table row + threshold pair).

## 6. The `effective_tax_rate_pct` knob → optional override

Proposal: the profile knob becomes **nullable**.

- `effective_tax_rate_pct = null` → bracket-aware model (new default for
  *new* profiles).
- `effective_tax_rate_pct = <value>` → the current flat-rate engine path,
  preserved verbatim (same code, same numbers).

Migration keeps the stored value for existing profiles, so migrated plans
simulate **bit-for-bit identically** (the T-005 sim-identity standard) until
the owner clears the override in the UI ("Advanced: flat tax override").
The simulation's assumptions output (T-011a's assumptions block) should name
which model ran, e.g. `tax_model: "brackets" | "flat"` — coordination note:
that's an API-contract addition and therefore a coordinator decision, not
something phase 2 does unilaterally. Whether the app should *prompt*
existing profiles to switch (numbers will move; finding 4's
"why-numbers-moved" discipline applies) is an owner decision.

## 7. Validation plan

Golden-household tests, each cross-checked against a published source before
phase 2 merges:

1. **Bracket math**: single/MFJ wage-only cases against the Tax Foundation
   2026 tables (<https://taxfoundation.org/data/all/federal/2026-tax-brackets/>)
   — shipped in phase-1 tests (hand-worked in comments).
2. **SS taxability**: tiered cases against the IRS Pub 915 worksheet
   (<https://www.irs.gov/publications/p915>) — shipped in phase-1 tests.
3. **Composed year**: the phase-1 cited retiree examples (single: SS 24k +
   withdrawals 30k → tax 2,776; MFJ: SS 40k + withdrawals 60k → tax 6,920)
   re-entered into a published 2026 calculator — Bipartisan Policy Center's
  2026 federal income tax calculator
  (<https://bipartisanpolicy.org/explainer/2026-federal-income-tax-brackets-and-interactive-calculator/>)
  — expecting agreement to the dollar (both are the same piecewise-linear
  schedule; any disagreement means a data-entry error on one side).
4. **Engine-level (phase 2)**: a golden household with RMDs + SS where the
   flat model and bracket model must diverge in the *documented* direction
   (flat taxes 100% of SS → bracket model shows lower tax at modest incomes,
   higher marginal spikes when RMDs fill brackets); plus a
   flat-override regression run proving bit-for-bit v1.1 sim identity.

## 8. Non-goals and known approximations (phase 1→2)

Out of scope (per task): engine integration (phase 2), withdrawal-ordering
optimization, state tax, AMT/NIIT. Additional known simplifications, all
deliberate and all data-shaped so they can be added incrementally:

- No age-65+ additional standard deduction, and no OBBBA temporary senior
  deduction ($6,000/person 65+, 2025–2028) — overstates tax modestly for
  retiree households; candidate phase-3 data (the module would need member
  ages, an input-shape change).
- No LTCG computation (data shipped; needs basis/gain tracking — phase 3)
  and no NIIT — understates tax for large taxable-account withdrawals.
- No credits, no itemizing, no IRMAA.
- Tax year == plan year (≤11-month phase offset vs calendar).
- Single filer per household; no MFS, no survivor-status transition when a
  spouse's life expectancy ends mid-plan (the widow(er) bracket cliff is a
  real effect the sim could model later — noted for the roadmap).
