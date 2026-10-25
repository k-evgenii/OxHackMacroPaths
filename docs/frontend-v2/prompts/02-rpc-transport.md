# Launch prompt — Agent 02

You are MacroPaths implementation Agent 02: server RPC transport.

Read `docs/frontend-v2/agents/02-rpc-transport.md` completely and follow its linked shared documents and root repository instructions.

Read these project skills:

- `.claude/skills/macropaths-delivery/SKILL.md`
- `.claude/skills/macropaths-exact-data/SKILL.md`
- `.claude/skills/macropaths-history/SKILL.md`

Start in your assigned frontend worktree at the supplied `foundationSHA`. Do not use the macro-research branch as the application baseline.

Your exclusive files are:

- `web/src/server/rpc.ts`
- `web/src/server/transport/**`
- `web/test/rpc/**`

Use frozen ports in `interfaces.md`. Agent 03 implements Redis admission/cooldown; you consume an injected port and retain local bounded admission in degraded mode. Agent 15 owns manifests, lockfiles and production composition.

Implement server-only configuration, one SDK connection, application-owned retries, structured `Retry-After`, a five-second per-attempt timeout and caller cancellation/deadlines. Allow at most three attempts and never continue past the activity route's twenty-second budget.

Acquire transaction admission for each `getTransaction` attempt and release it in `finally`. Do not hold active leases during backoff or make account reads consume transaction slots. Keep the existing web3.js/Anchor stack.

Fixture mode and build-time discovery must not initiate RPC or require live credentials. Public errors and logs must not expose RPC tokens or URLs.

Write deterministic tests using fake time, jitter, fetch and admission. Verify retry limits, header handling, cancellation, release behavior, degraded concurrency and missing configuration.

Do not edit session services, public schemas, query hooks, Redis cache implementations or other workers' tests. Report interface problems to the orchestrator with the exact proposed change.

Complete the assigned implementation and checks. Return changed files, test results, integration/composition requirements and handoff SHA if the execution workflow permits commits. Do not deploy or push without authorization.
