# Worker 10 handoff

## Identity

- Worker 10: shell, queries, wallet connection.
- Foundation 6d2865b, then checkpoint 1 85a62e8 (merged in this branch).
- Branch frontend-v2/10-shell-and-wallet-connection. The commit SHA is given in the final message.
- Status: complete for owned scope. Browser screenshots were not taken (see Remaining issues).

## Delivered

- `web/src/lib/api-client.ts`: `fetchJson(path, schema, {signal}?)` keeps its two-argument form and passes `signal` through to fetch. Every response is validated with the shared zod schema. Errors are always `ApiRequestError` with a numeric `status` (0 means network), a `code`, and a safe message. `describeError()` returns user-facing text. Fixture mode is explicit (`NEXT_PUBLIC_USE_FIXTURES=1`) and its data is loaded by dynamic import. Fixture mode never touches the network. A live error is never answered with fixture data. Unknown endpoints in fixture mode return 404.
- `web/src/lib/queries/`:
  - `index.ts` contains `catalogQuery`, `sessionOverviewQuery`, `walletOverviewQuery`, `walletActivityQuery(owner, limit=10)`, `eventsQuery(addr, limit=10)` and `researchBundleQuery`, using the frozen `keys.ts`.
  - `research.ts` holds the legacy `manifestQuery`, `forecastQuery` and `plannerQuery`.
  - `polling.ts` sets intervals: Open 15 s, Running 5 s, terminal 60 s, wallet 15 s. They run only while the page is visible. Health is no longer polled.
  - `history.ts` is the shared infinite-history helper:
    - page param `{before?, retryCursor?}` and `retry: 0`, with no interval polling;
    - `replaceHistoryPage` and `recoverHistoryPage` (in-place replacement that is dropped if the cursor has changed);
    - `usePendingRecovery`: automatic retries at about 5, 15 and 30 s while visible, then a manual `retry()`.
  - `fixture-router.ts` covers all approved endpoints plus the legacy ones:
    - Wallet data is owner-specific. Only the declared fixture owner sees the A-owned holdings and activity. Any other owner gets zero balances and null holdings for the registered set.
    - The two-page history ends with a partial page. Its retry cursor returns the complete same page and keeps the original `nextBefore`. Bad cursors, mixed parameters and bad limits return 400.
    - `NEXT_PUBLIC_FIXTURE_CATALOG=multi` switches to the synthetic multi-session catalog.
- `web/src/lib/hooks/index.ts` provides `useCatalog`, `useSessionOverview(addr|null)`, `useWalletOverview(owner|null)`, `useWalletActivity(owner|null, limit)`, `useSessionEvents(addr, limit)` and `useResearchBundle(id|null)`. A null argument disables the query, so no request is made. All legacy hooks are kept. Legacy `hooks/queries.ts` re-exports the v2 `eventsQuery`, whose key shape is unchanged.
- `web/src/features/wallet-connect/`:
  - `WalletConnectionProvider` and `useWalletConnection()` follow the frozen contract.
  - The controller uses a sequence guard, so a late connect after a disconnect or switch is discarded.
  - Phantom and Solflare are supported through the approved `@solana/wallet-adapter-*` packages. These are loaded lazily, and only `connect`, `disconnect` and `publicKey` are used. There is no ConnectionProvider, no signing and no RPC.
  - When the owner changes or disconnects, `clearOwnerQueries` cancels and removes `['wallet', previousOwner]` immediately.
  - Exported components: `WalletControl` (absent, connecting, declined/error, connected, switch, disconnect and copy states, with live-region announcements), `CopyableAddress` and `WalletPicker` (requested by worker 11), and `EnsureWalletConnection`.
- `web/src/features/shell/`:
  - `AppShell` has four destinations: Home, Session, Activity and Products. Desktop uses a rail; mobile uses a bottom bar with safe-area padding, and `main` has bottom padding so content is not hidden.
  - It includes a skip link and `aria-current`, and focus moves to `main` on route change.
  - A context pill reads "Historical replay · devnet · test PLAY". There are no slot or address values in the navigation.
  - The session picker shows registered labels and handles loading and unavailable states.
  - An invalid selection shows an alert with a "Return to the default session" link.
  - `useSelectedSession()` is URL-driven: a path session beats `?session`, and the hook does no `localStorage` precedence.
- `web/src/components/shell/AppShell.tsx` now re-exports the new shell. `Prefetch.tsx` is a pass-through, because fixture-only prefetch was removed.

Consumer requests from the coordinator:
1. `useWalletActivity` is a TanStack infinite query (`data.pages` is `WalletActivityResponse[]`) with an added `recovery` field `{pending, status, needsRefresh, retry()}`. `recovery.retry()` re-requests the first pending page by its retryCursor and replaces it in place. Without a cursor it refetches. `useSessionEvents` works the same way.
2. `useSessionOverview(addr: string | null)`: null or '' disables the query.
3. `ApiRequestError.status` is numeric. A 400 indicates an invalid or expired cursor.
4. `CopyableAddress` and `WalletPicker` are exported from `@/features/wallet-connect`.
5. The research key is `['research', bundleId]`. The returned `id` must equal the requested one; otherwise the query fails with `ApiRequestError(409, 'bundle_mismatch')`. Worker 07 should pass `PUBLISHED_BUNDLE_ID` and re-export the legacy constants from `@/lib/queries`.

## Evidence

See the final message for the exact vitest and tsc results run after checkpoint 1. The tests are in `src/lib/queries/*.test.ts`, `src/features/wallet-connect/controller.test.ts` and `src/features/shell/selection.test.ts`. They cover:
- frozen keys and owner isolation;
- polling policy;
- `retry: 0` for history;
- history URLs and in-place replacement;
- recovery race handling;
- bundle ID mismatch;
- cancellation aborting the fetch signal;
- fetchJson validation and error normalization;
- no fixture fallback in live mode;
- fixture owner matching, pagination and retry cursors;
- wallet connect, absent wallet, rejection, late connect, account switch and disconnect;
- owner cache clearing;
- selection precedence, invalid selection and hrefs.

No browser run was done.

## Integration dependencies (worker 15)

- Root layout: mount `<WalletConnectionProvider>` inside `QueryClientProvider` around `<AppShell>`. Until then, `AppShell` adds its own provider through `EnsureWalletConnection`, so nothing crashes.
- Routes `/activity` and `/products` are needed for the new navigation. Pages that call `useSelectedSession` must render under `<Suspense>` because it uses `useSearchParams`.
- `@solana/wallet-adapter-{base,phantom,solflare}` must stay in `web/package.json`. They are already present at foundation.
- Legacy consumers still to migrate: `components/shell/Overview.tsx` (`useHealth`/`useSessions`); `/session/[addr]` pages (`useSession`, `useEvents`, direct `fetchJson`, `Prefetch`); `/forecast` and `/planner` (`DEFAULT_SESSION`); `components/charts/_fallback/hooks.ts`; and `lib/artifacts.ts` (worker 07 should re-export from `@/lib/queries/research`).
- No production stubs remain.

## Remaining issues

- No browser screenshots or network inspection were captured. Worker 15's QA needs to check the 375, 768 and 1440 layouts, and needs to confirm in the browser network panel that wallet adapters make no RPC calls.
- With the Solflare adapter and no extension installed, Solflare opens its web wallet for address access. This is still address-only.
