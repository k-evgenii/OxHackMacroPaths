# Agent 05 — Wallet balances and owned holdings

## Outcome

Deliver truthful public wallet reads: exact PLAY balances per mint, owned covers, owned pool positions and explicit unavailable sections. Wallet connection must never make another wallet's fixture holdings appear personal.

## Read first

- [Delivery instructions](../README.md), [product decisions](../product-and-content.md), [architecture](../api-and-architecture.md), [frozen interfaces](../interfaces.md), [parallel execution](../parallel-execution.md), and [acceptance](../acceptance.md).
- Read `.claude/skills/macropaths-delivery/SKILL.md` and `.claude/skills/macropaths-exact-data/SKILL.md` in the implementation checkout.
- Inspect client PDA helpers, Position/Cover layouts, view converters and registered session fixtures. Follow root repository instructions.

## Exclusive ownership

- `web/src/server/wallet/overview.ts`.
- `web/src/app/api/wallet/[owner]/route.ts`.
- `web/test/wallet-read/**`.

Agent 04 owns account/session repositories; Agent 01 owns schemas, decoding and payout math; Agent 06 owns wallet history; Agent 10 owns browser query hooks. Request dependencies from Agent 15 rather than editing manifests.

## Foundation agreement

Use the frozen wallet response schema, session/account repository and exact holding-summary helpers. Start against supplied fakes and fixtures; integrate concrete repositories through their agreed imports later.

The endpoint reads public data from an address. It does not create authentication, request a signature, submit a transaction, create token accounts or fund the wallet.

## Read algorithm

1. Validate the route owner using the shared pubkey parser. Reject malformed input with the existing 400 error contract.
2. Obtain only registered sessions from Agent 04's repository.
3. Derive exactly the wallet's Position and Cover PDA for each session.
4. Read them in bounded batches through the shared repository. Preserve per-session failure information where partial response is allowed.
5. Before decoding, validate program owner and account discriminator. After decoding, validate embedded session and owner against the requested values and derived PDA.
6. Convert valid accounts with shared client view helpers using the corresponding validated session.
7. Determine the registered PLAY mints. Read standard SPL token accounts owned by the wallet for each mint and sum all base-unit amounts with bigint.
8. Return separate balances per mint, holdings per session and retrieval/availability metadata defined by the contract.

Do not scan all program participants or call the session positions endpoint to filter everyone in the browser. Do not fetch every transaction merely to discover current holdings.

## Data semantics

- Missing Position or Cover accounts are successful null holdings.
- Failed reads are unavailable; they must not look like no position.
- An absent token account yields a zero available balance only after a successful balance read.
- A balance read error yields unavailable, not zero.
- Distinct PLAY mints remain distinct entries, even if their symbols and decimals match.
- Sum every applicable token account, not only an associated token account.
- Preserve base-unit decimal strings. Never format then parse amounts.
- Claimed holdings retain historical paid/deposited/payout fields but contribute zero to available-to-claim totals.
- Follow the exact shared state-specific calculation helper for final payouts, refunds and Running illustrations.
- Covers are the primary client mechanism. Pool holdings remain a separate representation.

The service returns data; visual ordering and wallet-switch query behavior belong to frontend workers. Do not add client labels, colors or arbitrary formatted currency strings to the accounting response.

## Partial failures and caching

Use the approved section availability representation. A required session registry/configuration failure remains an endpoint error; do not silently remove configured sessions.

A per-mint or per-holding read may be unavailable without erasing the successfully read sections. Do not mask account-integrity mismatches as absent accounts; follow the frozen error/availability policy and report diagnostics without secrets.

Keep cache keys scoped by cluster, owner, mint and session as appropriate. Do not cache current balances indefinitely or reuse another owner's response. Respect the shared mutable read TTLs.

Do not implement a second cache library or RPC connection. Use Agent 02/04 ports. Fixture mode must return the same contract without RPC or Redis.

## Required tests

- Malformed owner returns typed 400.
- Wallet with no token accounts/holdings returns a successful empty/zero state.
- Direct PDA reads avoid `getProgramAccounts` participant scans.
- Foreign program, wrong discriminator, wrong embedded owner and wrong embedded session are rejected.
- One session's failed read does not invent a null holding.
- Two standard token accounts of the same mint sum exactly.
- Large balances beyond safe-integer range remain exact.
- Two distinct mints do not aggregate into one total.
- Failed balance read is unavailable rather than zero.
- Claimed positions/covers do not contribute to available amounts.
- Settled, Running and Refunding view behavior follows shared math.
- Requesting a nonfixture owner does not receive the fixture owner's holdings.
- Cache scope does not leak one owner's response into another's.

## Verification and handoff

Run targeted wallet-read tests and web typecheck via Pixi. Supply response examples for available, empty and partial states to Agent 10 and the Dashboard/Session workers. Report endpoint usage, assumptions, tests and handoff SHA when commits are enabled.

No write-enabled wallet behavior belongs in this task.
