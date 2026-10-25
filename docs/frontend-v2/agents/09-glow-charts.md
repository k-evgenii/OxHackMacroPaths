# Agent 09 — Glow charts

## Mission

Deliver the shared thin glowing SVG chart used by the session hero, product sparklines, and Planner comparison. It must preserve the meaning and exact textual values of the supplied data, work with touch and keyboard, and remain readable under reduced motion.

## Read before editing

Read applicable repository instructions, `../README.md`, `../interfaces.md`, `../design-system.md`, `../product-and-content.md`, `../parallel-execution.md`, and `../acceptance.md`. Read `.claude/skills/macropaths-delivery/SKILL.md` and `.claude/skills/macropaths-ui/SKILL.md` when present. Use the frozen `GlowLineChartProps` contract at `foundationSHA`; do not invent an alternative point/series type.

## Exclusive ownership

- `packages/ui/src/charts.tsx`.
- `packages/ui/src/glow-chart/**`, including chart-local styles and geometry helpers.
- `web/test/glow-chart/**`.

Do not edit `packages/ui/src/styles.css`, the package barrel, manifests, exports, routes, root styles, or shared adapters. Agent 08 owns global kit styling and tokens; Agent 15 wires exports. Preserve existing chart exports required by the original developer screens.

## Parallel workflow

The foundation supplies chart types and scenario data. Implement and test against them immediately. Page agents should be able to import the frozen chart interface while your implementation is in progress. If a prop is insufficient, send the orchestrator a concrete requested change with affected consumers. Do not let one page introduce a private chart fork.

## Rendering contract

- Dark chart canvas `#101722`; primary line `#6F9FFF`; chart-label text `#A4B1C5`.
- Crisp 1.5 px line with rounded joins/caps and a separate Gaussian-blurred underlay around 5 px. Keep the crisp line sharp.
- Area fill fades from at most 8% opacity to zero. Threshold/excess shading must remain subordinate to the line.
- No regular gridlines. Use approximately three to five muted ticks and a dashed threshold where supplied.
- Session hero: one primary observed path. Planner: at most two clearly identified series with a cash reference when supplied.
- Use interpolation through actual points that does not overshoot extrema. Never interpolate across null gaps or fabricate future observations.
- Bound the domain sensibly for empty, flat, negative, and single-point series; include the threshold when it is relevant.
- Preserve stable observation identities when ranges change. Never calculate tooltip text by formatting interpolated coordinates.
- Use exact formatted values and labels supplied by the web adapter. Plotting numbers are display-only and must not be used for payouts or settlement.

## Interaction

- Pointer and touch select the nearest actual point; the crosshair and bubble show its supplied value and label.
- Keyboard users can focus the chart and move among observations; provide a clear selected state and readable announcement without excessive live-region output.
- Keep bubbles inside the container at both edges and at narrow widths.
- Expose an accessible chart title, a concise summary, and access to a textual observation list through the frozen contract.
- Generate unique, hydration-stable SVG IDs for fills, filters, masks, and clip paths. Multiple charts on one page must not share IDs.
- Draw-in animation is subtle and runs on initial display, not on every polling update. Disable entrance/transition motion with `prefers-reduced-motion`.
- Unrecorded months are empty space or an explicitly labelled unrecorded region, never a flat projected line.

## Semantic cautions

Above-threshold shading explains monthly readings above the threshold. The statistic is computed from monthly integer observations, not the geometric area under a smoothed curve. Do not compute any economic statistic from SVG geometry.

A year/range selection changes the visible chart only. It does not recompute the contract score over the cropped interval. Selected-point copy must make that distinction clear where the adapter supplies it.

## Verification

Test geometry invariants and interaction rather than snapshots alone:

- Empty, one-point, flat, negative, partially recorded, and null-gap series.
- No overshoot beyond adjacent point extrema.
- Pointer/keyboard selection returns an actual supplied point.
- Threshold outside the observed range and threshold crossings.
- Tooltip bounds at 375 px, long date/value labels, and large text.
- Multiple instances have distinct SVG references.
- Reduced motion and stable selection during data refresh.
- Planner x-axis describes budget allocation, not fabricated dates.

Provide hero, sparkline, and comparison screenshots at mobile and desktop widths. Use the integration-owned preview/browser harness; do not change its configuration.

## Done and handoff

Deliver frozen exports, geometry helpers, tests, screenshots, exact package-export requests, base SHA, and branch/commit reference. Document any remaining legacy chart exports. Do not delete old chart consumers or edit their routes; Agent 15 owns migration cleanup.
