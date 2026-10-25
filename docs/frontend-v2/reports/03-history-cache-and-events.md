# Worker 03 handoff

## Identity

- Worker ID and assignment: 03 — history-cache-and-events
- Foundation SHA: 6d2865bf526f0bf980293d9cdcfec547acbfd9f8. The foundation checkpoint is not merged yet.
- Branch: frontend-v2/03-history-cache-and-events
- Status: PARTIAL. Implementation and unit tests are done. Route and index typecheck is blocked until the checkpoint lands.

## Delivered

Owned files under `web/src/server/history/`:

- `types.ts`: the ports from interfaces.md, copied word for word, plus an internal `LeaseStore` type (`shared`, `tryLease`, `releaseLease`). At the checkpoint these become re-exports of `@/server/contracts`.
- `normalize.ts`: turns a legacy or v0 `getTransaction` response into a JSON-serializable `HistoryTransaction`.
  - Account keys are resolved in order: static keys, loaded writable, then loaded readonly.
  - Top-level and inner instructions keep their original indices.
  - Inner-instruction parentage comes from `stackHeight`.
  - Pre/post token balances are merged and kept as exact base-unit strings.
  - `NORMALIZER_VERSION = 1`.
- `store.ts`:
  - `MemoryCacheStore` is for tests and local runs only (`shared=false`, so it never backs a retry cursor).
  - `RedisCacheStore` works over a minimal `RedisCommands` adapter (`get`, `set(key, value, {px, nx})`, `delIfEquals`). `DEL_IF_EQUALS_LUA` is included for implementing `delIfEquals`.
- `admission.ts`: `createHistoryAdmission(store, opts?)` limits `getTransaction` calls.
  - At most 2 active calls per process.
  - With Redis, also at most 2 provider-wide owner-token leases with an 8 s TTL.
  - Release deletes only the caller's own lease, using compare-and-delete.
  - Cooldowns from `noteRateLimit` are kept both locally and in the shared store.
  - It never sleeps past `deadlineAt`; it throws `AdmissionTimeout` instead.
  - If Redis fails, it falls back to local admission.
- `repository.ts`: `createTransactionRepository(reader, store, opts?)`.
  - **Cache:**
    - Cache key is `history:tx:v1:{cluster}:{program}:{signature}`.
    - Finality comes from `confirmationStatus` in `getSignaturesForAddress`. Finalized transactions are kept 90 days, confirmed ones 30 s.
    - A null transaction (or null `meta`) stays pending and is never cached.
    - A failed transaction is cached with `failed:true`.
    - Concurrent loads of the same signature are deduplicated within the process.
  - **Pages:**
    - Pages default to 10 signatures, maximum 25. `nextBefore` is the last scanned signature.
    - Hydration has a 20 s budget. When it returns, outstanding reads are aborted and every unresolved signature goes into `pending`.
    - A failure to enumerate signatures fails the whole request.
  - **Retry cursors:**
    - Each partial page gets a 15-minute snapshot bound to kind and scope, which keeps already-resolved transactions.
    - A retry loads only the unresolved signatures and returns the full original page with its original `nextBefore`, without re-enumerating.
    - Bad, expired or foreign-scope cursors return 400.
    - A store that is not shared, or a failed snapshot write, gives `retryCursor: null`.
  - **Metrics:** reported through the `onMetric` hook.
- `events.ts`: `eventsForSession` and `getSessionEventsPage`. `eventIndex` counts every parsed event in log order, before filtering to the session. Event IDs are `signature:eventIndex`.
- `query.ts`: `parseHistoryQuery` validates query parameters for both the events and wallet activity routes.
- `index.ts`: the `@/server/history` entrypoint. It exports a lazily configured `transactionRepository` and `configureHistoryRedis(adapter)`.

Other owned files:

- `web/src/app/api/sessions/[addr]/events/route.ts` now uses the history repository and Agent 04's `sessionRepository`.
- Tests: `web/test/history/{helpers.ts,repository.test.ts,admission.test.ts}`.

## Evidence

- `npx vitest run test/history`, run in WSL with Node 20 from `fe2/integration/.pixi/envs/default/bin`: **33/33 passed**. The tests cover:
  - partial and fully throttled pages
  - signature-list failure
  - null transactions and failed transactions
  - retry after new head signatures arrive
  - snapshot retention after the confirmed cache TTL expires
  - older pages loaded while an earlier page is still pending
  - foreign-scope, unknown and expired cursors
  - Redis down or not shared
  - finalized versus confirmed caching
  - concurrent-load deduplication
  - normalized shape with v0 keys, inner instructions and u64 strings
  - budget exhaustion and cancellation
  - multi-session filtering and stable event IDs
  - admission limit, lease ownership, Redis fallback, cooldown and deadline
  - query validation
- `npx tsc --noEmit`, filtered to owned files. Two errors remain, both expected until the checkpoint:
  - `@/server/sessions` is missing (Agent 04).
  - `createRpcReader` is missing from `@/server/rpc` (Agent 02).
- Not run yet: route-level tests against the real Agent 01 `EventsResponse` schema.

## Integration dependencies

- **Agent 01:** `EventsResponse` and `EventView` need `session`, `eventIndex`, `pending` and `retryCursor`. Until then, the route's `okJson` validation will strip or reject these fields.
- **Agent 02:** provide `createRpcReader(admission)`. The reader must call `acquire` for each HTTP attempt, release in finally, and call `noteRateLimit(method, retryAfterMs)` on a 429.
- **Agent 04:** provide `sessionRepository`. The legacy `getSessionEvents`, `clearTxCache` and `logsForSession` in `chain.ts` can be removed once this route merges.
- **Agent 06:** use `transactionRepository.page({kind:'wallet', address}, request, ctx)` and `parseHistoryQuery` from `@/server/history`.
- **Agent 15:** call `configureHistoryRedis(adapter)` with the locked Redis client. Its `delIfEquals` must be atomic. Without this call, retry cursors are always null; this degraded mode is honest, because no cursor is issued that another instance cannot find.
- **Not owned:** `web/test/api/events-session.test.ts` targets the old route and the old 1..100 limit. Its owner needs to update or retire it.
- Production code contains no stubs.

## Remaining issues

- Typecheck is blocked until the checkpoint lands (see above).
- When `stackHeight` is missing, `parentInnerInstructionIndex: null` looks the same as "direct child of the top-level instruction". The frozen type has no way to say "parent unknown".
