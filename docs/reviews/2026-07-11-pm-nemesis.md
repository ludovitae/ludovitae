# Adversarial product review — Game of Life

Reviewer: outside PM nemesis (skeptical review agent, owner-requested) ·
Date: 2026-07-11 · Scope: product thinking, not code style. Read-only.

## Verdict

This is one of the best-run agent-team codebases I've reviewed — and it is
currently a simulator of a demo household, not of Brian's life. The team has
built ~28 hours of dense, well-tested, well-decided software on top of exactly
zero real data, and the roadmap keeps adding analytical altitude (v1.2
analytics, v1.3 inference, vFuture optimization) while the ground floor —
entering an income, importing a real bank CSV, backing up the file that will
hold his financial life — is unbuilt, untested, or explicitly on hold. The
single most damning fact: after v1.1, Brian cannot produce a baseline
simulation of his own life through the UI, because income flows have no entry
form and the feature that would infer them is two versions away.

## What's genuinely good

- **The coordination machinery is not theater — it caught real product bugs.**
  The child-life-expectancy horizon absurdity (self simulated to age 127) was
  caught *independently* by backend (T-005 log) and frontend (T-006 log),
  ruled by the coordinator, and pinned with regression tests. That's the
  flag-don't-drift protocol paying for itself.
- **Migration sim-identity testing** (T-005: v1 DB upgraded in place must
  reproduce v1 output bit-for-bit against a recorded golden) is a genuinely
  excellent standard most professional teams don't hold.
- **The decision log is real**: owner decisions are attributed, dated, and
  carry consequences. The credit-card scoping call — swipe = spend, auto-pair
  transfers, no statement-cycle modeling — is exactly the right amount of model.
- QA and security found and fixed real defects (D-001 500-on-plausible-input;
  S1 High fail-open import crash), not checklist filler.

## Findings

**1. The sim's most important input has no front door.**
The baseline scenario is "auto-derived from real data" (ARCHITECTURE.md), and
its dominant input is income flows. There is no UI to create one. The
transactions-first ADR reasons "flows are slow-moving assumptions (set
rarely)" — but *rarely* is not *never*, and it must happen at least once, at
cold start, before any inference exists. Evidence: BOARD "Flow CRUD — ON
HOLD"; T-006 log; `useCreateFlow` in `web/src/api/queries.ts` has zero call
sites; income inference is a v1.3 *candidate*. Today Brian's first real
session ends with a fan chart of a household with no salary — everything
drains to ruin, trust broken in minute ten, unless he opens curl.
*Recommendation:* Un-hold a minimal flow form (name, amount, owner, kind,
ends_at_retirement — one day of work given the API exists). This does not
contradict transactions-first; it enables it. Income inference in v1.3 then
becomes "flag drift against what Brian entered," which is its stated design
anyway.

**2. Cold start has never been rehearsed, and it's the trust-critical path.**
"Seeded demo works" and "Brian's 9 real accounts produce trustworthy numbers"
are separated by: manual creation of 9 accounts, per-institution CSV column
mapping, per-institution sign conventions (many card CSVs emit charges as
positive; some banks split debit/credit into two columns), date-format
variance, and OFX dialects. The importers were hardened against *malicious*
files but never validated against Brian's *actual* institutions. And no one
has ever seen the app in a real browser — flagged in T-002, again as T-006
residual risk, still in the backlog. Compounding: v1.2's entire analytics
premise is "spending counts at the card swipe" — if one card importer inverts
signs, transfer pairing and every spending detector produce confident garbage.
*Recommendation:* Run a "first mile" session: Brian supplies one real export
per institution; build mapping presets and sign-convention detection against
them; do the real-browser pass the same day. Cheapest highest-leverage task
on the board.

**3. The timing features write checks the tax model can't cash.**
v1.1 ships SS claim-age sliders with live actuarial-factor readouts and RMD
milestones computed from IRS Pub 590-B divisors to the correct year —
precision theater layered on a single flat `effective_tax_rate_pct` knob.
Claim-age and RMD decisions are *tax-interaction* decisions (provisional-
income SS taxation, bracket fill from forced distributions); a flat rate is
structurally blind to the very effects those features invite the owner to
optimize. Worse, the engine taxes 100% of SS at the household rate
(`engine.py:213`), when at most 85% is taxable in reality — a systematic
understatement of retirement income that grows with exactly the levers the
sliders move.
*Recommendation:* Either (a) pull bracket-aware tax forward from v2 before
any more timing/equity precision lands, or (b) visibly demote the timing
controls to "when do milestones happen," with an explicit in-UI note that the
*dollar* impact of claim-age choices is approximate. Do not ship the RSU
withholding-gap feature on a flat rate; it will emit specific-looking dollar
gaps that are wrong.

