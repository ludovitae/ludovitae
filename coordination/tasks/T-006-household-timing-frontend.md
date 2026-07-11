# T-006 — Household, spending & milestone UI (frontend)

Owner: frontend-dev agent · Branch: `ws/household-fe` · Status: todo

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
