---
name: macropaths-history
description: Implement or review MacroPaths transaction hydration, partial-page recovery, event attribution and per-wallet action history under Solana RPC limits. Use for history repositories, endpoints and activity-query integration.
---

# MacroPaths history

Read [interfaces](../../../docs/frontend-v2/interfaces.md) and [history architecture](../../../docs/frontend-v2/api-and-architecture.md). Worker 03 owns the shared transaction repository; worker 06 consumes it for wallet attribution. Do not duplicate expensive transaction fetches.

## Recoverable pages

- Scan ten signatures by default, maximum twenty-five. nextBefore depends on the scanned signature page, not the number of recognized events.
- Return successful records plus pending signatures for transaction failures/null results. Failure to establish the session/signature page remains a route error.
- Retry cursor identifies a frozen Redis-backed page, bound to feed and scope for fifteen minutes. Retain resolved normalized transactions in that snapshot for its lifetime. Retry only unresolved signatures and replace the complete original page.
- No Redis means no supposedly cross-instance retry cursor. Return pending plus retryCursor:null and let the client refresh.
- Multiple events/actions share a signature: deduplicate by event index or instruction identity, never signature alone.
- Client automatic query error retries are disabled. Pending retries are bounded at roughly 5/15/30 seconds while visible, followed by manual retry.

## Cache and load

Normalize transactions once with resolved versioned keys, instructions, logs and token information. Cache key includes cluster, program and parser version. Finalized results can be immutable; confirmed results need a short TTL/finality policy. Missing transactions are pending. Failed finalized transactions can be cached as having no successful activity.

Transport owns HTTP timeout/Retry-After capture and bounded retry. History supplies injected Redis admission/cooldown, with at most two active transaction calls and no held lease during backoff. Release in finally, bound acquisition by the request deadline, and preserve partial results when the deadline expires. Throttling can still occur; test recovery, not a promise of zero 429s.

## Attribution

Preserve the session field present in program events. Filter by actual session identity. Deposits and cover claims do not have matching events in the inspected program, so wallet history must decode instructions.

Decode top-level/CPI actions and associate transfers with their instruction subtree. A transaction-wide token delta is a reconciliation check, not an amount to repeat on every row. Buyer purchase history reports buyer premium, excluding seller funding. Claims report attributed payout/refund. Unknown attribution stays amount:null. Multiple products within one action are aggregated into one item with product:null.

Market observations are a different feed derived from SessionView.path; don't hydrate transactions just to display the historical reading months or invent posting times from a signature list.

## Prove behavior

Test partial/all hydration failure, Retry-After/deadlines, cache/finality, new signatures during old-page retry, token expiry/scope mismatch, multi-session events, multiple actions, inner/versioned instructions and unknown amounts. Use fake time/transport for backoff. Keep credentials out of logs and test output.
