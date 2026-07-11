# T-008 — Spending analytics & admin UI (frontend)

Owner: frontend-dev agent · Branch: `ws/spending-fe` · Status: todo (HOLD —
fire after T-005/T-006 merge; branches from main including v1.1)

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
