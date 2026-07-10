# T-002 — Frontend foundation

Owner: frontend-dev agent · Branch: `ws/frontend` · Status: review

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
- 2026-07-10 (frontend-dev): scaffold up — Vite 6, React 18.3, TS strict,
  Tailwind v4.3 (no trouble; v3 fallback not needed), TanStack Query 5,
  react-router 6. Inter vendored via @fontsource-variable (no runtime font
  fetches). Dev proxy probes 8443 at startup and falls back to :8000.
- 2026-07-10 (frontend-dev): dataviz skill invoked before chart code; chart
  palette is the skill's validated 8-slot set, re-validated with its script
  against our actual light (#ffffff) and dark (#15181e) card surfaces — both
  pass (light slots 2/3/7 are sub-3:1, mitigated by legends/probe/labels per
  the relief rule). Same categorical set serves both themes; the game skin
  swaps chrome tokens + radii only.
- 2026-07-10 (frontend-dev): deviation from dataviz skill, per DESIGN.md
  (binding): hero/stat money figures use tabular-nums — DESIGN.md mandates it
  for all money; the skill prefers proportional digits on heroes.
- 2026-07-10 (frontend-dev): charts are hand-rolled SVG. Fan chart: layered
  p10–p90/p25–p75 fills, 2px p50, dashed deterministic reference, crosshair
  probe (pointer + arrow keys) with age/year/percentiles, 400ms draw-in,
  300ms rAF tween on data change (resamples across differing lengths, snaps
  under prefers-reduced-motion or the reduce_motion setting).
- 2026-07-10 (frontend-dev): applied coordinator contract rulings: recurring
  event amounts normalized to positive magnitude (direction by kind) in
  cleanParams; one_time stays signed; CSV preview sample_rows consumed as
  {column: value} objects; CSRF header already sent on every mutation incl.
  logout; balances body already {date, amount}; 201 handled by any-2xx path.
- 2026-07-10 (frontend-dev): contract note for coordinator — API.md leaves
  `GET /dashboard` `goals_summary` unspecified (`[...]`); web types it as the
  full Goal[] and the mock returns that. If the backend returns a slimmer
  shape, say the word and I'll adapt.
- 2026-07-10 (frontend-dev): mock /simulate is a seeded annual-step GBM Monte
  Carlo (mulberry32 + Box–Muller) over cash/invested/property/debt buckets
  with retirement transition, SS, inflation, events, savings-delta redirect;
  engine_version "mock-1"; deterministic per (params, seed) so compare and
  keepPreviousData stay stable.
- 2026-07-10 (frontend-dev): verification — `npm run build`, `npm run lint`
  clean; 43 vitest tests green incl. jsdom smoke that mounts the real App on
  the mock API and walks all seven screens plus login/setup routing. No
  headless browser exists on this host (chromium shell missing libatk, no
  root), so visual QA in a real browser is left to T-003; `VITE_MOCK=1 npm
  run dev` verified serving. Status → review.
- 2026-07-10 (coordinator): merged to main. Acceptance: independent
  build/lint/43-test run; read api client + FanChart. goals_summary ruled a
  Goal subset + pct_funded (API.md updated); web types/mock aligned by
  coordinator. FastAPI now serves web/dist with SPA fallback (integration
  smoke-tested incl. traversal probes). Note for T-003: Goal.emoji nullability
  in web types (`string`) vs backend (nullable) — audit and align.
