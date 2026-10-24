# 11 security

**Goal.** Audit every token-moving instruction against the checklist, fix gaps with regression tests, and write the report Dev countersigns.

**Branch and worktree.** `agent/11-security`, worktree `~/wt/11-security` (see `agents/README.md` Setup). Wave 2.

**Read first.** `AGENTS.md`; `docs/program-spec.md` §1.8, AGENTS.md security baseline; `agents/README.md` (PR template, conflict rules). Existing code to follow: `programs/macropaths/tests/common/mod.rs` (harness, after 01 merges) and the instruction files already in `programs/macropaths/src/instructions/`.

**May assume merged.** 04, 05, 06, 07, 08, 09. Do not start before the orchestrator has posted `main moved` for those. Rebase on `main` whenever it posts again.

**Before step 1.** In your worktree: `pixi install --locked && anchor build && cargo test -p macropaths` green.

**Rules.** Integer arithmetic only, `checked_*`, `u128` intermediates, floors everywhere. Every expected number in a test comes from `tests/vectors.json`. Edit only the files under "Files you own"; add lines to shared files, never remove others'. If the spec is silent, ask the orchestrator and wait.

## Scope and steps

**Files you own:** `docs/security-review.md`, and fix commits in any `instructions/*.rs` (each fix one commit, prefixed `sec:`).
1. Install and run the Trail of Bits `solana-vulnerability-scanner` skill over `programs/macropaths/src`.
2. For each of the nine token-moving instructions fill a row: seeds+bump checked · owner program checked · mint checked · token program is `anchor_spl::token::ID` · signer correct · state checked before transfer · deadline checked · arithmetic checked/u128 · `init_if_needed` reinit safe (Position/Cover/Seller/Quote: first-call detection by `owner == default`) · no account can be passed twice (vault_0 ≠ vault_1 constraint) · permissionless instructions cannot be griefed (observe/settle/expire/seller_settle only move state forward by rule).
3. Add missing constraints as `sec:` commits with a regression test each in `tests/security.rs` (e.g. pass vault_1 as vault_0; pass another session's position; claim with someone else's token account).
4. Write the report; mark every row ✔/✘ and leave a signature line for Dev.

## Acceptance and hand-off

**Acceptance:** all rows ✔, `cargo test -p macropaths` green. Hand-off: `agent 11 done: N findings, N fixed, report ready for Dev`.

Open a PR with the template in `agents/README.md`, paste the acceptance output verbatim, then post the Hand-off line in chat with the commit SHA.
