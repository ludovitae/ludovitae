# Design brief — "impeccable" is the acceptance bar

The owner's words: *"UI polish and visuals should be impeccable."* Treat visual
quality as a launch-blocking requirement, not a nice-to-have.

## Direction

Default theme **`fintech`**: premium dashboard in the Stripe/Linear tradition.
Dark-mode-first (with a real light mode), restrained color, generous whitespace,
crisp numeric typography, motion that explains rather than decorates.
Second theme **`game`** behind the `theme` setting: same components, playful
token swap — warmer palette, rounded geometry, the scenario explorer framed as
a life path/board. Build `fintech` to full polish first; `game` may ship as a
credible skin rather than full illustration in v1.

## Tokens (theme system)

- CSS variables on `:root[data-theme=...]`; Tailwind reads the variables.
  No hard-coded colors in components. Both light and dark for each theme.
- Type: Inter (UI) + a tabular-nums treatment for all money figures
  (`font-variant-numeric: tabular-nums`). Big dashboard numbers get a display
  size with tight tracking. Self-host fonts — no external requests.
- Money formatting: one shared `formatMoney` util; compact form ($1.4M) on
  charts, full form on focus/tooltip.
- Spacing on a 4px grid; radii 8/12/16; one shadow scale; 150–250ms ease-out
  transitions; respect `prefers-reduced-motion` and the `reduce_motion` setting.

## Charts — the heart of the product

Invoke the **dataviz skill** before writing any chart code; follow its palette
and mark guidance. Requirements:

- Net-worth projection: percentile **fan chart** (p10–p90 band, p25–p75 band,
  p50 line, deterministic path as reference). Bands as layered translucent
  fills. Hover shows a vertical probe with age, year, and percentile values.
- Scenario compare: overlaid p50 lines with band toggle, shared probe.
- Success probability: a large stat with a subtle radial/gauge treatment, not a
  toy speedometer.
- Net-worth history: clean area chart from balance snapshots.
- Animate on mount (draw-in ≤ 400ms) and on scenario-parameter change
  (interpolate, don't re-mount). Sliders re-simulate with debounce; charts must
  never flash empty between updates.

## Key screens

1. **Dashboard** — net worth hero number + delta, history chart, asset/liability
   breakdown, goals progress rail, monthly surplus stat.
2. **Scenario studio** — the star. Left: parameter panel (retirement-age slider,
   savings-delta slider, spending, event chips like "＋ take up golf"). Right:
   live fan chart + success probability + ending-net-worth stats. Comparison
   mode pins scenarios side-by-side.
3. **Accounts** — table with type icons, inline balance edit, snapshot history
   drawer.
4. **Goals** — card grid with progress, target date feasibility pulled from sim.
5. **Import** — drag-drop, column-mapping preview table, duplicate report.
6. **Auth** — first-run setup and login: minimal, centered, product-quality.

Empty states are designed (illustrated hint + primary action), never blank.
Loading uses skeletons, never spinners on full pages. Every interactive element
has hover/focus-visible/active states. Keyboard navigable throughout.
