# Agent 01 — Contracts and exact data models

## Outcome

Deliver the single typed contract used by the read API, fixtures, presentation adapters and tests. Preserve lossless chain accounting and make it impossible for pages to confuse pool deposits, cover premiums, scores and payouts.

Start from the orchestrator's `foundationSHA` on a branch based on the verified `evgenii/frontend` head. The documentation may be staged in another worktree; that worktree is not your application-code baseline.

## Read first

- [Delivery instructions](../README.md), [product decisions](../product-and-content.md), [architecture](../api-and-architecture.md), [frozen interfaces](../interfaces.md), [parallel execution](../parallel-execution.md), and [acceptance](../acceptance.md).
- Read `.claude/skills/macropaths-delivery/SKILL.md` and `.claude/skills/macropaths-exact-data/SKILL.md` in the implementation checkout.
- Read root `AGENTS.md`, the relevant program specification, the existing client math, account layouts, real fixtures and vector tests.

## Exclusive ownership

- `packages/client/src/**`.
- `packages/client/fixtures/**`.
- `packages/client/test/**`.

Agent 15 owns all package manifests and lockfiles, including package export configuration. Request changes from that agent. Do not edit web queries, routes, UI components, research Python, keeper code, IDL or program code.

## Foundation dependencies

The orchestrator supplies complete initial public schemas, internal interface declarations and synthetic fixture exports before the simultaneous launch. Treat their signatures as frozen. Your assignment completes and verifies those contracts; it does not grant unilateral permission to change another worker's assumptions.

If a discrepancy requires an interface change, provide the exact proposed change and impacted consumers to the orchestrator. Continue independent work while it is resolved.

## Implementation requirements

1. Keep API zod schemas in `packages/client/src/types.ts`, including catalog, session overview, wallet overview, wallet activity, pagination metadata and normalized research response schemas.
2. Keep every chain `u64`/`i64`, amount, score, price, threshold and cap as a decimal integer string. Structural indices and Unix timestamps follow the existing interface definitions.
3. Preserve compatibility of existing response fields. Add approved metadata deliberately and update fixtures and consumers in the same coordinated contract change.
4. Extend decoded event identity with `session` and `eventIndex`. The index is deterministic within the parsed MacroPaths events of one signature. Preserve the session carried in emitted data; do not infer it from a request URL.
5. Retain strict distinction between a missing account and a failed read. Follow the frozen discriminated availability types; do not turn failures into empty holdings or zero balances.
6. Add shared pure helpers for accrued scores, illustrative pool payouts, illustrative cover payouts and claimable totals. Reuse `score`, `budgets`, `claimAmount` and `coverPayout`.
7. For Running pool positions, calculate temporary budgets from accrued scores and recorded side totals. Never use the still-unsettled stored P/R budgets as an illustration.
8. Before observations, return the approved not-determined representation. For Settled use final payout fields. For Refunding use deposits or premiums. Claimed holdings contribute zero to available-to-claim totals.
9. Keep cover units, paid premium and payout separate. Keep pool contributions separate from actual token-account balances. Do not label `deposited - payout` as protocol dust.
10. Provide bigint/string formatters for percentage-point differences and plain-language point-months. Existing public formatter signatures must remain usable. Coordinate new exports with Agent 15.
11. Keep browser-safe schemas, formatters and math importable without loading account decoders or RPC clients. Agent 15 wires package subpath exports; you provide the corresponding modules.
12. Keep bounded conversion to `number` at explicit chart-coordinate boundaries only. Never feed a display conversion back into accounting.

## Fixtures

Preserve the real reference session A fixtures and raw-account evidence. Add clearly labelled synthetic fixtures instead of replacing those files with invented scenarios.

Required scenarios include:

- Open with no observations and no owner accounts.
- Running with accrued statistics but unset final budgets.
- Settled with unclaimed pool and cover holdings.
- Settled with claimed holdings.
- Refunding.
- Missing seller and quote.
- Unavailable optional reads.
- Two sessions in one transaction.
- Partial and fully throttled activity pages.
- Two distinct PLAY mints and a nonfixture wallet owner.
- Matching and mismatching research terms.

Reference session A has threshold `40000`, caps `80000` / `800000`, scores `827387` / `863980`, and 380 PLAY of historical pool contributions. Research p90 caps must never replace those terms.

## Acceptance

- Existing exact-math vectors and raw-account decoding still agree.
- Every new public fixture passes its schema.
- Running illustrations are calculated from current statistics, not stored zero scores/budgets.
- Claimed and Refunding scenarios have correct available amounts.
- Large integers remain exact beyond JavaScript's safe-integer range.
- Formatting distinguishes percent, percentage points, point-months and PLAY.
- Two-session logs retain session attribution and stable event identities.
- Browser-safe entry modules have no dependency on server services.

Run `pixi run npm test` and `pixi run npm run typecheck` from `packages/client`, plus the targeted contract checks provided by the foundation. Follow required root baseline checks. Do not rerun unrelated expensive checks without a relevant change.

## Handoff

Report the branch, commit SHA when the execution workflow permits commits, exact exported interfaces, fixture scenarios, verification commands/results and unresolved decisions. List requested package/export changes separately for Agent 15.

Your ownership ends at typed data and exact math. UI interpretation, research publication and endpoint orchestration remain with their assigned agents.
