# Agent 03 — Transaction history, cache and partial event pages

## Outcome

Deliver the shared transaction repository used by raw session events and personal wallet history. A throttled transaction must not erase successfully loaded activity or make pagination skip unresolved signatures.

## Read first

- [Delivery instructions](../README.md), [architecture](../api-and-architecture.md), [frozen interfaces](../interfaces.md), [parallel execution](../parallel-execution.md), and [acceptance](../acceptance.md).
- Read `.claude/skills/macropaths-delivery/SKILL.md` and `.claude/skills/macropaths-history/SKILL.md` in the implementation checkout.
- Inspect current session events loading, route validation, raw transaction fixtures, and the shared API error layer.

## Exclusive ownership

- `web/src/server/history/**`.
- `web/src/app/api/sessions/[addr]/events/route.ts`.
- `web/test/history/**`.

Agent 01 owns shared event decoding and schemas. Agent 02 owns RPC transport. Agent 04 owns `chain.ts` account functions; request removal/re-export of legacy event functions through the orchestrator. Agent 06 owns wallet-action decoding. Agent 15 owns dependencies and global composition.

## Frozen dependencies

Implement the transaction repository, cache, page snapshot and provider admission ports declared by the foundation. Work against fake transport and schema-valid fixtures until Agent 02 lands. Publish the repository contract early to Agent 06.

Avoid an import cycle between transport and history. Supply the provider admission implementation through the foundation's injection/composition boundary.

## Repository and cache

1. Cache a normalized transaction representation containing resolved account keys, top-level and inner instructions, logs, token balances, success status, slot, timestamp and finality. Parsed events alone are insufficient for wallet-history consumers.
2. Include cluster, program ID, representation/parser version and signature in cache identities. JSON values must preserve exact base-unit strings.
3. Permanently cache finalized transactions or retain them at least ninety days. Confirmed transactions receive a short TTL and are promoted only after finality is verified.
4. A missing/null transaction is pending. A finalized failed transaction is a known successful repository read with no successful activity. Do not confuse either with a successfully parsed transaction containing no relevant actions.
5. Deduplicate concurrent loads for the same signature within the process and use the shared cache across server instances.
6. Implement in-memory and Redis adapters behind the same port. Fixture mode requires no Redis. Nonfixture production configuration is validated by the integrator.
7. Implement Redis-backed transaction admission: at most two active calls, expiring owner-token leases, safe release, and provider/method cooldown. Maintain local two-call admission if Redis is temporarily unavailable. Do not delete another request's lease.

## Pagination and recovery

- Default page size is ten scanned signatures; maximum is twenty-five.
- Validate `before`, `limit` and retry parameters according to the frozen route schema.
- `nextBefore` is based on the last signature scanned, never the last decoded event.
- Keep upstream signature order and stable within-transaction event order.
- Load with bounded settled-result collection. One hydration failure cannot reject the whole page.
- Return successful events plus every unresolved signature in `pending`.
- Preserve `session` and `eventIndex`; filter events to the requested session.

For a partial page, store its exact signature list, scope, feed kind and original `nextBefore` under an opaque random `retryCursor` for fifteen minutes. Bind it to the route's session or wallet owner. Retry reads the same list and loads only unresolved transactions; return the complete recovered page.

Do not re-enumerate a moving first page during retry. Do not let a retry cursor authorize unrelated arbitrary transaction loads. Reject expired, foreign-scope or incompatible query combinations with the existing 400 error shape.

If Redis is unavailable, return successful items and pending signatures with `retryCursor: null`. Do not advertise recovery via an instance-local cursor that another serverless invocation cannot find. The UI will offer manual refresh.

Stop scheduling before the twenty-second request budget is exhausted. Cancel outstanding reads when returning; every unsatisfied signature remains pending. Failure of the required session read or signature enumeration remains a whole-request error.

## Session event route

Keep this route as typed raw session history for developer tooling. Client Market activity is built from `SessionView.path` elsewhere and must not call this transaction-heavy route to recover the 48 monthly observations.

Use Agent 04's session repository for account validation. Preserve the current API error body. A fully throttled hydration page returns 200 with no events and nonempty pending; failure to enumerate signatures returns 502.

## Required tests

- One failed transaction returns other events plus pending.
- Fully throttled hydration is a partial 200.
- Required signature-list failure returns 502.
- Null transaction remains pending rather than being cached as empty.
- Stable retry recovers the original page after new head signatures arrive.
- Loading older pages does not discard pending earlier pages.
- Foreign/expired cursors and invalid query combinations return 400.
- Page with no relevant events can still have `nextBefore`.
- Multi-session transaction is filtered accurately.
- Two events in one signature retain distinct stable IDs.
- Finalized cache hits avoid RPC; confirmed reads do not get permanent caching.
- Local deduplication and Redis lease release are correct under failure/cancellation.
- Redis outage returns no unusable retry cursor.
- Budget exhaustion returns unresolved signatures and stops work.

## Handoff

Provide repository imports, cache-key/version rules, admission injection requirements, retry-cursor behavior, metrics and tests. Coordinate Agent 06's consumer integration without editing its wallet decoder. Run targeted history tests and web typecheck through Pixi.
