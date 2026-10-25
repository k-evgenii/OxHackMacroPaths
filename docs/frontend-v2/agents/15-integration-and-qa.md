# Worker 15 — integration, developer console and QA

Read ../frontend-protocol.md, ../parallel-execution.md, ../interfaces.md and ../acceptance.md. This is a frontend assignment; the old program agent 15 deployment permission does not apply.

## Mission

Prepare integration immediately while fourteen peers implement isolated modules. Own shared wiring, preserve legacy developer visibility, and verify one working read-only product after integrating completed dependency closures. Optimize the critical path by preparing fixtures/browser cases early, not by skipping checks.

## Exclusive active-worker ownership

- Root web layout, `web/src/lib/providers.tsx`, application global CSS and `web/src/styles/` aliases.
- `packages/ui/src/index.ts`, all dependency manifests/lockfiles, Next/TS/test/lint configuration and common test infrastructure.
- Frozen `web/src/server/contracts.ts`, `web/src/lib/presentation/contracts.ts` only for coordinator-approved changes.
- New `web/src/app/dev/`, `web/test/e2e/`, `web/test/integration/`, shared `web/test/support/frontend-v2/`.
- Legacy public Forecast/Planner, session Path/Results/Seller/Activity routes and fallback cleanup after the owner is joined.
- Environment examples, frontend README, integration report `docs/frontend-v2/reports/15-integration-and-qa.md`.

Do not edit a peer's active feature, schema, query, kit stylesheet or repository implementation. After explicit handoff/closure, necessary cross-feature cleanup is allowed with a recorded reason.

## Immediate parallel work

1. Review frozen contracts and ownership; report discrepancies before they spread.
2. Prepare provider composition: QueryClient, address-only WalletConnectionProvider, approved AppShell. Keep root wiring minimal until producers land.
3. Snapshot the old raw routes from ORIGINAL_FRONTEND_SHA into new `/dev` paths. Read original files through git; do not move directories under another worker.
4. Prepare Playwright/browser fixture cases for disconnected, A-owned, empty, Running, Refunding, claimed, partial data and errors.
5. Prepare environment validation, dependency/export requests and root tracing settings. Package changes are serialized with coordinator bootstrap.

## Integration work

Integrate real commits in dependency order. Preserve worker attribution and inspect conflicts rather than choosing an entire branch version. Publish checkpoints when shared interfaces must change; return producer-specific corrections to the producer.

- Use the latest verified security-patched stable Next 15.x/compatible React 19 versions; pin and lock them. Check current official advisories at execution rather than relying on an old minimum patch.
- Add `@macropaths/ui` wiring and browser-safe client exports as requested by 01. Keep exact web3.js/Anchor constraints.
- Make artifact publishing explicit, never a side effect of predev/prebuild. Use committed bundle imports/tracing in serverless builds.
- Wire all styles and Geist once; map legacy developer views onto the adopted kit and shared formatters.
- Gate `/dev/*` through a server layout using DEV_CONSOLE=1; disabled returns 404. No `?dev=1` or public client flag bypass.
- Add a developer API explorer for fixed application endpoints; do not allow arbitrary upstream URL proxying or expose server environment values.
- Redirect old Path/Results to Session, old session Activity to `/activity?session=...`, old Seller/Forecast/Planner to Products. Preserve session context in navigation.
- Remove fallback UI/formatter systems only after all consumers migrate. Public Session layout is worker 12's until handoff.
- Confirm fixture mode covers every public endpoint and no live-mode mock fallback remains.

## Required evidence

Run ../acceptance.md fully on the integrated tree. Check actual package scripts and use Pixi. Browser-test the approved widths, keyboard and reduced motion. Inspect network traffic for browser RPC, console for hydration errors and layout for clipped content. Validate partial Redis/RPC failure semantics and show correct response when services are not configured.

Tests must verify outcomes, not merely headings or implementation details. Do not launch real transactions, deploy, provision paid services, push, or merge remote PRs. Never display .env or private keys.

## Handoff

Use ../report-template.md. Include final SHA, integrated producer SHAs, environment-variable names, executed commands/results, screenshots, cold/warm RPC counts and incomplete service-dependent checks. The final application is complete only when public pages, personal reads, history and developer gate agree with the contracts and acceptance scenarios.
