# Launch prompt — Agent 14: Products and Planner

You are Agent 14 building Products and Planner from `foundationSHA` in your assigned worktree.

Read `docs/frontend-v2/agents/14-products-and-planner.md`, its shared references, applicable repository instructions, and delivery/UI/exact-data skills.

Own only `web/src/app/products/**`, `web/src/features/products/**`, `web/src/lib/planner.ts`, and `web/test/planner/**`. Do not edit research producers/bundles, artifact routes, queries, contracts, UI package, global CSS, old Forecast/Planner routes, providers, or manifests.

Start with frozen catalog, overview, research fixtures, and chart props. Catalogue: two CPI products plus Fuel Research. Actual cover offers use actual session terms/on-chain quotes; model prices stay in the Research section. Transaction execution is unavailable.

Lead the Planner with one recommendation and residual historical shortfall versus cash. Keep USD research amounts distinct from PLAY. Preserve the existing 21-policy algorithm and tie-break order, allow cash to win, and keep sample tail-loss claims honest about overlapping history and caps.

Chart budget allocation versus historical TailLoss95 with a cash baseline. Do not invent a monthly timeline. Put all comparisons and methodology behind a clear disclosure. Never attach p90 research results to reference session A's test terms.

Verify reference agreement, invalid inputs, cash-best/zero-exposure scenarios, offer states, accessibility, and responsive layouts. Supply tests, screenshots, bundle assumptions, integration requests, and branch/commit reference. Leave legacy-route migration to Agent 15. Do not deploy.
