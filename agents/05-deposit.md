# 05 deposit

**Goal.** Fill deposit: Position create-or-update and atomic transfers into both product vaults.

**Branch and worktree.** `agent/05-deposit`, worktree `~/wt/05-deposit` (see `agents/README.md` Setup). Wave 1.

**Read first.** `AGENTS.md`; `docs/program-spec.md` §1.8 deposit, §1.2, §1.7; `agents/README.md` (PR template, conflict rules). Existing code to follow: `programs/macropaths/tests/common/mod.rs` (harness, after 01 merges) and the instruction files already in `programs/macropaths/src/instructions/`.

**May assume merged.** 01. Do not start before the orchestrator has posted `main moved` for those. Rebase on `main` whenever it posts again.

**Before step 1.** In your worktree: `pixi install --locked && anchor build && cargo test -p macropaths` green.

**Rules.** Integer arithmetic only, `checked_*`, `u128` intermediates, floors everywhere. Every expected number in a test comes from `tests/vectors.json`. Edit only the files under "Files you own"; add lines to shared files, never remove others'. If the spec is silent, ask the orchestrator and wait.

## Scope and steps

**Files you own:** `instructions/deposit.rs`, `tests/deposit.rs`.
1. Fill handler per §1.8, transfers via `anchor_spl::token::transfer` with `owner` as authority.
2. Tests: (a) first deposit `[10,0,10,0]` PLAY: position created, `position_count == 1`, side_totals and both vault balances; (b) second deposit by same owner `[0,5,0,0]`: `position_count` still 1, `deposited == [10,5,10,0]`; (c) all zeros → `ZeroAmount`; (d) wrong-mint token account → `WrongMint` (or Anchor constraint error; assert failure and no state change); (e) `set_time(deposit_deadline + 1)` → `PastDeadline`; (f) after a (stubbed) state change is not testable until 06 merges, so test (f) = `state != Open` is written but `#[ignore]`d with a note; (g) two different owners → `position_count == 2`.

## Acceptance and hand-off

**Acceptance:** `cargo test -p macropaths deposit`.

Open a PR with the template in `agents/README.md`, paste the acceptance output verbatim, then post the Hand-off line in chat with the commit SHA.
