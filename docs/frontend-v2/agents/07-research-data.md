# Agent 07 — Research bundle publication and artifact API

## Outcome

Make research data reproducible, validated and explicitly separate from deployed-session facts. A normal dev/build command must not silently replace frontend artifacts with an unmerged research revision.

## Read first

- [Delivery instructions](../README.md), [product decisions](../product-and-content.md), [architecture](../api-and-architecture.md), [frozen interfaces](../interfaces.md), [parallel execution](../parallel-execution.md), and [acceptance](../acceptance.md).
- Read `.claude/skills/macropaths-delivery/SKILL.md` and `.claude/skills/macropaths-exact-data/SKILL.md`.
- Inspect committed frontend manifest/forecast/planner artifacts, `lib/artifacts.ts`, artifact routes, `copy-artifacts.mjs`, the existing planner tests and applicable project descriptions. Treat newer research notes as context rather than deployment proof.

## Exclusive ownership

- `web/src/server/research/**`.
- `web/src/lib/artifacts.ts`.
- `web/src/app/api/artifacts/[name]/route.ts`.
- `web/scripts/copy-artifacts.mjs` and new dedicated artifact-validation/publication scripts.
- `web/public/data/**`.
- `web/test/research/**`.

Agent 01 owns shared schemas. Agent 10 owns query hooks; turn `lib/artifacts.ts` into a compatible consumer/re-export seam as agreed rather than introducing a second query implementation. Agent 15 owns npm script wiring, dependencies and lockfiles. The Products/Planner worker owns UI. Do not change research Python, producer algorithms, planner math or program/keeper code.

## Foundation agreement

Follow the frozen research response, bundle metadata and query-export contracts in `interfaces.md`. Keep existing raw artifact fields usable by the current planner until the integrator migrates consumers. Coordinate shape changes through Agent 01/orchestrator.

## Reproducible bundle

1. Publish the committed manifest, forecast and planner as one explicitly versioned bundle.
2. Include bundle/schema version, content hashes, source/retrieval metadata available in the actual files, units, thresholds, caps, product flags and optional verified session association.
3. Use deterministic hashing of the published files. Document the hashing method; do not hash a file that contains its own hash.
4. Validate agreement between manifest terms, forecast product mapping/quotes and planner thresholds/caps/prices.
5. Do not invent retrieval dates or mark an unsupported product executable. Unknown metadata must remain explicitly unknown.
6. Normalize scaled integer quantities and quote millionths to decimal strings in the approved API view. Convert only safe integer inputs; reject unsafe integer conversion rather than rounding it.
7. Keep continuous simulation/research outputs as numbers, isolated from chain accounting. The existing planner's numerical results and tie-break behavior must not change.
8. Validate recognized product identities. This release has two CPI products and Fuel Research; do not silently publish Diesel/Floating-Loan or a v2 executable product because a newer local producer emits it.

Reference session A has test caps `80000` / `800000`. The inspected research bundle has p90 caps `76973` / `1883141`; it must not be associated with A or used to replace A's scores. Research prices are never actual on-chain seller offers.

The inspected frontend artifacts report Fuel excess `72833`; some newer prose reports `72844`. Keep one validated bundle internally consistent. Do not mix revisions or regenerate data to make the prose agree.

## Explicit publication workflow

- Remove automatic artifact copying from normal startup/build behavior through a script-change request to Agent 15.
- Keep committed frontend data as the deterministic default.
- Convert `copy-artifacts.mjs` into an explicit sync/publication step, or replace it with dedicated scripts while preserving a documented compatibility command.
- Require an explicit input directory and validate the whole candidate bundle before replacing published files.
- Fail clearly on missing, malformed, inconsistent or unsupported inputs.
- Validate before mutation and avoid partial replacement of an existing valid bundle.
- Do not read arbitrary local research outputs implicitly during a build.
- Add a nonmutating artifact-validation command for CI/build use.

The requested implementation is artifact publication infrastructure. Do not fetch/regenerate underlying research, change the producer model or deploy anything.

## Artifact delivery

Ensure the three existing `/api/artifacts/{manifest,forecast,planner}` routes remain usable through their frozen response contracts and zod validation. Serve bundled data reliably in the production output; do not rely on an accidental runtime working directory.

Static `/data/*.json` delivery may remain for compatibility. The bundle metadata and normalized responses must identify the same published revision. Coordinate trace/import configuration with Agent 15.

Use version-aware cache identities. A stale research response must not remain cached under an unchanged generic key after publication. Agent 10 owns browser query keys; provide the bundle identity it needs.

## Required tests

- Committed default bundle validates and preserves existing planner reference outputs.
- Manifest/forecast/planner mismatched caps, quotes or products fail validation.
- Malformed JSON and missing files produce explicit typed errors.
- Unsupported product/revision is not silently promoted.
- Unsafe integer normalization fails; approved integer strings stay exact.
- Missing metadata is not fabricated.
- Bundle hashes are deterministic and change with contents.
- Candidate validation failure preserves the existing published bundle.
- Ordinary dev/build commands do not mutate published artifact files.
- Session A cannot receive the p90 bundle association.
- Production-style artifact delivery succeeds without reading an unbundled source directory.

## Verification and handoff

Run targeted research tests and existing planner regression tests without changing the algorithm; run web typecheck. Provide the bundle identity, normalization rules, explicit sync/validate commands, required script wiring, production delivery requirements and test evidence to Agents 10, 15 and the Products/Planner worker.
