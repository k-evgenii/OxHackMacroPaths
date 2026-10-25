# Worker 06 handoff

## Identity

- Worker ID and assignment: 06 wallet-history (personal action history and transfer attribution)
- Foundation/checkpoint SHA: 6d2865bf526f0bf980293d9cdcfec547acbfd9f8 (the foundation checkpoint with shared schemas had not been merged when this was written)
- Branch: frontend-v2/06-wallet-history. The commit SHA is in the coordinator handoff message.
- Status: incomplete, but only because of integration. The decoder and service are done and tested. Web typecheck still fails until the checkpoint provides the shared exports listed below.

## Delivered

Owned files:

- `web/src/server/wallet/decode/ports.ts`: structural copies of the frozen `interfaces.md` types (HistoryTransaction, TransactionRepository, WalletActivityItem/Response). Replace them with imports from `@/server/contracts` / `@macropaths/client` at checkpoint.
- `web/src/server/wallet/decode/instructions.ts`: decodes the IDL discriminator/args for deposit, buy_cover, claim and claim_cover. Account roles are read from the IDL, and a test pins them. Also decodes SPL Token / Token-2022 Transfer and TransferChecked.
- `web/src/server/wallet/decode/events.ts`: parses Claimed/CoverBought with the `session` field kept. These events are used only as evidence.
- `web/src/server/wallet/decode/attribute.ts`: `decodeWalletActivity(tx, wallet, sessions)`.
- `web/src/server/wallet/activity.ts`: `createWalletActivity(deps)` plus the frozen `getWalletActivity(owner, request, context?)`. The production dependencies (`transactionRepository` from `@/server/history`, `sessionRepository.listRegistered()` from `@/server/sessions`) are loaded lazily.
- `web/src/app/api/wallet/[owner]/activity/route.ts`: validates `owner`, `before` and `limit`, with a default of 10 and a range of 1..25. It accepts `retryCursor` only on its own. The response goes through `okJson(WalletActivityResponse, ...)`.
- `web/test/wallet-history/{builders,decode.test,activity.test}.ts`: synthetic test-only transactions.

Attribution invariants:

- Failed transactions produce no rows.
- An action is counted only if it calls the real program ID, its signer role equals the wallet, and its session is registered.
- The vault accounts must equal the session's vaults. For buy_cover, the vault must be `vaults[product]`.
- If owner token-account metadata is present, its mint and owner must match.
- A transfer belongs to an action only when that action is its nearest MacroPaths ancestor in the invocation tree. Parent chains come from `parentInnerInstructionIndex`.
- If a transfer has an unresolved parent and touches the owner token account, the affected actions get `amount: null`.
- Amounts are attributed as follows:
  - deposit: −(owner→vault_0 + owner→vault_1). Each leg must equal the decoded side sums `a0+a1` and `a2+a3`.
  - buy_cover: −(buyer premium leg) only. The seller_ta→vault leg is ignored.
  - claim and claim_cover: the sum of vault→owner legs. A Claimed event, when present, must agree with the legs.
- Any unexpected transfer or repeated leg in a subtree, or a mismatch with event data, gives `amount: null`.
- The transaction-wide token balance change is only a reconciliation check, run per owner token account. A missing pre or post side (new or closed account) counts as 0. If the check fails, the amounts become null; the net change is never written into a row.
- Refund versus payout:
  - claim: the Claimed `refund` flag decides.
  - claim_cover, or claim with no event: the session's terminal state decides (Refunding → Refund, Settled → Pool/CoverPayout).
  - Non-terminal state with no event: no row is emitted, rather than guessing the kind.
- Product: one non-zero product gives its index. Both non-zero, or none, gives `null`.
- A zero premium is reported as `"0"` only when one unambiguous CoverBought event proves `buyerPaid = 0`.
- IDs are `${sig}:${ix}:${inner ?? 'top'}:${kind}`. Rows are deduplicated by ID. `blockTime` is passed through, and null stays null.
- Pagination: `nextBefore`, `pending` and `retryCursor` come straight from the repository page, even when no rows were decoded. A retry sends `{retryCursor}` only. A missing `deadlineAt` defaults to now + 20 s.

## Evidence

- `npx vitest run test/wallet-history` (WSL, node 20 from the integration pixi env): 2 files, 32 tests passed. They cover:
  - deposit with no event; two-product deposit
  - inner (CPI) deposit
  - unresolved parentage
  - premium-only buy_cover; event mismatch; zero-premium proof
  - pool and cover claims; refund decided by event and by Refunding state
  - multi-action and multi-session transactions; misplaced sibling transfer
  - wrong owner, unregistered session, other program, failed transaction
  - foreign-owned token account
  - new and closed token accounts; unseen balance movement
  - null blockTime
  - empty decoded page still paginates; Redis-less pending pass-through; retry ID stability; dedupe by ID rather than signature
- `npx tsc --noEmit` in `web`: my files produce exactly three errors, all of which need the foundation checkpoint:
  - `WalletActivityResponse` is not yet exported by `@macropaths/client`.
  - `@/server/history` is missing (worker 03).
  - `@/server/sessions` is missing (worker 04).
- The route's HTTP tests have not been run (they need the shared schema and harness).

## Integration dependencies

- Foundation: the `WalletActivityResponse` zod schema in `packages/client/src/types.ts`.
- Worker 03: the configured `transactionRepository` from `@/server/history`. Its versioned-transaction key resolution and `parentInnerInstructionIndex` stack relationships are relied on as specified.
- Worker 04: `sessionRepository` from `@/server/sessions`.
- There are no live-mode stubs or fallbacks.

## Remaining issues

- I have not tested against real devnet transaction fixtures; all tests use synthetic normalized transactions.
- A claim whose session is not yet terminal, with no Claimed event, produces no row. In practice this cannot happen, because claims require a terminal state.
- A zero-transfer claim reports `"0"`. If a sibling's transfer is misplaced into another subtree, the misplacing action becomes null, but the empty action still shows 0.

## Checkpoint 1 (85a62e8)

- I merged `frontend-v2/integration`, ran `npm ci` in `web` and `packages/client`, and checked the result with vitest and `tsc`.
- `ports.ts` now re-exports the shared types from `@/server/contracts` and the `WalletActivity*` types from `@macropaths/client`; the local copies are gone. The route uses the shared `WalletActivityResponse` schema.
- New `web/test/wallet-history/route.test.ts` covers the route. It replaces the service with a test double. The `test/support/frontend-v2` harness serves client fixtures, so it does not apply to server route tests.
- Amounts still become `null` whenever an instruction's parent cannot be resolved.
- `npx vitest run test/wallet-history test/support`: 4 files, 41 tests passed. That is 36 wallet-history tests and 5 harness tests.
- `npx tsc --noEmit`: two errors remain in my files, both because workers 03 and 04 are not merged yet:
  - `src/server/wallet/activity.ts(69,14)`: TS2307 cannot find `@/server/history`
  - `src/server/wallet/activity.ts(70,14)`: TS2307 cannot find `@/server/sessions`

## Contract amendment 1

- I merged the integration branch.
- When `HistoryTransaction.parentageResolved === false`, every recognized action in that transaction now gets `amount: null`. Its kind and product are kept.
- Unresolved individual parents still produce null, as before.
- New tests check that `false` gives null and that `true` or an absent field attributes normally.
- `vitest test/wallet-history`: 3 files, 38 tests passed.
- `tsc`: still only the two errors for `@/server/history` and `@/server/sessions` in `activity.ts`.
