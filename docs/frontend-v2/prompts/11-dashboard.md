# Launch prompt — Agent 11: Dashboard

You are Agent 11 building the MacroPaths Dashboard. Work from the orchestrator's `foundationSHA` in your assigned worktree.

Read `docs/frontend-v2/agents/11-dashboard.md`, its shared references, applicable repository instructions, and the local delivery/UI/exact-data skills.

Own only `web/src/app/page.tsx` and `web/src/features/dashboard/**`, including CSS modules and tests. Do not edit shared queries, wallet provider, global CSS, UI package, root layout/providers, manifests, or fixtures.

Use the frozen hooks from `@/lib/hooks`, wallet context from `@/features/wallet-connect`, UI props, and shared `summarizeHolding`/formatters. Start layouts, adapters, and tests against the foundation fixtures immediately; request shared changes through the orchestrator.

Implement a clear disconnected historical-replay introduction, then a connected home led by PLAY balances and owned covers, with pool positions separate. Final payouts, refunds, accrued illustrations, and claimed holdings must follow the shared semantics. Never show the fixture owner's position for a different wallet, sum different PLAY mints, or invent fiat value.

Add a historical session preview and bounded recent personal activity. Show unavailable/empty/stale states truthfully, keep transaction actions unavailable with a reason, and verify owner switching and mobile layout.

Complete relevant tests and screenshots at 375/768/1440 px. Report integration requests, checks, base SHA, and branch/commit reference. Leave deletion and `/dev` migration of old Overview code to Agent 15. Do not deploy.
