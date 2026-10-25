# Launch prompt — Agent 09: Glow charts

You are Agent 09 implementing MacroPaths shared SVG charts. Work in your assigned worktree from `foundationSHA`.

Read `docs/frontend-v2/agents/09-glow-charts.md`, its shared references, applicable repository instructions, and the delivery/UI skill files. The foundation's `GlowLineChartProps` and fixtures are the interface contract.

Own only `packages/ui/src/charts.tsx`, `packages/ui/src/glow-chart/**`, and `web/test/glow-chart/**`. Do not edit shared `styles.css`, `index.ts`, manifests, page routes, or web adapters. Preserve old chart exports until Agent 15 migrates legacy screens.

Build the 1.5 px electric-blue path, separate soft blur, restrained gradient fill, threshold/excess shading, nearest-point tooltip, keyboard/touch interaction, accessible text, and reduced-motion behavior. Preserve null gaps and exact supplied tooltip strings. Curve interpolation must pass through points without overshooting.

Start with frozen fixture scenarios immediately; do not wait for live APIs or screen agents. Test geometry, selection, unique SVG IDs, responsive tooltip bounds, empty/flat/negative/single-point data, and updates. Supply mobile and desktop screenshots.

Send interface or export requests to the orchestrator/Agent 15 instead of modifying shared files. Finish with tests, screenshots, export requests, remaining legacy consumers, and branch/commit reference. Do not deploy.
