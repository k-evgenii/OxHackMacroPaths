# Agent 06 — Wallet instruction and transfer history

## Outcome

Deliver complete successful wallet activity for the supported MacroPaths actions, including deposits and cover claims that do not have matching program events. Every displayed amount must belong to the specific action rather than a duplicated transaction-wide net change.

## Read first

- [Delivery instructions](../README.md), [product decisions](../product-and-content.md), [architecture](../api-and-architecture.md), [frozen interfaces](../interfaces.md), [parallel execution](../parallel-execution.md), and [acceptance](../acceptance.md).
- Read `.claude/skills/macropaths-delivery/SKILL.md`, `.claude/skills/macropaths-exact-data/SKILL.md`, and `.claude/skills/macropaths-history/SKILL.md`.
- Inspect the current IDL, deposit/buy-cover/claim/claim-cover handlers, emitted events and raw transaction fixtures. Follow root instructions.

## Exclusive ownership

- `web/src/server/wallet/activity.ts`.
- `web/src/server/wallet/decode/**`.
- `web/src/app/api/wallet/[owner]/activity/route.ts`.
- `web/test/wallet-history/**`.

Agent 03 owns signature pagination, transaction retrieval, shared caching and retry snapshots. Agent 01 owns the shared event decoder and schemas. Agent 04 supplies session/account validation. Agent 10 owns queries. Do not modify any of those implementations or package manifests.

## Frozen dependencies

Use the normalized transaction representation and pagination API published in `interfaces.md`. Build and test instruction attribution using foundation fixtures immediately; integrate Agent 03's concrete repository later without changing its signature.

Use the existing Anchor IDL and supported web3.js stack. No changes to program events, program layout or keeper are part of this release.

## Supported actions

Recognize successful actions addressed to the requested wallet:

- `deposit` → `PoolDeposit`.
- `buy_cover` → `CoverBought`.
- `claim` → `PoolPayout` or `Refund`.
- `claim_cover` → `CoverPayout` or `Refund`.

Resolve instruction account roles from the IDL. Validate the actual program ID, registered session and action owner; a wallet merely appearing somewhere in the transaction is insufficient.

## Decoding and attribution

1. Resolve complete account keys, including loaded lookup-table addresses in versioned transactions.
2. Decode top-level MacroPaths instructions and relevant inner MacroPaths instructions.
3. Preserve each action's top-level instruction index and nullable inner-instruction index. Generate stable IDs from signature and instruction location, not list rank or amount.
4. Link SPL token transfers to the corresponding action's invocation subtree. Use available stack-height/log evidence; do not assign a sibling action's transfers to it.
5. For pool deposits, reconcile the decoded side amounts with owner-to-vault transfers.
6. For cover purchases, show only buyer-paid premium. Exclude seller collateral funding, total units and unrelated token changes.
7. For claims, sum the relevant vault-to-owner transfers and reconcile emitted amounts where available.
8. Determine refunds from authoritative event data or the validated terminal Refunding state of the relevant session. Do not classify an ambiguous payout from a guessed amount pattern.
9. Use transaction-wide owner/mint pre/post token balances as a reconciliation check only. Do not repeat that net delta in every action row.
10. Treat newly created and closed token accounts correctly when only one side of balance metadata exists. Keep SOL fees and rent out of PLAY amounts.

If the action is recognized but attribution cannot be established, return the approved `amount: null` representation. Do not invent a zero or merge ambiguous actions. If nested ownership cannot be proven, document the supported case and leave the amount unavailable.

Keep signed PLAY base-unit strings. Product may be nullable for multi-product deposits/claims. Retain slot and actual block time; a null block time must not be replaced by the current date or CPI observation month.

## Pagination

Use the shared owner-scoped signature source, ten-signature default, twenty-five maximum, twenty-second budget and partial-page metadata. Do not refetch transactions through a private RPC connection.

`nextBefore` follows scanned signatures even when none yields a supported successful action. Preserve pending signatures and retry cursors supplied by Agent 03. A failed transaction produces no successful action rows.

Stable retries return complete recovered pages. Deduplicate by action ID, not signature, because one transaction may contain several valid activities. Redis-unavailable pages may have pending signatures with no retry cursor; the UI must receive that truth.

## Required tests

- Pool deposit appears without a Deposit event.
- Cover claim appears without a CoverClaimed event.
- Cover purchase displays buyer premium rather than units or seller contribution.
- Pool claim and cover claim reconcile transfers correctly.
- Refunding classification uses event or terminal session evidence.
- Two actions in one signature produce distinct IDs and correctly attributed amounts.
- Two sessions in one signature cannot cross-attribute transfers.
- Top-level, inner and versioned instruction cases decode correctly.
- Unrelated program actions, wrong owners and unregistered sessions do not become personal activity.
- Failed transactions produce no successful rows.
- New/closed token accounts and unrelated SOL rent changes do not corrupt PLAY amounts.
- Ambiguous transfer attribution yields `amount: null`.
- Unknown timestamps remain null.
- Empty decoded page can still paginate; retry preserves stable action identity.

## Verification and handoff

Run targeted wallet-history tests and web typecheck via Pixi. Provide supported action/transaction cases, unavailable-amount examples, attribution invariants and test evidence to the Activity worker and Agent 15. Report any decoder gap plainly instead of claiming all historical transaction forms are covered.
