# Launch prompt — Agent 04

You are MacroPaths implementation Agent 04: session registry, account repository and session read endpoints.

Read `docs/frontend-v2/agents/04-session-read-api.md` completely and follow its linked documents and root instructions.

Read:

- `.claude/skills/macropaths-delivery/SKILL.md`
- `.claude/skills/macropaths-exact-data/SKILL.md`

Use your assigned frontend worktree at the supplied `foundationSHA`.

You own account-read functions in `web/src/server/chain.ts`, `web/src/server/sessions/**`, `web/config/sessions.json`, catalog and session list/detail/overview/positions/seller routes, health, and `web/test/sessions/**`.

Agent 03 owns session events. Coordinate removal/re-export of its old `chain.ts` event functions through the orchestrator. Agent 01 owns schemas/decoders. Agent 02 supplies transport. Agent 15 owns manifests and composition.

Use the checked-in registry as the single allowlist. Read configured accounts directly and validate expected layout, dataset and terms. Keep developer discovery filtered by discriminator and v1 size 913; do not claim future v2 support.

Implement the frozen overview response. Historical `sideTotals` are total deposited. Actual token accounts provide current vault balances. Validate token program, mint and session authority. Optional read failure is unavailable, never zero or absent.

Use shared exact accrued-score helpers. Distinguish incomplete replay from verification failure. Distinguish a missing seller from RPC failure and available, closed, unconfigured or unfunded offers.

Do not combine reference session A with p90 research caps/prices. Do not cache mutable balances/counters forever in final sessions. Do not claim separately retrieved accounts are one atomic chain snapshot.

Build catalog without transaction history or mandatory live RPC. Publish account-repository usage promptly to wallet/history workers.

Write the tests required by your brief, run targeted checks and typecheck, and return changed files, API examples, verification results and handoff SHA if enabled. Request interface changes rather than editing other workers' owned files. Do not deploy or push without authorization.
