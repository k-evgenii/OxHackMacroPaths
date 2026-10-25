# Launch prompt — Agent 12: Unified Session page

You are Agent 12 implementing the single client Session page from `foundationSHA` in your assigned worktree.

Read `docs/frontend-v2/agents/12-session-page.md`, shared references, applicable repository instructions, and delivery/UI/exact-data skills.

Own only `web/src/app/session/[addr]/{page,layout}.tsx` and `web/src/features/session/**`, including tests and CSS modules. Do not move/delete old subroutes or edit global CSS, queries, shared UI, root providers/layout, manifests, or fixtures. Agent 15 owns `/dev` migration and redirects.

Start against the foundation's frozen hooks, UI props, and scenarios. Build the historical inflation hero chart, last replay reading/month, both product scores, covers-first owned holdings, and separate total-deposited/current-vault information. Use shared `summarizeHolding` and exact formatters; do not calculate financial outputs from chart numbers or unsettled stored budgets.

Reference session A retains its test caps and 82.7%/86.4% scores. Research p90 terms cannot be mixed into it. Incomplete replay is a normal state; range selection does not change contract scores; final payouts differ from Running illustrations.

Implement all loading, empty, unavailable, error, disconnected, claimed, and Refunding states. Test the state semantics and chart/layout interactions, capture mobile/tablet/desktop screenshots, and send shared-interface needs to the orchestrator. Finish with checks, screenshots, integration requests, and branch/commit reference. Do not deploy.
