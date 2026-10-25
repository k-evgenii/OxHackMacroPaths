# Acceptance and verification

## Contract and exact accounting

- All new and existing API responses parse against shared schemas; research schemas are no longer independently defined by a page.
- Reference A retains scores 827387/863980 and exact fixture payouts. Its 380 PLAY contribution total is not assumed to equal the current vault balance.
- Running projections use accrued scores and temporary budgets; Open/Refunding/Settled/claimed labels follow the approved semantics.
- Big values remain exact beyond Number.MAX_SAFE_INTEGER. Pool and cover formulas preserve existing vector agreement and rounding.
- Distinct mints remain separate. No research USD/PLAY conversion appears.
- A known failed read is unavailable, not zero, empty holdings or missing seller.

## API and history

- Registered addresses are read directly. Unknown addresses, missing accounts, unsupported layouts, registry mismatches and RPC failures are distinguishable through status/log evidence.
- Wallet reads derive owner PDAs instead of scanning other participants. Account owner/session/mint checks reject mismatches.
- Partial history returns successful items plus pending signatures; all hydrated transactions failing does not erase the established page.
- A signature-page failure returns the whole-route RPC error. A null transaction remains pending.
- Retry snapshots remain stable while new transactions arrive and preserve original nextBefore. Scope mismatch/expiry is rejected. Empty decoded pages can still paginate.
- Redis outage returns no unusable cross-instance cursor. Recovered pages replace their original page; multiple actions/events per signature stay distinct.
- Cache keys include cluster/program/parser version. Only finalized transactions receive immutable-cache treatment.
- At most two transaction calls are active under configured admission. Retry-After, jitter, timeouts, deadline exhaustion and lease release are tested with fake time/transport, not long live sleeps.
- Deposits and cover claims appear despite missing matching program events. Multi-session and multi-action transactions are attributed correctly; unresolved amounts show unavailable.
- Logs never contain RPC credentials. Application browser traffic performs no RPC data requests.

## Research

- Manifest/forecast/planner hashes and metadata describe one committed bundle. Its caps/prices agree across files.
- Reference A cannot receive p90 research scores or offers. Fuel remains Research.
- The baseline 21-policy algorithm and tie-breaking match the existing reference within established tolerance.
- Defaults are taken from the bundle, not copied as hardcoded constants. Zero exposure/cash recommendation and invalid input states are covered.
- Planner displays residual shortfall and explains overlapping samples/caps. No zero-loss guarantee.
- Normal dev/build commands do not rewrite artifact files.

## UI scenarios

1. Disconnected: product purpose, historical date range/devnet/test-token status, working connect/explore actions.
2. Wallet empty: no phantom fixture holdings.
3. Wallet switch/disconnect: prior personal data disappears; old queries stop.
4. Cover plus pool position: different premium/deposit and payout rules, covers first.
5. Running: exact accrued results labelled illustration, unobserved chart gaps preserved.
6. Settled: final payout and claimed status; claimed historical amount excluded from unclaimed totals.
7. Refunding: refund labels and amounts, no misleading score-driven promise.
8. Activity: real date grouping, stable pagination, partial recovery, unknown date/amount.
9. Market: historical observation grouping and no transaction hydration requests.
10. Research: offer unavailable/closed states distinct from model prices; USD research and PLAY holdings separate.
11. Developer console: server DEV_CONSOLE=1 gate; 404 when disabled; no client link/query-string bypass.

## Visual and interaction QA

Check 375×812, 768×1024 and 1440×900. Capture Dashboard disconnected/connected, Session A, partial Activity and Products/Planner at mobile/desktop. Inspect focus/keyboard, screen-reader labels, contrast, reduced motion, long amounts, tooltips, empty/error/loading and refreshing-stale states.

Chart tests cover no observations, one observation, flat/negative series, threshold outside/inside domain, gaps, long labels, independent SVG IDs, resize, touch and keyboard. Curves pass through samples without overshooting; exact values remain available in text. A product score sparkline cannot be a mislabeled CPI path.

## Commands

Use repository tooling through Pixi. From packages/client: `pixi run npm test` and `pixi run npm run typecheck`. From web: `pixi run npm test`, `pixi run npm run typecheck`, `pixi run npm run lint`, `pixi run npm run build`. Worker 15 adds/runs documented browser and artifact-validation scripts. Read package scripts before executing; unsupported package commands are not claimed as passed.

Run the repository-required baseline once at foundation. Workers run appropriate focused suites; worker 15 runs the integrated commands after dependencies merge. If a check cannot run due to missing environment/service/tooling, record that exact limitation instead of claiming a pass. Keyed devnet smoke tests are opt-in and use protected configuration; fixture verification requires no RPC/Redis.

## Final report

Include integration SHA, producer handoffs, commands/results, screenshot paths, cold/warm cache observations, failure-mode results, required environment variables, known limitations and unchanged program scope. A successful build alone is insufficient. No remote deployment is performed by this assignment.
