# T-002 — Frontend foundation

Owner: frontend-dev agent · Branch: `ws/frontend` · Status: todo

## Scope

Everything in `web/` per docs/DESIGN.md (read it fully — polish is the
acceptance bar), against the contract in docs/API.md:

1. Vite + React + TS + Tailwind scaffold; ESLint + Prettier; vitest.
2. Theme system: CSS-variable tokens, `fintech` (dark+light) fully polished,
   `game` as credible token-swap skin; settings-driven, `data-theme` on root.
3. Typed API client from docs/API.md + TanStack Query; CSRF header handling;
   401 → login redirect. Dev proxy `/api` → `https://localhost:8443`.
4. Screens: auth (setup + login), dashboard, accounts, goals, scenario studio
   (sliders + event chips + live fan chart + compare), import wizard, settings.
5. Charts per DESIGN.md — **invoke the dataviz skill first**. Fan chart with
   percentile bands, animated transitions, hover probe.
6. A mock API mode (`VITE_MOCK=1`, MSW or simple fixture layer) with realistic
   demo data so the UI is fully demoable before backend merge.
7. Empty states, skeleton loading, keyboard navigation, reduced-motion support.

## Acceptance criteria

- `npm install && npm run build` clean; `npm run lint` and `npm test` green.
- `VITE_MOCK=1 npm run dev` demos every screen with no backend.
- No hard-coded colors in components; both themes and both modes render.
- Scenario studio: slider drag → debounced re-sim → chart interpolates without
  flashing empty.

## Log

- 2026-07-10 (coordinator): task created.
