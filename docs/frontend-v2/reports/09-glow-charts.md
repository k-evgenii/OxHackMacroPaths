# Report — Agent 09: Glow charts

Base: foundation `6d2865b` (shared foundation checkpoint not yet merged at time of writing). Branch `frontend-v2/09-glow-charts`.

## Delivered

- `packages/ui/src/glow-chart/types.ts` — `GlowPoint`, `GlowSeries`, `GlowLineChartProps` copied verbatim from interfaces.md "Chart props" (no foundation declaration existed in this worktree).
- `packages/ui/src/glow-chart/geometry.ts` — pure helpers: `yDomain`/`xDomain` (empty/flat/single/negative, threshold included), `yTicks` (<=5, no gridlines), `segments` (null gaps never bridged), `monotonePath` (Steffen monotone cubic, passes through points, control points stay within each interval's y-range => no overshoot), `areaPath`, `nearestPoint`, `stepSelection` (Arrow/Home/End), `clampBubble`, `estimateBubbleWidth`.
- `packages/ui/src/glow-chart/GlowLineChart.tsx` — `GlowLineChart`, `GlowSparkline` (variant fixed), `GLOW_COLORS`. Canvas `#101722`, line `#6F9FFF` 1.5 px round joins/caps, separate feGaussianBlur underlay (5 px stroke, sd 2.5), fill 8% -> 0, subordinate excess shading clipped above dashed threshold, muted ticks `#A4B1C5`. Hero = 1 series, comparison <= 2 (secondary tone), sparkline non-interactive. Pointer/touch picks nearest actual point; keyboard focus + arrows/Home/End/Escape; polite live region announces `label: formattedValue` (exact strings only); visually-hidden summary and observation table ("Not recorded" for nulls). Controlled or uncontrolled selection keyed by point id (stable across refresh). `useId`-based unique SVG ids. Draw-in only on first ~1 s after mount, disabled under `prefers-reduced-motion`. Chart-local CSS is injected via a scoped `<style>` (no edits to shared styles.css).
- `packages/ui/src/charts.tsx` — appended re-exports of the above; all legacy exports (`Sparkline`, `PathChart`, `BarChart`, `MiniBars`, `CompositionBar`, `LegendRow`) unchanged. Because `index.ts` already does `export * from "./charts"`, the barrel exposes the new names without editing it.
- Tests: `web/test/glow-chart/geometry.test.ts`, `web/test/glow-chart/render.test.ts` (SSR markup via react-dom/server).

## Tests

- `web/test/glow-chart/geometry.test.ts`: 19 pass (also passes under the stock `web/vitest.config.ts`).
- `web/test/glow-chart/render.test.ts`: 10 pass, but only with a scratch vitest config aliasing `react`/`react-dom` to `web/node_modules`. Under the stock config it fails with `Cannot find module ... react-jsx-dev-runtime` because `packages/ui` has no `node_modules` and `@macropaths/ui` is not yet wired into `web` (foundation / Agent 15 dependency wiring). No config was changed.
- `tsc` typecheck of `packages/ui/src/glow-chart` not run for the same reason (React types unresolved from `packages/ui`).

## Export requests (to Agent 15 / orchestrator)

- If the foundation publishes `GlowPoint`/`GlowSeries`/`GlowLineChartProps` elsewhere (e.g. `packages/client/src/presentation.ts`), switch `glow-chart/types.ts` to re-export it at checkpoint merge; shapes are identical.
- No barrel change needed; optionally export `glowGeometry` namespace from `./glow-chart` if pages need helpers (not required).

## Remaining legacy consumers

- `web/src/components/charts/PathChart.tsx`, `web/src/app/session/[addr]/path/PathView.tsx` (recharts / legacy UI `PathChart`). Not touched; Agent 15 migrates.

## Not done / blockers

- Screenshots (hero/sparkline/comparison, mobile + desktop): the integration-owned preview/browser harness is not present in this worktree yet; not produced.
- Pointer/keyboard handlers are exercised through the pure helpers they call; no DOM-event test (no jsdom/testing-library in locked deps).
