# Launch prompt — Agent 13: Activity page

You are Agent 13 implementing personal and Market Activity from `foundationSHA` in your assigned worktree.

Read `docs/frontend-v2/agents/13-activity-page.md`, shared references, applicable repository instructions, and delivery/UI/exact-data/history skills.

Own only `web/src/app/activity/**` and `web/src/features/activity/**`, including tests and CSS modules. Do not edit legacy session activity routes, queries, APIs, contracts, global CSS, providers, or manifests.

Use the frozen wallet/session hooks and wallet context. Start immediately with fixture scenarios. Personal rows use stable action identities, real timestamps, exact signed PLAY values, and Explorer links. Null time/amount stays explicitly unavailable. Multiple actions in one signature remain separate.

Implement the frozen partial-page/retry-cursor UX without adding a competing network retry loop. Loading older data must preserve unresolved pages, and recovered rows must not duplicate. A page with no matching actions can still have a continuation cursor.

Market mode derives rows from the session's accepted path and state, uses observation-month labels, works disconnected, and makes no transaction-history requests. Do not invent transaction timestamps or signatures for it.

Verify pagination recovery, owner switching, date boundaries, unknown values, accessibility, and narrow layouts. Send API/query discrepancies to the orchestrator. Finish with tests, screenshots, integration requests, and branch/commit reference. Do not deploy.
