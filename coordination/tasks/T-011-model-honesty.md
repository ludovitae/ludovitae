# T-011 — Model honesty pass

Owner: backend-dev agent (011a) + frontend agent (011b) · Status: 011a ready,
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
