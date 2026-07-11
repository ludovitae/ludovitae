# T-011 — Model honesty pass

Owner: backend-dev agent (011a) + frontend agent (011b) · Status: 011a REVIEW,
011b HOLD until T-008 merges · Branch: `ws/honesty-be` / `ws/honesty-fe`

## Scope (PM review findings 3–4, owner-accepted)

**011a (backend, can start now — touches gol/sim only):**
1. Cap taxable Social Security at 85%: SS income taxed as
   `ss × (1 − 0.85 × tax_rate)` instead of `ss × (1 − tax_rate)`. Golden
   numbers will move — document movement in the commit message and re-pin.
   Provisional-income phase-in is explicitly OUT of scope (that's the
   bracket workstream); 85% is the honest ceiling, not a precise model.
2. `/simulate` response gains an `assumptions` block: market means/vols per
   class, inflation assumption, effective_tax_rate_pct, ss_taxable_share,
   engine_version — everything the UI needs for an assumptions strip.
3. Bump `engine_version` to "2" and add `engine_notes`: a short list of
   human-readable strings describing behavior changes since the prior
   version (e.g. "Taxable Social Security capped at 85%"). Contract addition
   — coordinator has pre-approved this shape; document it in docs/API.md via
   task log for the coordinator to codify.

**011b (frontend, after T-008 merges):**
1. Assumptions strip under the fan chart (collapsible, from the
   `assumptions` block — never hardcoded).
2. Success probability displayed to the nearest 5% everywhere (tooltip may
   show 1%); ending-net-worth stats keep full precision.
3. "What moved" note: when a cached scenario's engine_version differs from
   the current response, surface `engine_notes` inline once.

## Log

- 2026-07-11 (coordinator): created per owner-accepted PM review findings.
- 2026-07-11 (backend-dev): 011a complete on `ws/honesty-be` → **review**.
  Commits d5fe6a9 (SS cap + golden re-pins) and b84e341 (assumptions block,
  engine_version 2, engine_notes). 165 server tests green (162 + 3 new),
  ruff clean.
  - SS cap: `engine.py` now credits `ss * (1 - 0.85 * tax)` (constant
    `gol.sim.SS_TAXABLE_SHARE = 0.85`); ordinary income unchanged; still
    vectorized. Provisional-income phase-in left to the bracket workstream
    per scope.
  - Golden movements (seed 1234, 1000 paths; year-0 unchanged, SS starts
    at 67): success 0.737→0.742, ruin age 86.4→86.5, final det NW
    4,237,007.25→4,335,800.73, ending p10/p50/p90 -1,827,966.02/
    2,517,061.28/11,481,607.38 → -1,738,542.06/2,575,871.74/11,567,603.35.
    No-TD pin (ex v1-parity, renamed `test_no_tax_deferral_golden`):
    success 0.739→0.744, ruin 86.3→86.5, final det NW 4,499,929.33→
    4,603,767.29. Full before/after table in the d5fe6a9 commit message.
  - Migration identity golden re-recorded: the recorded v1 output is
    compared through the CURRENT engine, and the fixture household claims
    $2,400/mo SS at 18% tax, so v1 numbers are unreproducible by design
    since the cap. Regenerated via the identical migrated-DB →
    build_plan_inputs → run_simulation path the test exercises (same
    date/seed/paths; success 0.5575→0.565, ending p50 158,390.01→
    209,137.17). The test still pins 0001→head migration data-identity
    bit-for-bit — now against engine v2. Rationale documented in
    `tests/v1_fixture.py`.
  - **Contract addition for the coordinator to codify in docs/API.md**
    (Simulation section; applies to `POST /simulate` and to each entry of
    `POST /scenarios/compare` `results[]`; `engine_version` example value
    changes "1" → "2"):

    ```json
    {
      "engine_version": "2",
      "engine_notes": ["Taxable Social Security capped at 85% (was 100%)"],
      "assumptions": {
        "market": {
          "stocks_mean_pct": 7.0, "stocks_vol_pct": 15.0,
          "bonds_mean_pct": 3.5, "bonds_vol_pct": 7.0,
          "cash_mean_pct": 1.5, "cash_vol_pct": 0.5
        },
        "inflation_pct": 2.5,
        "effective_tax_rate_pct": 18.0,
        "ss_taxable_share": 0.85,
        "engine_version": "2"
      },
      ...existing fields unchanged...
    }
    ```

    `engine_notes` is a list of human-readable behavior changes since the
    prior engine version. `assumptions` reflects the resolved PlanInputs
    the run actually used (scenario `return_override_pct` /
    `inflation_override_pct` included — means overridden, vols kept),
    never re-read from the DB; `assumptions.engine_version` always equals
    the top-level `engine_version`. Cached simulation rows are keyed by
    engine version, so v1-era cache entries can never be served as v2.
