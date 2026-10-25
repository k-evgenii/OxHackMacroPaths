# API and architecture

Use [interfaces](interfaces.md) for exact types and ports and [ownership](launch-manifest.json) for files. This document defines semantics, not an alternative contract.

## Layers

```text
Pages -> TanStack Query -> fetchJson(path, Schema) -> route handlers
                                                   -> services
                                                   -> account/transaction/research repositories
                                                   -> server RPC and shared Redis

Validated responses -> web feature adapters -> presentational @macropaths/ui
```

`packages/client` owns zod response schemas, IDL decoding, PDAs, exact math and formatters. `web` owns server reads, the session registry, queries, wallet connection and feature adapters. `packages/ui` accepts presentation props; it owns no RPC, fetching, wallet state or account decoding.

Expose browser-safe client subpaths for schemas, formatting and pure math while preserving the root export. Do not force the full Anchor decoder into a page importing a formatter.

## Required API behavior

Preserve health, session detail, positions and seller routes. Curate `/api/sessions` through one server-side registry. Add `/api/catalog`, `/api/sessions/[addr]/overview`, `/api/wallet/[owner]`, and `/api/wallet/[owner]/activity`. Preserve raw session events for `/dev`. Artifact responses become schema-validated and reproducible.

Every u64/i64 chain value remains a decimal string. Dates/slots/counts retain the existing number conventions. API errors remain `{ error, code }` with 400 bad_request, 404 not_found, 502 rpc_error and 500 internal. Optional section failures use explicit availability, never a fabricated empty result.

## Session registry and reads

The checked-in `web/config/sessions.json` is the only client session allowlist. It starts with reference session A and declares its expected dataset, terms, layout, replay first period and display label. `/api/catalog` exposes presentation-safe metadata. Do not add a competing environment session list.

Production reads registered accounts directly. An absent registered account is reported rather than silently dropped. Unknown client addresses return 404. A known but unsupported layout or metadata mismatch fails explicitly, logged as internal configuration/data mismatch. The current decoder is v1 only. Developer discovery filters the Session discriminator and v1 `dataSize: 913`; this must not be applied to every future layout.

Overview requires the session account. Independently read current vault balances and seller/quote accounts; a failure in one optional section does not erase the chart. Missing seller/quote accounts are successful `null` reads, different from upstream failure.

Validate account program owner/discriminator and embedded session/owner relations. Vault reads validate standard SPL token ownership, mint and session authority. Vault balances are mutable after settlement and never use immutable transaction-cache TTLs.

Do not advertise independent account reads as one atomic chain snapshot. `fetchedAt` is retrieval time. Per-product oracle or attester claims beyond the historical replay are not introduced.

## Scores and payouts

Calculate accrued scores with existing bigint `score` functions. Running pool illustrations require temporary budgets calculated from those accrued scores, followed by `claimAmount`; unsettled on-chain budgets are not an appropriate projection. Covers use `coverPayout`. Before readings and during Refunding, scores for display are null. Settled uses authoritative recorded scores/payouts. Claimed items contribute zero to unclaimed totals.

The sum of `sideTotals` is total pool deposited. Actual token accounts are current vault holdings. Do not call deposited-minus-payout dust or a vault balance. Do not combine distinct mints or translate PLAY into dollars.

## Wallet overview

Derive the requested owner's position/cover PDA for each registered session and batch those addresses. Do not scan every user's accounts. Validate all relations before returning a holding. Sum all standard SPL token accounts belonging to that owner for each registered PLAY mint. Missing token accounts mean zero after a successful read; an RPC failure means unavailable.

No login signature is needed to read public account data. Wallet context exposes only owner and connection state; account data still comes through the application API.

## Transaction repository and activity

Share one normalized transaction cache across raw events and wallet history. Cache resolved keys, instructions, inner instructions, logs and token-balance/transfer information needed by both consumers. Separate parsed-event caches must not duplicate transaction RPC fetches.

Preserve session addresses carried by program events and stable event indices. Filter session events by actual event session, not merely by the address used to fetch signatures. A single transaction can involve several sessions/actions.

