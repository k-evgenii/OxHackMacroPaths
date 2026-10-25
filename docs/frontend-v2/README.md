# MacroPaths frontend v2: Claude implementation pack

This pack prepares **15 implementation workers to start together**, after one short foundation checkpoint. It contains the product decisions, API contracts, ownership boundaries, reusable Claude skills, and prompts. It does not implement or deploy the application.

## Start here

1. Read [the execution protocol](parallel-execution.md) and [frontend scope](frontend-protocol.md).
2. Give a coordinating Claude session [the orchestrator prompt](prompts/00-orchestrator.md).
3. The coordinator verifies `evgenii/frontend`, prepares the foundation commit described in [interfaces](interfaces.md), and records its SHA.
4. Your runner reads [launch-manifest.json](launch-manifest.json), creates one isolated worktree per worker from that exact SHA, and launches all 15 prompts concurrently.
5. Workers implement against the frozen interfaces and test fixtures. Runtime dependencies determine merge order, not start order.
6. Worker 15 integrates commits on the integration branch and completes end-to-end verification. Nothing is pushed, merged remotely, or deployed automatically.

The inspected frontend baseline was `dfb4b97ea40287c7308698bd21f7111248f2538e` in `D:/Oxhack/OxHackMacroPaths-web`. Treat that as evidence, not an instruction to reset a newer branch. Resolve the current head before launch. The documentation was authored in the separate macro-research workspace; transfer only this pack and the four new `.claude/skills/macropaths-*` directories to the frontend branch. Do not transfer unrelated research changes.

## Product defaults

- Cover buyers first; show any pool positions the connected wallet owns.
- Two CPI products plus Fuel **Research**. No Diesel, Floating-Loan, or v2 deployment work.
- Connect Phantom/Solflare and read balances, holdings, and history. No transaction signing, faucet, deposits, cover purchases, or claims in this release.
- Historical replay, devnet, and test PLAY labels remain visible.
- Warm light application surfaces; dark blue chart panels; thin electric-blue glow.
- Vercel/serverless read API with shared Redis transaction caching.
- Actual session terms determine session results. A versioned research bundle determines research results. Never mix the two.

## Shared specifications

| Document | Purpose |
| --- | --- |
| [Product and content](product-and-content.md) | Audience, screen hierarchy, economic meanings, copy |
| [API and architecture](api-and-architecture.md) | Services, routes, failure semantics, exact accounting |
| [Interfaces](interfaces.md) | Frozen wire schemas, repository ports, UI props, hooks, bootstrap checklist |
| [Design system](design-system.md) | Tokens, layout, interaction, chart and accessibility criteria |
| [Parallel execution](parallel-execution.md) | Ownership, worktrees, launch/merge DAG, conflict handling |
| [Acceptance](acceptance.md) | Tests, user scenarios, release evidence |
| [Launcher contract](launcher-contract.md) | Runner inputs, state machine, manifest use, output handling |

## Worker roster

| ID | Assignment | Brief | Prompt |
| --- | --- | --- | --- |
| 01 | Shared schemas, exact math, fixtures | [brief](agents/01-contracts-and-models.md) | [prompt](prompts/01-contracts-and-models.md) |
| 02 | RPC transport and retries | [brief](agents/02-rpc-transport.md) | [prompt](prompts/02-rpc-transport.md) |
| 03 | Transaction cache, pagination, raw events | [brief](agents/03-history-cache-and-events.md) | [prompt](prompts/03-history-cache-and-events.md) |
| 04 | Session registry, catalogue, overview API | [brief](agents/04-session-read-api.md) | [prompt](prompts/04-session-read-api.md) |
| 05 | Wallet balances and holdings API | [brief](agents/05-wallet-read-api.md) | [prompt](prompts/05-wallet-read-api.md) |
| 06 | Wallet action history | [brief](agents/06-wallet-history.md) | [prompt](prompts/06-wallet-history.md) |
| 07 | Research bundle and artifact delivery | [brief](agents/07-research-data.md) | [prompt](prompts/07-research-data.md) |
| 08 | Tokens, primitives, UI kit | [brief](agents/08-ui-foundations.md) | [prompt](prompts/08-ui-foundations.md) |
| 09 | Glow charts and sparklines | [brief](agents/09-glow-charts.md) | [prompt](prompts/09-glow-charts.md) |
| 10 | Shell, wallet connection, query layer | [brief](agents/10-shell-and-wallet-connection.md) | [prompt](prompts/10-shell-and-wallet-connection.md) |
| 11 | Dashboard | [brief](agents/11-dashboard.md) | [prompt](prompts/11-dashboard.md) |
| 12 | Unified Session page | [brief](agents/12-session-page.md) | [prompt](prompts/12-session-page.md) |
| 13 | Personal and Market activity page | [brief](agents/13-activity-page.md) | [prompt](prompts/13-activity-page.md) |
| 14 | Products and Planner | [brief](agents/14-products-and-planner.md) | [prompt](prompts/14-products-and-planner.md) |
| 15 | Integration, developer console, browser QA | [brief](agents/15-integration-and-qa.md) | [prompt](prompts/15-integration-and-qa.md) |

## Reusable skills

- `.claude/skills/macropaths-delivery/SKILL.md`: task routing, boundaries, handoff.
- `.claude/skills/macropaths-exact-data/SKILL.md`: units, scores, pool/cover math, state-sensitive presentation.
- `.claude/skills/macropaths-history/SKILL.md`: partial transaction pages and per-action attribution.
- `.claude/skills/macropaths-ui/SKILL.md`: the approved visual language and UI verification.

Each role loads only relevant skills/references. Existing repository skills stay in place. The optional screenshot analyzer guide does not install an operational tool; reference-derived visual values are estimates.

## Definition of done for this pack

All 15 briefs and prompts exist, links resolve, the JSON manifest agrees with role ownership, skill frontmatter validates, and an independent review can explain launch order without inventing interfaces. For the application itself, use [acceptance](acceptance.md).
