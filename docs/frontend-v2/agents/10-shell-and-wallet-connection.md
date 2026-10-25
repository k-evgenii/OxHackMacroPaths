# Agent 10 — Shell, queries, and wallet connection

## Mission

Build the common navigation and wallet-connection experience, and provide the shared API query layer used by all client pages. Wallet adapters expose the public owner address; application data is read only through validated API responses.

## Read before editing

Read applicable repository instructions, `../README.md`, `../interfaces.md`, `../product-and-content.md`, `../api-and-architecture.md`, `../design-system.md`, `../parallel-execution.md`, and `../acceptance.md`. Read the delivery, UI, exact-data, and history skill files relevant to your implementation.

## Exclusive ownership

- `web/src/components/shell/**`.
- `web/src/features/shell/**` and `web/src/features/wallet-connect/**`.
- `web/src/lib/api-client.ts`.
- `web/src/lib/hooks/index.ts` and `web/src/lib/hooks/queries.ts`.
- `web/src/lib/queries/**`.
- Tests inside your owned feature directories.

Do not edit root layout, providers, application global CSS, package manifests/lockfiles, package exports, page routes, or other agents' modules. Agent 15 owns root wiring and dependencies. Feature agents must request query changes from you rather than edit shared query files.

## Frozen interfaces

Implement the wallet context, query names, response schemas, and query keys exactly as declared in `../interfaces.md` at `foundationSHA`. The intended wallet context exposes `owner: string | null`, status `disconnected | connecting | connected | error`, and connect/disconnect behavior through `useWalletConnection()`. Root provider composition is an integration request to Agent 15.

Expose approved query factories for catalog, session overview, wallet overview, wallet activity, and developer events. Keep old hooks compiling until migration is complete. Do not create a second schema definition in the query layer.

Publish `WalletConnectionProvider` and `useWalletConnection` from `@/features/wallet-connect`, and `AppShell` plus `useSelectedSession` from `@/features/shell`. Publish `useCatalog()`, `useSessionOverview(addr)`, `useWalletOverview(owner: string | null)`, `useWalletActivity(owner: string | null, limit = 10)`, `useSessionEvents(addr, limit = 10)` and `useResearchBundle(bundleId: string | null)` from `@/lib/hooks`. Query factories are exported from `@/lib/queries`: `catalogQuery`, `sessionOverviewQuery`, `walletOverviewQuery`, `walletActivityQuery`, `eventsQuery` and `researchBundleQuery`. The null-owner hooks remain disabled and return the agreed disconnected state. Own the legacy `manifestQuery`, `forecastQuery` and `plannerQuery` constants in `lib/queries/research.ts`; Agent 07 re-exports them from lib/artifacts.ts, without defining another query implementation.

## Application shell

- Four destinations: Home, Session, Activity, Products.
- Desktop: compact navigation rail, readable active state, top wallet control, constrained content width.
- Mobile: bottom navigation with safe-area spacing; content and focus targets must not be hidden beneath it.
- Keep historical replay/devnet/test PLAY context visible without showing slot counters or protocol addresses in navigation.
- Use registered session names, not raw addresses, in the client picker.
- Current session selection must survive navigation through the approved URL/query contract. Fall back to the catalog default only when no explicit selection exists.
- Handle loading/unavailable catalog state without inventing a session choice.
- Include skip navigation and accurate `aria-current` states. If a mobile drawer remains necessary, implement Escape, focus management, and close-on-route-change behavior.

## Wallet connection

- Support Phantom and Solflare through the approved wallet-adapter dependencies.
- Connection requests public address access only. Do not ask for message signatures, sign/send transactions, request test tokens, or call RPC for balances.
- Do not use adapter convenience components that silently introduce application RPC reads or transaction signing.
- Provide absent-wallet, connection-in-progress, rejection/error, connected, switch, and disconnect states.
- Display shortened addresses with an explicit copy control; announce success/failure accessibly.
- Never persist a wallet balance, holding, or owner-specific API response outside the agreed query cache.
- Immediately clear owner-specific display state on disconnect/switch; cancel dependent requests and prevent late responses for the previous owner from entering the new owner's view.

## fetchJson and fixture mode

- Validate every response with the shared zod schema and normalize errors consistently.
- Support AbortSignal where the frozen query interface requires cancellation.
- Fixture mode answers all client endpoints without RPC or Redis. Respect requested wallet owner, session, pagination, pending page, and retry cursor semantics.
- Fixture data belongs to the declared fixture owner. An unrelated connected wallet must see empty holdings, not demonstration ownership.
- Use explicit fixture mode only; never catch a live request failure and silently return mock data.
- Remove fixture-only prefetch use from shell components without deleting legacy route files owned by Agent 15.

## Query policy

Use shared keys including owner, session, cursor context, and bundle version where relevant. Open sessions poll every 15 seconds, Running every 5 seconds, terminal sessions every 60 seconds, and wallet reads every 15 seconds while visible. Do not poll client slot health.

History queries use `retry: 0`; pending recovery follows the frozen page protocol. Do not refetch all older pages in a tight polling loop. Keep valid previous data during a refresh error and expose its stale state to feature adapters.

## Verification and handoff

Test key isolation, wallet switch/disconnect, cancellation, fixture owner matching, schema failures, query freshness, active navigation, focus management, and error recovery. Verify browser data reads go to the application API. Browser configuration and root wiring remain with Agent 15.

Report ready query/context interfaces, old consumers that still need migration, dependency/provider requests, checks, screenshots, base SHA, and branch/commit reference. Do not remove duplicate formatter modules yourself; their consumers migrate in other branches before Agent 15 deletes them.