Wallet history recognizes successful pool deposits, cover purchases, pool claims, cover claims and refunds. Deposits and cover claims cannot be recovered from event logs alone. Decode top-level/inner instructions, including versioned account keys. Attribute token transfers to the matching action subtree; use transaction-wide balance changes only for reconciliation. Buyer premium excludes seller funding. Inconclusive attribution returns a null amount. Current terminal Refunding state can classify a successful cover refund because the terminal state does not switch back to Settled.

## Pagination and recovery

Default 10 signatures, maximum 25. `nextBefore` is the last scanned signature; a page with no recognized actions may still have a next page. Return successful items, `pending`, and `retryCursor` rather than failing all hydration on one 429/null transaction.

Persist a frozen signature-page snapshot in Redis for 15 minutes, bound to feed kind and owner/session. Retain its resolved normalized transactions for that lifetime too, so their shorter confirmed-cache TTL cannot erase them. A retry token reopens that exact page and fetches only unresolved signatures, returning the complete recovered page. The original next cursor stays fixed. Tokens cannot be used for a different scope and cannot be combined with normal before/limit parameters. Invalid/expired tokens return 400.

If Redis is unavailable, return successful records with pending signatures and `retryCursor: null`. The UI offers a refresh; never issue a supposedly recoverable token backed only by one serverless instance's memory. Keep pending pages when loading older pages. Deduplicate by stable event/action ID rather than signature alone.

The frontend retries pending pages after roughly 5, 15 and 30 seconds while visible, then stops and offers manual retry. TanStack automatic error retry is disabled for history. A signature-list/session failure remains a whole-route error; partial hydration is not an excuse to hide failure to establish the page.

## RPC and caching

Require explicit server-only RPC configuration outside fixtures. Use three attempts maximum, at most five seconds per underlying attempt and a 20-second history-request budget. Retry rate limits, transient transport failures and retryable upstream errors. Honor Retry-After from the HTTP transport. Use full jitter with 400 ms base and 4 s cap; do not sleep past the request budget. Keep SDK retries disabled.

At most two active getTransaction calls per process. In deployed mode, Redis implements expiring provider-wide leases and a shared cooldown. Acquire per HTTP attempt, release in finally, and make lease expiry exceed the attempt timeout. Bound lease acquisition by the request deadline. Backoff does not hold an active-call slot. Provider throttling can still occur; acceptance asserts bounded load and recovery, not zero 429s.

Use parser-version/cluster/program/signature cache keys. Permanently cache only finalized normalized transactions (90 days is an acceptable storage policy). Confirmed results receive a short TTL until finality is established. Null/unavailable transactions remain pending. Finalized failed transactions can be cached as having no successful activity. Deduplicate concurrent reads and keep Redis outage behavior bounded.

Keep credentials out of returned errors, browser bundles, screenshots and logs. `server-only` marks RPC/cache/services. Query only configured server resources; no browser RPC fallback.

## Research publication

Publish manifest, forecast and planner as one versioned bundle with content hashes, source metadata, units, caps, thresholds, schema version and optional verified session association. Validate every response through shared schemas. Keep continuous model outputs as research floats; lossless scaled integers are strings. Reject unsafe integer normalization.

Remove artifact copying from predev/prebuild. Provide explicit sync plus validation commands; normal builds must not rewrite published data. Bundle imports or explicit build tracing must include the artifacts in serverless deployment; no dependence on a writable working directory.

Reference A's test caps differ from research p90 caps. The inspected Fuel artifact uses 72833, while newer prose mentions 72844. A published bundle uses one internally consistent revision. Forecast/session overlays require a verified matching association; never silently borrow a research quote or score for another term set.

## Client query freshness

Open sessions: 15 s; Running: 5 s; terminal sessions: 60 s while visible. Wallet balance/holdings: 15 s while visible. History: entry/manual refresh plus bounded pending recovery. Research: version-keyed long caching. Stop wallet-dependent requests on disconnect/switch. Stale data stays visible with a warning when a background refresh fails. Health/slot polling is not needed in the client shell.
