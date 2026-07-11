# T-006 — Household, spending & milestone UI (frontend)

Owner: frontend-dev agent · Branch: `ws/household-fe` · Status: review

## Scope

Implement the v1.1 UI against the updated docs/API.md (v1.1 sections), to the
docs/DESIGN.md polish bar. Backend (T-005) builds in parallel — extend the
mock layer to the new contract first and develop against `VITE_MOCK=1`.

1. **Household page**: member cards (name, role, age computed from birth
   year, retirement age, SS at FRA + claim age), add/edit/delete with the
   exactly-one-self rule reflected in the UI, empty states. Account/flow
   forms gain an owner picker.
2. **Spending page**: category list (essential vs discretionary grouping,
   inline amount edit), monthly savings target, and an **observed spending**
   panel from `/spending/observed` — planned vs observed bars per category
   with a one-click "use observed" per row; window selector (3/6/12/24 mo);
   combined planned+flows total with a visible double-count warning when
   expense-kind flows exist.
3. **Milestones on the net-worth fan chart** (the owner's headline ask —
   make them prominent): vertical markers with labeled chips (member +
   event; icons per kind: retirement / SS / RMD), hover/probe integration,
   sensible collision handling when milestones cluster, present in both
   single-scenario and compare modes (compare: milestones of the active
   scenario, dimmed variants for pinned ones if legible — your call, log it).
4. **Scenario studio**: per-member timing controls — retirement-age slider
   and SS-claim-age slider (62–70, live benefit-factor readout) per eligible
   member via `params.member_overrides`; spending_delta_pct slider. Keep the
   debounced-re-sim + tween behavior; milestones move smoothly with slider
   drags.
5. Mock API: household of 3, spending categories, observed data, milestone
   generation in mock /simulate consistent with overrides.
6. Update typed client + types for every v1.1 contract change (Profile slim,
   Account/Flow member_id, ScenarioParams, SimResult.milestones).
7. Tests: milestone positioning transform, member-override serialization,
   observed-vs-planned merge logic, jsdom walk of the two new pages, and a
   scenario-studio interaction test moving a claim-age slider → re-sim →
   milestone label updates. All interactions through real controls (click the
   actual buttons — see the type=submit lesson in git history).

## Acceptance criteria

- build/lint/vitest green; `VITE_MOCK=1 npm run dev` demos household,
  spending, and milestone-annotated charts end to end.
- Both themes/modes render the new screens; no hard-coded colors; reduced
  motion respected by milestone animations.

## Log

- 2026-07-10 (coordinator): task created. Contract is binding; flag concerns
  here rather than diverging.
- 2026-07-11 (frontend-dev): complete on `ws/household-fe` (7 commits), status
  → review. build/lint/`vitest run` green — 97 tests (was 62). Decisions:
  - **Nav order** (my call, as delegated): Dashboard, Household, Accounts,
    Spending, Scenarios, Goals, Import, Settings — inputs ordered as "who's in
    the plan → what they own → what life costs", then the what-ifs. New
    two-person and wallet icons in the house stroke style.
  - **Milestone markers**: engine milestones only (never derived in UI, per
    ADR). Hairline + chip (kind icon + member first name), row-staggered via a
    pure `layoutMarkers` transform (unit-tested), right-edge flip, positions
    tweened per `member:kind` identity (reduced motion snaps), full label on
    probe tooltip + SVG `<title>` hover + `aria-label`. Colors are new
    `:root` tokens `--ms-retirement #d55181 / --ms-ss #149bb4 / --ms-rmd
    #c98500` — identical across themes/modes, validated with the dataviz
    six-checks script against BOTH chart surfaces alongside the series blues
    (worst adjacent CVD ΔE 16.4; the initial chart-5 purple failed protan
    ΔE 2.5 vs series blue and was rejected).
  - **Compare mode**: markers for ONE scenario — the active one if pinned,
    else the first pinned — named in the card hint. Dimmed variants for every
    pinned set were rejected: with up to 6 pinned scenarios the chip rows turn
    to noise.
  - **Self retirement sugar**: studio writes `member_overrides`; scenarios
    that already carry top-level `retirement_age` (v1 sugar) are edited in
    place for shape stability; an explicit override always supersedes the
    sugar (mock sim + UI agree; tested). QA's T-003 debounce test updated to
    the v1.1 shape (label `Retirement age — Brian`, asserts the override).
  - **Flow owner picker**: v1 shipped no flow-editing UI, so the owner picker
    lives as an inline Select per row in a new "Recurring flows" table on the
    Spending page (plus the account add-form). Flow CRUD forms remain future
    work unless the coordinator wants them in v1.1.
  - **Fix (mock)**: handlers returned live references into the mock db; React
    Query cached those objects, so in-place PUT mutations aliased the cache
    and suppressed re-renders. Every mock response is now `structuredClone`d.
  - **Contract flags (no drift — mock behavior noted for T-005 alignment):**
    1. *Horizon*: "runs to the latest life expectancy in the household" read
       literally includes children — the demo 14-year-old (LE 95) would push
       the self-age axis to ~127. Mock excludes `child`-role members from the
       horizon; please clarify the contract wording.
    2. *PUT /spending*: replace semantics for NEW categories aren't specified
       — client sends them without `id` (typed `SpendingCategoryInput.id?`);
       mock assigns ids to entries missing one. Backend should match.
    3. *GET /dashboard `monthly_surplus`*: v1.1 doesn't say whether spending
       categories count as outgo; mock includes them (otherwise the surplus
       is misleadingly large once categories carry everyday spend).
  - Residual risk: charts verified by unit tests + jsdom walks + dev-server
    boot; no real-browser screenshot pass was possible in this environment —
    suggest a quick visual QA of marker chips in both themes/modes.
