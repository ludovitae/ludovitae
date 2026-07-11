# T-008 — Spending analytics & admin UI (frontend)

Owner: frontend-dev agent · Branch: `ws/spending-fe` · Status: review

## Scope

v1.2 UI per docs/API.md v1.2 sections, DESIGN.md polish bar, mock-first:

1. **Spending page grows into a Spending hub** (tabs or sections — your
   call, log it): existing plan/observed view, plus **Summary** (category ×
   month heatmap-or-bars, dataviz skill first), **Recurring** (subscription
   radar table: payee, cadence, price, price-change badge, monthly
   equivalent, active/lapsed; "possibly forgotten" callout group),
   **Hotspots** (category spikes vs baseline, top merchants), **Forecast**
   (stacked recurring + variable projection chart).
2. **Review queues**: transfer candidates (pair/dismiss with both legs shown
   side-by-side) and uncategorized transactions (bulk select + categorize,
   create-rule-from-payee shortcut). Badge counts in nav.
3. **Accounts page**: freshness badges (fresh/aging/stale/never/off) with
   days-since-import tooltip, staleness-days override in account form.
   **Dashboard**: stale-accounts warning strip (dismiss = navigates to
   accounts, not suppression).
4. **Settings → AI panel**: API-key field (write-only; shows last4 when set;
   clear button), enable toggle (disabled state explains the stub), monthly
   budget input, this-month spend + token readout, usage-by-month mini table.
   Make the budget affordance feel like a real admin control, not a form.
5. Mock layer: full v1.2 contract — realistic transactions with pairable
   card payments, subscriptions incl. one price hike and one "forgotten"
   12-month-old charge, stale account, AI usage rows (zeroed spend).
6. Types/client for every v1.2 addition. Tests: recurring-table transforms,
   pairing-queue interactions (real clicks), freshness badge states, AI
   panel (key set/clear, budget edit), plus jsdom walks of new sections.

## Acceptance criteria

- build/lint/vitest green; `VITE_MOCK=1 npm run dev` demos the whole hub.
- Both themes/modes; empty states for every new view (no transactions, no
  recurring found, no candidates); reduced-motion respected.

## Log

