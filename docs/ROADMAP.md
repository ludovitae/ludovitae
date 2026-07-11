# Roadmap

Rule (per 2026-07-11 PM review, finding 7): this file is the versioned plan —
the 60-second read. BOARD.md holds only owned/actionable work. This file is
updated in the same commit that opens a version's tasks.

## Shipped

- **v1** — foundations: auth (LAN/password/TLS), accounts/flows/goals CRUD,
  Monte Carlo engine + scenario studio + fan charts, CSV/OFX import, QA and
  security hardening (docs/SECURITY-REVIEW-v1.md).
- **v1.1** — household members (roles, per-member ownership), spending
  profile + observed spending, retirement timing (SS claim-age actuarial
  factors, RMDs per SECURE 2.0), engine-emitted milestones on the fan chart.

## In flight

- **v1.2** — real spending: credit-card transfer pairing, layered
  categorization (AI stubbed), import freshness, spending analytics
  (summary/recurring/hotspots/forecast), AI budget admin. T-007 (backend, in
  review) / T-008 (frontend, building).

## Next (sequencing under owner review after the 2026-07-11 PM nemesis review)

- **v1.2a — first real baseline**: minimal flow-entry form, mapping presets +
  sign-convention handling proven against the owner's real institution
  exports, real-browser QA pass. Exit criterion: the owner's actual baseline
  fan chart renders and looks right.
- **v1.2b — durability**: pre-migration auto-backup, scheduled SQLite
  snapshots, full-fidelity export endpoint (the exit story).
- **Model honesty (from findings 3–4)**: cap taxable SS at 85%, assumptions
  strip on charts, success probability rounded to 5%, in-app "what moved"
  notes on engine changes. Bracket-aware tax: decision pending (pull forward
  vs demote timing-dollar claims).

## v1.3 candidates (gated on v1.2a/b landing)

- Income inference: observed vs assumed income from transaction inflows;
  salary cadence, bonuses, vest deposits; settings hints as calibration
  anchors only.
- Equity grants: Grant entity (`kind`: rsu first), vest schedules, unvested
  excluded from net worth, sell-to-cover haircut, vests as scheduled cash
  income. **Gated on the bracket-aware-tax decision** (no withholding-gap
  dollar figures on a flat rate).

## v2 / future

- Bracket-aware taxes: brackets, withdrawal ordering, provisional-income SS
  taxation, capital gains; prerequisite for sell-side work.
- Sell-side optimization (advisory-only per DECISIONS product principle);
  requires tax lots.
- Live account sync (SimpleFIN/Plaid) via SyncAdapter.
- Claude-backed categorization (budget machinery ships in v1.2).
- Historical-bootstrap returns; correlated asset classes.
- Forgejo migration: PR workflow, CI, releases.

## Frozen / declared done

- Game theme: ships as the credible token skin; full illustration pass is
  cancelled unless the owner asks (PM review finding 6).
