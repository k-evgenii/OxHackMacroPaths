---
name: macropaths-delivery
description: Implement or coordinate the MacroPaths frontend v2 read API and UI using its parallel worker pack, frozen contracts, and isolated ownership. Use for this repository's frontend execution and integration tasks.
---

# MacroPaths delivery

This skill routes the repository-specific implementation pack. It does not authorize deployment, program changes, wallet transactions, remote merges, or service provisioning.

## Read the appropriate contract

The pack is at `docs/frontend-v2/` relative to repository root (from this file: [pack entrypoint](../../../docs/frontend-v2/README.md)). Read [frontend-protocol](../../../docs/frontend-v2/frontend-protocol.md), your assigned role brief, [interfaces](../../../docs/frontend-v2/interfaces.md), and [parallel execution](../../../docs/frontend-v2/parallel-execution.md). Use the manifest for your exact owned paths. Load product/design/API references only as your role requires.

Coordinator: follow [the orchestrator prompt](../../../docs/frontend-v2/prompts/00-orchestrator.md) and [launcher contract](../../../docs/frontend-v2/launcher-contract.md). Prepare the common foundation before fifteen workers start together.

## Non-obvious delivery rules

- Implement from the verified frontend foundation, not the dirty macro-research branch. Historical program-agent numbers do not assign frontend workers Rust or deployment duties.
- Shared contracts, query keys, wallet context and UI props are frozen before launch. Build against those and explicit test fixtures; never silently recover live API errors with fixtures.
- Read other modules freely, but write only your owned paths while peers are active. One owner controls shared schemas; another owns queries; global wiring/dependencies are integrator-owned.
- A dependency on another implementation is a merge dependency, not a reason to idle. Build pure logic, adapters, tests and layouts against approved ports.
- Submit interface or dependency requests to the coordinator with affected consumers and a migration. Do not add an alternate schema/formatter/query/cache in a feature folder to bypass ownership.
- Preserve existing bigint accounting, account layouts, fixed Anchor/web3.js stack and known fixture numbers.
- Distinguish unavailable reads from successful empty results. Preserve session/research identity. Do not fabricate times, prices, balances, offer status or payout expectations.

## Verify and hand off

Use focused checks that prove your behavior; the integrator runs the whole dependency closure. Record exactly what passed, failed or could not run. Build success is not visual verification. Use [report-template](../../../docs/frontend-v2/report-template.md), commit only your owned changes locally, and report the real SHA. Do not push/deploy.

Reusable companion skills cover [exact data](../macropaths-exact-data/SKILL.md), [history](../macropaths-history/SKILL.md) and [UI](../macropaths-ui/SKILL.md). Read them when working on those capabilities, not automatically for every role.
