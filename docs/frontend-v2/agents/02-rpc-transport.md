# Agent 02 — RPC transport and bounded retries

## Outcome

Provide one server-only RPC transport with visible time budgets, one retry owner and reliable rate-limit handling. It must support partial activity pages without multiplying transaction calls across SDK and query retries.

Use the orchestrator's `foundationSHA` and an isolated frontend worktree.

## Read first

- [Delivery instructions](../README.md), [architecture](../api-and-architecture.md), [frozen interfaces](../interfaces.md), [parallel execution](../parallel-execution.md), and [acceptance](../acceptance.md).
- Read `.claude/skills/macropaths-delivery/SKILL.md`, `.claude/skills/macropaths-exact-data/SKILL.md`, and `.claude/skills/macropaths-history/SKILL.md` in the implementation checkout.
- Inspect current `rpc.ts`, `chain.ts`, API error mapping and test doubles. Read applicable root repository/toolchain instructions.

## Exclusive ownership

- `web/src/server/rpc.ts`.
- `web/src/server/transport/**`.
- `web/test/rpc/**`.

Agent 03 owns Redis transaction caching, page snapshots and the implementation of provider transaction admission leases. You consume the frozen admission port. Agent 15 owns dependency manifests, provider composition and lockfiles. Do not change public schemas, queries, session routes or another agent's tests.

## Foundation agreement

Use the RPC reader, context/deadline, admission gate and cache ports specified in `interfaces.md`. Keep compatible exports needed by existing account helpers until the integrator migrates them. Avoid circular imports: the transport depends on an injected admission port, not a concrete history service.

The production composition root supplies Agent 03's Redis-backed admission implementation. Tests supply a deterministic fake. Local fixture reads never require the transport.

## Implementation requirements

1. Mark transport/config modules server-only. Require an explicit server-side `RPC_URL` for nonfixture reads; remove the silent public-devnet fallback.
2. Validate configuration lazily enough that fixture mode and build-time module discovery do not create an RPC connection or require unrelated runtime credentials.
3. Keep `@solana/web3.js` 1.x. Set `disableRetryOnRateLimit: true`; application transport owns retries.
4. Allow at most three attempts total. Retry rate limits, transient transport failures and eligible upstream 5xx responses. Do not retry deterministic invalid requests, bad account data or application 400/404 responses.
5. Use a five-second timeout per attempt and honor the caller's earlier request deadline. Propagate cancellation. A timeout must stop the underlying HTTP request where the transport supports aborting it, not merely abandon a still-running fetch.
6. Capture structured HTTP status and `Retry-After` in the transport layer. Do not rely only on string matching after the SDK has discarded headers. Preserve SDK response validation.
7. Support numeric and HTTP-date `Retry-After` values. Combine them with bounded exponential jitter; never sleep past the remaining request budget.
8. Record method-specific cooldown through the frozen admission gate. Transaction concurrency admission applies to `getTransaction`; account reads must not occupy transaction slots.
9. Acquire/release admission around each attempt. Release in `finally`, including abort and exception paths. A backoff delay must not hold an active transaction lease.
10. Respect at most two active transaction requests globally when the shared gate is healthy and at most two per process in degraded mode.
11. Return typed transport failures that let history code distinguish pending/retryable work from a required whole-request failure. Preserve the public `{ error, code }` API mapping through the existing error layer.
12. Preserve a cause for server diagnostics, but sanitize user-facing messages. Never log provider credentials or complete RPC URLs.

## Timing and observability

The history request budget is twenty seconds. The transport must accept a deadline and decline an attempt that cannot fit within it. Expired budget is not an invitation to continue RPC work after the API response has returned.

Expose lightweight measurements through the foundation's logging/metrics seam: method, attempt count, duration, throttling, timeout and cooldown. Do not add a separate telemetry vendor or endpoint.

Use injectable clock, random jitter, delay and fetch/admission seams so tests run deterministically without real network access.

## Required tests

- Successful call performs one attempt.
- 429 with numeric `Retry-After` waits appropriately within budget.
- HTTP-date header is parsed and bounded.
- Repeated 429 stops after three attempts or earlier deadline exhaustion.
- Nonretryable failure has one attempt.
- Transient network/eligible 5xx failure recovers with bounded retry.
- Five-second timeout aborts the attempt.
- Caller cancellation aborts pending work.
- Admission is released after success, failure and abort.
- Backoff does not occupy an active lease.
- Account reads do not consume transaction admission.
- Concurrent callers do not exceed the local transaction cap when Redis is unavailable.
- Missing live configuration fails explicitly; fixture/build module loading remains possible.
- Public errors and logs do not expose a credential-bearing URL.

## Verification and handoff

Run targeted transport tests and web typecheck through Pixi. Report the transport interface, injection/composition requirements, timing behavior and tests to Agents 03, 04, 05, 06 and 15.

Do not promise that bounded concurrency eliminates all upstream 429s. The required behavior is controlled request volume and correct recovery when throttling still occurs.