- 2026-07-11 (coordinator): task created; on hold until v1.1 merges.
- 2026-07-11 (frontend-dev): complete on `ws/spending-fe` (7 commits), status
  → review. `npm run build` / `npm run lint` clean; `npx vitest run` green —
  **128 tests (was 97)**; `VITE_MOCK=1 npm run dev` boots and demos the hub,
  queues, freshness and AI panel. Decisions (as delegated):
  - **Hub structure: tabs, not sections** — Plan / Summary / Recurring /
    Hotspots / Forecast. "Edit the plan" and "read the analytics" are
    different tasks, and stacked sections made a five-screen page. Tab state
    lives in `?tab=` so views are linkable; **Plan stays the default route**,
    so every v1.1 flow (and QA's tests) is untouched.
  - **Review queues live on a new nav page `/review`** (next to Import — it's
    the chore imports create), with a live nav badge = transfer candidates +
    uncategorized count. Page = candidate cards (both legs side-by-side,
    pair/dismiss), uncategorized table (select-all, bulk categorize with
    category datalist, heuristic suggestion chips, per-row "+ Rule" opening a
    pre-filled modal with optional retroactive apply), and a compact rules
    card (priority-ordered list, delete, "Run rules now" with recategorized
    count).
  - **Charts (dataviz skill first, validator run):** Summary is a category ×
    month **heatmap** — magnitude on a grid takes a sequential ONE-hue ramp,
    implemented as a `--chart-1` opacity wash (monotone lightness over both
    mode surfaces by construction); labeled rows + row totals + per-cell
    tooltips and a roving-tabindex grid for keyboard. Forecast is a
    **two-series stack** (Recurring slot-1 + Variable slot-2, validated both
    modes: worst CVD ΔE 69.8; light slot-2 sits at 2.82:1 → WARN, relieved by
    axis ticks + a visible per-series stat line under the chart). Marks per
    spec: ≤24px columns, 2px surface gaps, 4px rounded data-end square at
    baseline, whole-column hover targets, keyboard probe. Hotspot deltas wear
    status tones (spending up = warning) with ▲/▼ + text, never color alone.
  - **Freshness:** badge component covers all five states (unit-tested);
    account rows omit the badge for `off` accounts (a permanent "Off" pill on
    the house/mortgage is noise). The badge is a button → popover editing the
    per-account `staleness_days` (blank = 35 default); the add-account form
    gains a track-freshness toggle + warn-after input, defaulted by type.
    `FRESHNESS_TRACKED_TYPES` lives in `api/types.ts` (form + mock share it).
    Dashboard strip navigates to Accounts — no suppression, per the ruling.
  - **AI panel:** framed as an admin control, not a form — write-only key
    (password field → last4 chip + clear), enable toggle disabled with the
    coming-soon/stub copy, budget input with hard-stop explanation and a
    `role="meter"` spend meter, this-month spend/token stat row, six-month
    usage table honest at zero.
  - **Contract flags (no drift — mock choices needing T-007 alignment):**
    1. **No dismiss endpoint for transfer candidates.** The contract has
       pair/unpair only; UI "Dismiss" is client-side (in-memory) and the
       candidate resurfaces on revisit. Please add one (e.g.
       `POST /transfers/candidates/dismiss {transaction_ids}`) or rule that
       dismissal is intentionally ephemeral.
    2. `/spending/forecast` element shapes are unspecified (`recurring: [...]`).
       Mock/client use: `recurring: number[]` (per month),
       `variable_by_category: [{category, totals: number[]}]`, `total:
       number[]`.
    3. `GET /settings/ai` with no key stored: mock returns
       `api_key_last4: null` (contract only shows the key-present shape).
    4. `GET /ai/usage` `by_purpose` value shape assumed
       `{input_tokens, output_tokens, est_cost_usd}`.
    5. `POST /transactions/categorize` response body unspecified — client
       ignores it (typed `unknown`).
    6. `possibly_forgotten` per contract ("active, low-variance, ≥12 months")
       would include the mortgage; mock adds a ≤$100/mo monthly-equivalent
       cap so fixed bills don't read as "forgotten" — suggest encoding
       something like that in the contract.
    7. `GET /transactions?uncategorized=1` excludes transfer-paired rows in
       the mock (card-payment legs would otherwise flood the queue); unpaired
       near-miss legs DO appear (they are honestly uncategorized until
       paired). Backend should match.
  - Residual risk: same as T-006 — no real browser on this host; charts
    verified by unit tests, jsdom walks and a dev-server boot. Suggest a
    visual QA pass of the heatmap + forecast stack in both themes/modes.
- 2026-07-11 (frontend-dev): **reconciliation pass** per coordinator (merged
  main incl. T-007 219-test backend, T-011a engine v2, T-012; resolved the
  BOARD conflict keeping main's rows). Commit 9556804; build/lint clean,
  **136 tests (was 128)**; dev boot verified. All 8 shape rulings adopted —
  backend wins:
  1. Forecast: `variable_by_category = [{category, monthly_avg}]` (client
     derives constant series); annual charges lump in their anniversary month
     (mock reproduces the lump; unit test asserts exactly one +$139 month).
     Stat line shows the recurring monthly AVERAGE and says where annual
     lumps land.
  2. Hotspots: N FULL months vs the N before (current partial excluded);
     spikes increases-only ≥ +20% over a ≥ $20/mo baseline; copy updated.
  3. Top merchants: top 10, store-number-normalized grouping (mock
     `normalizeMerchant`); test asserts no name ends in a digit.
  4. `amount_variability_pct` added to the type + mock (pstdev/median, 1dp)
     and USED: the radar renders "Subscriptions & bills" / "Spending habits"
     / "Lapsed" sections with subtotals; stat tiles speak about subscriptions
     only. **UI segmentation choice (logged):** subscription-like =
     variability ≤ 5% OR a price step ≥ 5% AND ≥ 2× the variability — without
     the 2× guard a price-hiked Netflix (variability ~6.6%) files under
     habits, and a jittery habit whose last amount sits off-median sneaks
     into subscriptions (both unit-tested). Habit rows never show price
     badges (their "change" is jitter). Mock adds a weekly Green Basket
     habit so segmentation demos.
  5. Dismiss wired to `POST /transfers/candidates/dismiss` (persistent
     tombstone; mock implements tombstones incl. unpair-tombstone and
     pair-clears-tombstone); the session-local hack is gone; a smoke test
     asserts a dismissed candidate stays gone across remounts.
  6. Suggest is positional with `category: null` for unmatched (type + mock +
     chip filter); bulk categorize typed `{updated}`; `api_key_last4` null
     and `by_purpose` shape were already conformant; `possibly_forgotten`
     keys on variability ≤ 5% (ruling) rather than exact-amount equality.
  7. Price-change values pass through raw/rounded; badges gate at ≥ 5%
     (matching the backend's own price_increases threshold).
  8. `?uncategorized=1` paired-row exclusion confirmed (already conformant).
  - **Engine v2 passthrough (T-011a):** `SimResult.engine_notes` +
    `assumptions` (typed `SimAssumptions` incl. reserved `tax_model?`); mock
    sim emits engine_version "2", the contract note, and its actual resolved
    constants (market mu/sigma, resolved inflation incl. override, tax rate,
    ss_taxable_share 0.85). No UI consumes them yet — the assumptions strip
    is T-011b as instructed.
  - **Attention economics audit (new DESIGN.md rule):** review nav badge now
    caps at **9+** (smoke test asserts the cap) and clears itself at zero
    (renders nothing). Freshness has exactly the two blessed surfaces —
    inline row status where the object lives + the dashboard aging→stale
    strip; no chrome badge, no per-item nags, the strip navigates rather
    than suppresses. No other attention surfaces exist in the T-008 UI.
