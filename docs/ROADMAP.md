# Roadmap

Rule (per 2026-07-11 PM review, finding 7): this file is the versioned plan —
the 60-second read. BOARD.md holds only owned/actionable work. This file is
updated in the same commit that opens a version's tasks.

## Shipped

- **v1.0.0** — foundations: auth (LAN/password/TLS), accounts/flows/goals
  CRUD, Monte Carlo engine + scenario studio + fan charts, CSV/OFX import,
  QA and security hardening (docs/SECURITY-REVIEW-v1.md).
- **v1.1.0** — household members (roles, per-member ownership), spending
  profile + observed spending, retirement timing (SS claim-age actuarial
  factors, RMDs per SECURE 2.0), engine-emitted milestones on the fan chart.
- **v1.2.0** — real spending: credit-card transfer pairing with tombstones,
  layered categorization (AI stubbed) + AI budget admin, import freshness,
  spending hub (summary/radar/hotspots/forecast), review queues; engine v2
  model-honesty (85% SS cap, assumptions block); standalone bracket tax
  module. See docs/releases/v1.2.0.md.

- **v1.2.1** — durability (pre-migration backups, daily snapshots, export),
  model-honesty UI (assumptions strip, ~5% probabilities, what-moved notes),
  Ludovitae identity (MIT, GitHub org, CI, PyPI trusted publishing). See
  docs/releases/v1.2.1.md.
- **v1.2.2** — field-tested against real money: import creates/matches
  accounts with four built-in institution presets, cross-institution transfer
  pairing proven on real data, start-from-scratch, per-account pages, forecast
  explainability, container image + wheel-bundled UI, v1.2 security pass. See
  docs/releases/v1.2.2.md.

## In flight

- **v1.3.0 milestone** — income inference & equity grants; plan snapshots
  (#21), healthcare/LTC modeling (#22). **Maiordomus v0** (butler pilot)
  scheduled after v1.3. Package rename `gol`→`ludovitae` awaits the owner's
  issue. Board: github.com/ludovitae/ludovitae/issues.

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
- **Roth conversion timing** (owner ask 2026-07-11: "optimize my backdoor
  roth contributions when i get into a lower tax bracket … a slider 'when to
  start backdooring'"): scenario slider = start age for annual
  traditional→Roth conversions (+ annual conversion amount or
  fill-to-bracket-top), with the conversion taxed at the bracket-aware rate
  in that year and Roth growing tax-free thereafter. **Hard dependencies**:
  (a) bracket-aware tax (T-012) — conversion optimization is meaningless on
  a flat rate; (b) engine gains a per-member **Roth bucket** — accounts need
  a tax treatment split (tax_deferred | roth | taxable | hsa) beyond
  today's single tax-deferred bucket; RMDs then apply only to the
  tax-deferred side. Advisory framing per the product principle: the slider
  is the owner's decision; the app may show "converting X/yr starting at
  age Y keeps you in the Z% bracket" comparisons, never a recommendation.
  Terminology note: while working at high income this is the literal
  backdoor-Roth (nondeductible contribution + conversion); in low-bracket
  years it's a conversion ladder — the slider models the latter; the former
  is a contribution-flow detail we can add cheaply.
- Sell-side optimization (advisory-only per DECISIONS product principle);
  requires tax lots.
- Live account sync (SimpleFIN/Plaid) via SyncAdapter.
- Claude-backed categorization (budget machinery ships in v1.2).
- Historical-bootstrap returns; correlated asset classes.
- Forgejo migration: PR workflow, CI, releases.

## Frozen / declared done

- Game theme: ships as the credible token skin; full illustration pass is
  cancelled unless the owner asks (PM review finding 6).
