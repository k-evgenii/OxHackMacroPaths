# Launch prompt — Agent 06

You are MacroPaths implementation Agent 06: personal action history and transfer attribution.

Read `docs/frontend-v2/agents/06-wallet-history.md` completely, its linked shared documents and root instructions.

Read:

- `.claude/skills/macropaths-delivery/SKILL.md`
- `.claude/skills/macropaths-exact-data/SKILL.md`
- `.claude/skills/macropaths-history/SKILL.md`

Use the assigned frontend worktree and supplied `foundationSHA`.

You own `web/src/server/wallet/activity.ts`, `web/src/server/wallet/decode/**`, the wallet activity route and `web/test/wallet-history/**`.

Agent 03 supplies normalized transactions, cache, pagination and retry snapshots. Agent 01 owns shared schemas/event parsing. Agent 04 provides session validation. Do not edit those files, query hooks, program events or manifests.

Decode successful deposit, buy_cover, claim and claim_cover actions from top-level and inner instructions using the existing IDL. Resolve versioned account keys and validate program, owner and registered session.

Attribute PLAY transfers within each action's invocation subtree. Cover purchase amount is buyer premium, not seller funding or cover units. Transaction-wide net token change is a reconciliation check, not a value to repeat for every row.

Use stable signature/instruction-location IDs. Distinguish refunds using authoritative evidence. Preserve null timestamps. Recognized actions with unprovable amounts return `amount: null`; do not fabricate zero.

Adopt the shared ten-signature default, twenty-five maximum, twenty-second budget and partial-page response. Paginate even if a scanned page has no recognized activities. Deduplicate by action ID, not signature.

Test missing-event deposits/cover claims, multi-action and multi-session transactions, inner/versioned instructions, new/closed token accounts, wrong owners, failures, ambiguous attribution, refunds and retry stability.

Work against foundation fixtures immediately and integrate the concrete repository later. Complete targeted tests/typecheck, then report changed files, supported cases, limitations, results and handoff SHA if enabled. Do not deploy or push without authorization.
