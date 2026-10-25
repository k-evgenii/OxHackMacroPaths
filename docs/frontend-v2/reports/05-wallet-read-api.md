# Report — Agent 05 wallet-read-api

## Changed files
- `web/src/server/wallet/overview.ts`: `getWalletOverview(owner)` (frozen signature), `readWalletOverview(owner, deps)` (port-injected core), `fixtureWalletOverview`, `readHoldingAccount`, `sumTokenAccounts`.
- `web/src/app/api/wallet/[owner]/route.ts`: GET only. Validates the response with the shared `WalletOverviewResponse` zod schema through `okJson`.
- `web/test/wallet-read/overview.test.ts`: 20 tests.

## Behaviour
- The owner is parsed with the shared `parsePubkey`. A malformed owner returns a typed 400 `bad_request` before any repository or fixture access.
- Sessions come from `sessionRepository.listRegistered()` (Agent 04, `@/server/sessions`). If the registry fails, the endpoint returns an error.
- For each session, only the wallet's Position and Cover PDAs are derived and read, through `getManyAccounts`, in batches of 100 keys or fewer. The code never calls `getProgramAccounts` and never reads history.
- Each account is checked before decoding (program owner, discriminator) and after decoding (embedded session and owner, view address). A mismatch makes that holding `unavailable` and logs a warning; it is never shown as absent. A failed batch read also makes its sessions `unavailable`. A missing account is reported as a successful `null`.
- Views come from the shared `toPositionView`/`toCoverView`, so the Settled, Refunding and Running/Open payout rules follow shared math. Claimed holdings keep their history; `summarizeHolding` gives `unclaimedTotal` "0", and a test covers this.
- Balances have one entry per distinct registered `playMint`, never merged. The service sums every classic SPL Token account returned by `getTokenAccountsByOwner(owner,{mint})` using bigint. Accounts owned by other programs are skipped, and uninitialized accounts are skipped. A mint or owner mismatch, or a failed RPC read, makes that balance `unavailable`, never zero. No token accounts after a successful read gives `"0"`.
- Cache: the optional `CacheStore` uses keys `wallet:v1:{cluster}:{owner}:balance:{mint}` and `...:holding:{session}`. TTL is 5 s for mutable reads and 60 s for Settled/Refunding holdings. Only successful sections are cached. Production currently passes no store (see blockers).
- Fixture mode (`NEXT_PUBLIC_USE_FIXTURES=1`): owners `wallet/a-owned` and `wallet/empty-owner` get their own fixtures. Any other owner gets an all-zero/null state over the same mint/session set. It makes no RPC or Redis calls.

## Response examples
- Available: `packages/client/fixtures/frontend-v2/wallet/a-owned.json`, `two-mints.json`.
- Empty: `{"owner":"<o>","meta":{"source":"rpc","fetchedAt":"…"},"balances":[{"mint":"AvVf…","read":{"status":"ok","data":{"amount":"0"}}}],"holdings":[{"sessionAddress":"B89z…","read":{"status":"ok","data":{"position":null,"cover":null}}}]}`
- Partial: same shape, with any entry set to `{"status":"unavailable","data":null}` (see `wallet/section-unavailable.json`).

## Tests
- `npx vitest run test/wallet-read`: 20/20 pass, after merging checkpoint 1 (85a62e8).
- `tsc --noEmit`: the only error is `Cannot find module '@/server/sessions'`. Worker 04's branch provides that module (961af80), and it is not merged into my branch yet.

## Blockers / notes
- `@/server/sessions` arrives with Worker 04's integration.
- Token balances use the legacy `rpc()` wrapper, because Worker 02's `RpcReader` is not published yet. They should switch to the admitted reader and pass a shared `CacheStore` at integration (Agent 15).
- Token-2022 accounts are deliberately excluded, following "standard SPL token accounts".