**4. The fan chart is honest about market risk and silent about model risk.**
Percentile bands encode only return/inflation volatility around assumptions
(stocks 7%/15%, coarse tax, fixed retirement_share) that dominate 30-year
outcomes. Success probability displayed at three digits implies a resolution
the model doesn't have — and those numbers *changed between versions* with
engine_version pinned at "1" and no owner-facing explanation (the
why-numbers-moved discipline lives in commit messages Brian will never read).
No assumptions panel, disclaimer, or model-risk cue exists anywhere in the UI.
*Recommendation:* An assumptions strip on the chart (returns, tax knob,
engine version), success probability rounded to the nearest 5%, and a
one-line "what moved" note surfaced in-app when engine behavior changes.
Decision-support-never-decision-making requires showing the assumptions, not
just the bands.

**5. There is no backup, export, or restore story for the file that will hold
his entire financial life.**
One SQLite file, one host, chmod 0600, destructive Alembic migrations run
against the only copy (the v1.1 migration *drops* profile columns), years of
transactions and — critically — manual categorization labor (the layer that
"wins" in the v1.2 hierarchy) with no snapshot, no export endpoint, no
documented restore, no exit story. Security review covered file *permissions*
(S7) and never asked about file *survival*. grep for backup/export/restore
across all docs returns only the S9 formula-injection deferral.
*Recommendation:* Before real data enters: automatic pre-migration backup
copy, a scheduled local snapshot (`sqlite3 .backup` on a timer), and a
full-fidelity export endpoint. This is also the exit story a decision-support
tool owes its user — and a prerequisite for finding 2, not a follow-up.

**6. Effort is drifting toward a product for an audience that doesn't exist.**
For a user of one: a second full theme with a queued "full illustration pass"
(Brian will pick one theme in week one and never toggle it); an AI budget
ledger, masked-key admin panel, and hard-stop 403 machinery built *before any
AI call exists*; a mock API whose `/simulate` is a *second Monte Carlo
engine* that must now track the real engine forever; and vFuture sell-side
optimization scoped in detail while zero real transactions have ever been
imported. Mock-first served parallel dev in the two-day sprint, but it's a
standing drift liability — three of T-006's contract flags were exactly
mock-vs-backend agreement problems.
*Recommendation:* Freeze the game theme ("credible skin" is done — declare
victory). The AI admin panel in T-008 scope is reasonable *once*, but resist
further stub-side investment until a key exists. Consider having the mock sim
call the real engine's golden fixtures instead of reimplementing dynamics.

**7. Process is mostly earning its keep — but the planning surfaces are
fragmenting.**
The task logs, contract flags, and ADRs are demonstrably valuable. But
ROADMAP.md still says "M1 Foundations ← we are here" while v1.1 has shipped,
and lists spending analytics under v2 while it ships as v1.2; meanwhile
detailed v1.3/vFuture design sketches live in the BOARD *backlog*. The board
is becoming a shadow roadmap. For a solo-owner project, a stale roadmap is
how the plot gets lost — the roadmap is the only artifact Brian can read in
60 seconds.
*Recommendation:* One rule: BOARD holds owned/actionable work only; anything
versioned lives in ROADMAP; ROADMAP gets updated in the same commit that
opens a version's tasks.

## Risk register (top 5, ranked by likelihood × abandonment-impact)

1. **Cold-start trust failure.** First real session yields a ruin-chart (no
   income UI) or sign-inverted analytics (unrehearsed CSV formats). A
   financial tool gets one chance at "these numbers look right." (Findings 1–2)
2. **Data loss after adoption.** No backup + destructive in-place migrations +
   one file. The failure mode isn't day one — it's month four, after the
   categorization labor is irreplaceable. (Finding 5)
3. **Credibility collapse of the numbers.** Brian cross-checks one figure
   (SS impact, RMD tax, RSU gap) against reality, finds it materially off,
   and silently stops believing all of it. Flat tax + 100%-taxable SS makes
   this likely the first time he looks closely. (Findings 3–4)
4. **No habitual loop.** Retirement what-ifs are a quarterly question; the
   weekly loop is v1.2's transaction analytics — which only works if risks
   1–2 are retired first. Staleness warnings are in-app only, meaning a
   lapsed app cannot re-engage him; two missed months and it's abandoned by
   default.
5. **Bespoke-surface maintenance drag.** Hand-rolled SVG charts, hand-rolled
   OFX parser, dual themes, a shadow mock engine — each fine alone, together
   a growing tax on every future change, paid by a team whose feature
   velocity already outruns the owner's data entry.

## If I ran this roadmap

1. **v1.2a — "First real baseline" (1–2 days):** minimal flow-entry form +
   Brian's real CSVs against the importers (mapping presets, sign detection)
   + the long-owed real-browser QA pass, ending with Brian's actual baseline
   fan chart on screen. *Everything else on this roadmap is hypothetical
   until his real numbers render.*
2. **v1.2b — Durability (1 day):** pre-migration auto-backup, scheduled
   snapshot, full-fidelity export. *The moment step 1 succeeds, data loss
   becomes the number-one catastrophic risk, and it's a day's work to retire.*
3. **v1.2 — Spending analytics as scoped (T-007/T-008), unchanged.** *It's
   the right retention play and the credit-card model is well-designed — it
   just needs to land on real, correctly-signed transactions instead of the
   seed.* Defer alongside: game-theme illustration (indefinitely), further
   AI-stub investment (until a key exists), and gate v1.3 RSU work on a
   bracket-aware tax decision (finding 3).
