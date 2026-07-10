# Game of Life — web

Vite + React 18 + TypeScript (strict) + Tailwind CSS v4 + TanStack Query.

```bash
npm install
VITE_MOCK=1 npm run dev   # full demo against the in-browser mock API
npm run dev               # against the real backend (proxy: 8443 → 8000 fallback)
npm run build             # type-check + production build
npm run lint
npm test
```

- **Mock mode** (`VITE_MOCK=1`): every screen works with a realistic demo
  household (age 46, ~$812k net worth). First load shows the first-run setup
  screen; pick any password ≥ 10 chars. Data resets on reload; login persists.
- **Dev proxy**: `/api` → `https://localhost:8443` (self-signed OK); if 8443 is
  closed when the dev server starts, it falls back to `http://localhost:8000`.
- **Themes**: `fintech` (default) and `game`, each with light + dark, driven by
  CSS variables on `:root[data-theme][data-mode]` (`src/styles/tokens.css`).
  No hard-coded colors in components. Inter is vendored (no runtime fetches).
- **Charts** are hand-rolled SVG (`src/charts/`) per the dataviz design method:
  fan chart with percentile bands, crosshair probe, keyboard navigation,
  tweened transitions, reduced-motion support.
