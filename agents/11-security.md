# 11 security

**Goal.** Audit every instruction that moves tokens or changes who can do what, fix gaps with one regression test each, and produce the report Dev countersigns. Dev is doing an independent security review at the same time; you do not wait for each other, you compare at the end.

**Branch and worktree.** `agent/11-security`, worktree `~/wt/11-security`. Wave 2.

**Read first.** `AGENTS.md`; `docs/program-spec.md` §1.2, §1.7, §1.8; `.cursor/skills/solana-vulnerability-scanner/SKILL.md` and `resources/VULNERABILITY_PATTERNS.md` (the skill is vendored in the repo; nothing to install); `.cursor/skills/solana-anchor-reference/references/security.md`; every file in `programs/macropaths/src/instructions/`; `programs/macropaths/tests/common/mod.rs` (`put_session`, `put_vaults`, `put_position`, `assert_err`).

**May assume merged.** Wave 1 (04–09) and agent 01b. Start when the orchestrator posts `cursor_main moved` for 01b. Before touching a file, check open PRs against `cursor_main` and GitHub issues from Dev so you do not fix what someone is already fixing.

**Before step 1.** `git fetch origin && git switch -C agent/11-security origin/cursor_main`, then `pixi install --locked && anchor build && cargo test -p macropaths` (64 passed).

**Rules.** One finding, one commit, prefixed `sec:`, each with a test in `tests/security.rs` named `security_<finding>` that fails before the fix and passes after; say so in the commit body. Keep fixes to the smallest constraint or `require!` that closes the hole. You may edit any `instructions/*.rs`; do not edit `state.rs`, `math.rs`, `chain.rs`, `constants.rs`, other agents' test files, or `common/mod.rs`. If closing a hole needs a new error variant or a state field, ask the orchestrator and wait. Test setup uses the fixtures, not other instructions.

## Scope and steps

**Files you own:** `docs/security-review.md`, `programs/macropaths/tests/security.rs`, `sec:` commits in `programs/macropaths/src/instructions/*.rs`.

1. **Scope the audit.** Implemented and token-moving: `create_session`, `deposit`, `claim`, `sweep_dust`. Implemented, state-changing, no tokens: `lock_and_start`, `observe`, `settle`, `expire_incomplete`. Stubs with real account structs but empty handlers: `seller_fund`, `set_entry_quote`, `buy_cover`, `claim_cover`, `seller_settle`, `seller_withdraw`; audit their `#[derive(Accounts)]` structs now and mark the handler column "pending (wave 3)".
2. **Fill one row per instruction in `docs/security-review.md`** with ✔, ✘ or n/a per column: PDA seeds and bump checked · account owner is the expected program · mint checked · token program is `anchor_spl::token::ID` · correct signer, and `has_one` where the spec says · state checked before any transfer · deadline checked · arithmetic `checked_*` or `u128`, no truncating `as` · `init_if_needed` safe against re-init (first-call detection by `owner == Pubkey::default()`) · the same account cannot be passed in two slots (`vault_0 != vault_1`; `owner_ta` is not a vault) · permissionless instructions (`observe`, `settle`, `expire_incomplete`, `seller_settle`) can only move state forward by rule and cannot be used to grief · CPI target is the SPL token program only.
3. **Attack tests to write regardless of outcome** (each becomes a `security_` test; passing ones prove the constraint, failing ones become `sec:` fixes): pass `vault_1` in the `vault_0` slot of `deposit` and of `claim`; pass another session's `Position` to `claim`; claim to a token account owned by someone else; deposit from a token account of a different mint; `deposit` after `deposit_deadline`; `observe` with a valid hash in `Open` state; `lock_and_start` by a non-authority; `sweep_dust` by a non-authority and with `claimed_count < position_count`; `settle` with `next_index == 48` but `commitment != terminal`; a second `create_session` with the same `session_id` after `expire_blockhash`; `claim` twice after `expire_blockhash`. Anchor constraint failures are not `MacroError`s: match the custom code yourself (`ConstraintHasOne` = 2001, `ConstraintSeeds` = 2006, `ConstraintRaw` = 2003, `AccountNotInitialized` = 3012) rather than using `assert_err`.
4. **Arithmetic pass.** Grep for `as u64`, `as i64`, `as u32` and unchecked `+ - *` in `instructions/`. Each is either justified in the report or replaced.
5. **Write the report** with the table, a short list of findings (severity, file, fix commit), a list of what you deliberately did not change, and the final line `Countersigned by Dev: ____ (date)`.

## Acceptance and hand-off

**Acceptance:** every row of the report is filled; full `cargo test -p macropaths` green including all `security_` tests; `pixi run vectors` prints the acceptance line.

Open a PR with the template in `agents/README.md`, paste the test names, and post the Hand-off line with the SHA and `N findings, N fixed, N open`. Tag Dev on the PR for the countersign.
