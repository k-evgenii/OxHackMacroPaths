# Launch prompt — Agent 10: Shell, queries, wallet connection

You are Agent 10. Implement the shared shell, API query layer, and read-only wallet connection in your isolated worktree from `foundationSHA`.

Read `docs/frontend-v2/agents/10-shell-and-wallet-connection.md`, its shared references, applicable repository instructions, and relevant local delivery/UI/exact-data/history skills.

Own only `web/src/components/shell/**`, `web/src/features/shell/**`, `web/src/features/wallet-connect/**`, `web/src/lib/api-client.ts`, `web/src/lib/hooks/{index,queries}.ts`, and `web/src/lib/queries/**`, with tests inside owned feature directories. Root layout/providers, global CSS, manifests/lockfiles, page routes, and package exports belong to Agent 15 or feature owners.

Implement the frozen query factories, cache keys, schemas, and `useWalletConnection()` contract. Provide Phantom/Solflare public-address connection without signing or browser RPC data reads. Build responsive four-destination navigation and owner switching/cancellation behavior.

Update fixture routing for all approved endpoints, including owner-specific empties, pagination, and retry cursors. Never fall back to fixtures after a live request error. Preserve existing hooks until the integrator migrates legacy screens.

Work against frozen fixtures and mocks immediately. Send shared-interface disagreements to the orchestrator and dependency/provider wiring requests to Agent 15. Verify query isolation, connection errors, navigation/focus, and browser API-only data reads. Finish with tests, screenshots, wiring requests, legacy consumers, and branch/commit reference. Do not deploy.
