# Agent 04 — Session registry and client read API

## Outcome

Deliver curated, validated session reads and a client overview that distinguishes historical contributions from current vault balances, incomplete replay from failed verification, and unavailable sellers from absent sellers.

## Read first

- [Delivery instructions](../README.md), [product decisions](../product-and-content.md), [architecture](../api-and-architecture.md), [frozen interfaces](../interfaces.md), [parallel execution](../parallel-execution.md), and [acceptance](../acceptance.md).
- Read `.claude/skills/macropaths-delivery/SKILL.md` and `.claude/skills/macropaths-exact-data/SKILL.md`.
- Inspect v1 session/token account layout, `view.ts`, PDA helpers, existing account routes and API error mapping. Follow root repository instructions.

## Exclusive ownership

- Account-read functions in `web/src/server/chain.ts`.
- `web/src/server/sessions/**` and `web/config/sessions.json`.
- Catalog route; session list, detail, overview, positions and seller routes; health route.
- `web/test/sessions/**`.

The session events route belongs to Agent 03. Coordinate extraction/re-export of its legacy `chain.ts` event helpers through the orchestrator. Agent 01 owns shared schemas/decoders. Agent 15 owns manifests, global config and root composition.

## Foundation agreement

Use the session repository and public catalog/overview schemas from `interfaces.md`. Account access must remain importable by wallet services without importing route handlers. Start against the frozen fake transport until Agent 02 is ready.

## Registry and discovery

1. Make the checked-in server session registry the single client allowlist. Initially configure reference session A.
2. Registry metadata includes address, human-readable label, replay mode, first period, expected observations, program/layout version, expected dataset/terms and optional verified research association.
3. Validate configured entries and actual decoded accounts. Do not silently omit a registered session on decode, metadata mismatch or RPC failure.
4. Fetch registered sessions directly by address. Keep broad discovery only for developer use, with discriminator plus v1 `dataSize: 913` filtering.
5. Do not apply 913-byte filtering to a future layout or infer v2 support from a research document. Unsupported layouts must fail explicitly.
6. Preserve raw typed detail/positions/seller endpoints for compatibility and developer tooling. Restrict client-address requests to registered sessions according to the frozen contract.
7. Build `/api/catalog` from validated configuration without requiring transaction history or a live RPC call.

## Session overview

Implement the approved `/api/sessions/[addr]/overview` response with required session data and independently available vault/cover-offer sections.

- Required account or registry failures return the existing typed route error.
- `poolDeposited` is the bigint sum of `sideTotals`; it is historical pool contributions, not current locked funds.
- Vault amounts come from both current token accounts. Validate token-program ownership, PLAY mint and session authority before using balances.
- Keep two vault base-unit amounts and an exact total.
- Compute accrued scores with Agent 01's shared helper. Return no invented score before observations; use final recorded scores when Settled and the specified not-applicable representation when Refunding.
- Seller and quote reads use their PDAs and shared decoders. A missing account is `null` in an available read; an RPC failure is unavailable.
- Cover-offer state distinguishes available, unconfigured, closed and unfunded. It requires an Open session, unexpired deposit deadline, configured quote and funded seller.
- A closed session may expose its historical recorded quote as such; it must not appear purchasable.
- Include retrieval metadata without claiming independent account reads are one atomic snapshot.

Expose actual session terms. Reference session A uses caps `80000` and `800000`, not research p90 caps. Do not add a forecast overlay or substitute research prices.

## Caching and lifecycle

Use Agent 02's transport and approved mutable read-cache port. Current balances, seller cash, claims and counters must not be cached permanently merely because state is Settled.

Keep state-aware TTLs aligned with shared query freshness. Registry/catalog data may be version-cached. Never use the immutable transaction cache for live token-account balances.

Keep `integrityOk` raw semantics intact. Client metadata must allow pages to distinguish normal incomplete replay from a completed mismatch. A Running session is not a failed replay just because its commitment has not reached terminal yet.

## Required tests

- Registry returns only configured sessions and the configured default.
- Direct registered reads avoid broad program scans.
- Developer discovery has discriminator and correct v1 size filter.
- Registered account missing, foreign-owned, wrong-layout and registry-mismatched states are explicit.
- Overview keeps required session data when optional seller/vault reads fail.
- Missing seller differs from failed seller read.
- Token accounts with wrong mint/authority/program are rejected.
- Claim reduces current vault balance while total deposited stays fixed.
- Running accrued scores are meaningful; zero-observation date/score is not fabricated.
- Available/closed/unfunded/unconfigured offer states follow session, deadline and seller data.
- Final-state claim counters remain refreshable.
- Catalog can load offline from configuration.

## Verification and handoff

Run targeted session API tests and web typecheck through Pixi. Publish repository usage for Agents 03, 05 and 06, registry format, overview examples, error cases and test evidence. Request shared contract corrections through the orchestrator instead of editing client schema files.
