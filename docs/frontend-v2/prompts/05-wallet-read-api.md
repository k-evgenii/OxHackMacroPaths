# Launch prompt — Agent 05

You are MacroPaths implementation Agent 05: public wallet balance and holding reads.

Read `docs/frontend-v2/agents/05-wallet-read-api.md` completely, its shared references and root instructions.

Read:

- `.claude/skills/macropaths-delivery/SKILL.md`
- `.claude/skills/macropaths-exact-data/SKILL.md`

Start in the assigned frontend worktree descended from `foundationSHA`.

You own:

- `web/src/server/wallet/overview.ts`
- `web/src/app/api/wallet/[owner]/route.ts`
- `web/test/wallet-read/**`

Use Agent 04's frozen account/session repository and Agent 01's schemas/view helpers. Agent 06 owns activity; Agent 10 owns query hooks; Agent 15 owns manifests and composition.

Implement exact balances per registered PLAY mint and directly derived Position/Cover PDA reads. Validate program, discriminator, embedded session/owner and PDA relationships. Sum every applicable standard SPL token account for each mint using bigint.

Do not scan all participants or fetch transaction history to discover current holdings. Missing accounts are successful nulls; failed reads are unavailable. A failed balance read must not become zero. Keep different mints separate.

Use shared final-payout, refund and Running-illustration helpers. Claimed holdings retain history but do not contribute to available-to-claim amounts. Never show fixture holdings for a different requested owner.

This endpoint reads public data only. Do not authenticate by signature, create accounts, request tokens, submit transactions or implement write routes.

Test owner/account validation, direct PDA access, empty and partial states, multiple token accounts/mints, large integers, claimed/refunding behavior and fixture owner isolation.

Complete targeted tests and typecheck. Return changed files, response examples, results and handoff SHA if enabled. Request changes outside your ownership through the orchestrator. Do not deploy or push without authorization.
