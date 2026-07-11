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
