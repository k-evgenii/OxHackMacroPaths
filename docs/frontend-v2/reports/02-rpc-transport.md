# Report — Agent 02 RPC transport

## Changed files (owned only)
- `web/src/server/rpc.ts` — compatibility entrypoint: `rpc`, `cached`, `mapLimit`, `clearCache`, `STALE_MAX_MS`, re-exports `RpcFailure`, `RpcConfigError`, `createRpcReader`, `configureDefaultReader`, `createLocalAdmission`, `withDegradedFallback`, `retryConfig`, budgets, port types.
- `web/src/server/transport/{index,types,errors,config,retry-after,admission,reader,server-only}.ts`
- `web/test/rpc/transport.test.ts`

## Interface
- `createRpcReader(admission: RpcAdmission, deps?: ReaderDeps): RpcReader` (frozen signature; `deps` optional seams: `connect`, `fetch`, `env`, `now`, `random`, `sleep`, `onMetric`, `onDegraded`, `localAdmission`).
- `RpcFailure` now carries `kind` (`rate_limited|timeout|deadline|aborted|transient|upstream|config|unknown`), `status`, `retryAfterMs`, `attempts`, getter `retryable`. Message is URL/token-redacted; original kept in `cause`.
- `configureDefaultReader({ admission, onMetric })` — composition hook for Agent 15 to inject Agent 03's `createHistoryAdmission(store)` and a metrics sink into the process-wide reader used by `rpc()`.
- Ports `RpcContext/RpcAdmission/RpcReader` are declared in `transport/types.ts` matching interfaces.md; once foundation contracts land, re-point to them if they export these types.

## Behaviour
- Lazy config: `RPC_URL` read on first live read; missing/invalid → `RpcConfigError` (kind `config`, not retryable). Public-devnet fallback removed. Module import opens no connection.
- One `Connection` per reader, `disableRetryOnRateLimit: true`, custom `fetch` wrapper (AsyncLocalStorage per attempt) that propagates the attempt AbortSignal to the HTTP request and captures status + `Retry-After` before the SDK discards them. SDK response validation unchanged.
- Max 3 attempts; 5 s per attempt (`min(5s, deadline-now)`); full jitter 400 ms base / 4 s cap, floored by Retry-After (numeric or HTTP-date); never sleeps past `deadlineAt` (gives up with the last typed failure instead). Retries 429, network errors, 500/502/503/504, timeouts; not 4xx/JSON-RPC/data errors. Caller abort → `aborted`, no retry.
- Admission: only `getTransaction` acquires (account reads never do); acquire per attempt, release in `finally`; no lease held during backoff. Shared gate failure → per-process local gate (cap 2) via `withDegradedFallback`. 429 cooldown recorded via `noteRateLimit` (local + shared).
- Metrics per read: method, attempts, durationMs, outcome, throttled, timedOut, cooldownMs, failureKind.

## Tests
`web/test/rpc/transport.test.ts` covers every required case in the brief (see report message for run result).

## Integration requirements / known impacts (for 15 / coordinator)
1. Existing `web/test/api/*` tests (not mine) don't set `RPC_URL`; with the fallback removed they will get `rpc_error` config failures. Fix: set `RPC_URL=https://example.invalid/rpc` in a vitest setup/env (owner: 15/coordinator). `test/api/resilience.test.ts` "RPC_URL" block asserts the removed devnet fallback and exported `RPC_URL` constant — must be updated/removed.
2. `retryConfig.attempts` is now 3 (was 4); tests reading it stay consistent.
3. `server-only` npm package is not a dependency; a runtime `window` guard is used instead. Agent 15 may add `import "server-only"` after adding the dep.
4. `errors.ts` `rpcMessage` still string-matches; consider mapping by `RpcFailure.kind` (owner of errors.ts).
5. Production: call `configureDefaultReader({ admission: createHistoryAdmission(store) })` at composition, and history should use `createRpcReader(admission)` passing `deadlineAt = start + HISTORY_BUDGET_MS`.
