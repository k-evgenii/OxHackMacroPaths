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

## Checkpoint 1 (merged frontend-v2/integration 85a62e8)
- Port types now re-exported from shared `web/src/server/contracts.ts` (no local copies).
- `npx vitest run test/rpc`: 19/19 pass. `tsc --noEmit`: no errors in owned files; remaining errors are in other owners' tests (implicit any in test/api, artifacts, charts, contract, planner, ui; `resilience.test.ts` references the removed `RPC_URL` export).
- `test/api/*` fail at collection on the integration base (`@anchor-lang/core` mock: "Cannot find module './nodewallet'"), independent of this transport; even with `RPC_URL` set they do not load. Owner: coordinator/15.

## Checkpoint 2 (merged frontend-v2/integration f1ff519)
- Added `web/test/rpc/setup-env.ts` (sets placeholder `RPC_URL=https://example.invalid/rpc` if unset). Requires worker 15 to apply this patch to `web/vitest.config.ts`:
  ```diff
  -  test: { include: [...], environment: "node" },
  +  test: { include: [...], environment: "node", setupFiles: ["./test/rpc/setup-env.ts"] },
  ```
- `test/rpc`: 19/19 pass.
- `test/api/*` (all 4 files) with RPC_URL set: they still fail at **collection**, before any test or transport code runs, with `Cannot find module './nodewallet'` raised by the `@anchor-lang/core` resolution inside the `vi.mock` factories. This is **pre-existing / unrelated to removing RPC_URL**. No test/api failure is currently attributable to the transport, because none of them load.
- Edits that will be needed once test/api loads (owners of those tests):
  1. `test/api/resilience.test.ts` `describe("RPC_URL")` (lines ~122-142): delete the "falls back to public devnet" case; replace the "uses RPC_URL when set" case with `import("@/server/transport").then(m => m.readRpcConfig({RPC_URL:"https://example.invalid/rpc"}).url)`, or assert that `rpc()` without RPC_URL rejects with `{kind:"config"}`.
  2. Assertions on `1 + retryConfig.attempts` calls remain valid (attempts is now 3).
  3. Their 429 fakes throw `Error("429 Too Many Requests")` and are still classified as rate-limited via the message fallback. `retryConfig.baseMs = 1` still shortens backoff.
