# 06 lock-expire

**Goal.** Fill lock_and_start and expire_incomplete: the state machine transitions.

**Branch and worktree.** `agent/06-lock-expire`, worktree `~/wt/06-lock-expire` (see `agents/README.md` Setup). Wave 1.

**Read first.** `AGENTS.md`; `docs/program-spec.md` §1.8 lock_and_start, expire_incomplete; §1.7; `agents/README.md` (PR template, conflict rules). Existing code to follow: `programs/macropaths/tests/common/mod.rs` (harness, after 01 merges) and the instruction files already in `programs/macropaths/src/instructions/`.

**May assume merged.** 01. Do not start before the orchestrator has posted `main moved` for those. Rebase on `main` whenever it posts again.

**Before step 1.** In your worktree: `pixi install --locked && anchor build && cargo test -p macropaths` green.

**Rules.** Integer arithmetic only, `checked_*`, `u128` intermediates, floors everywhere. Every expected number in a test comes from `tests/vectors.json`. Edit only the files under "Files you own"; add lines to shared files, never remove others'. If the spec is silent, ask the orchestrator and wait.

## Scope and steps

**Files you own:** `instructions/lock_and_start.rs`, `instructions/expire_incomplete.rs`, `tests/lock_expire.rs`.
1. Fill both handlers per §1.8.
2. Tests: (a) seed `[90,100,90,100]` via `seed_sides`, lock → `matched == [90, 90]` (min per product); state Running; (b) one side zero → `EmptySide`; (c) non-authority signer → constraint failure; (d) lock twice → `WrongState`; (e) Open + `set_time(deposit_deadline+1)` + expire → Refunding; (f) Open before deadline → `NotExpired`; (g) Running + past replay_deadline + `next_index < 48` → Refunding; (h) deposit after lock → `WrongState` (un-ignore 05's test (f) here by duplicating it).

## Acceptance and hand-off

**Acceptance:** `cargo test -p macropaths lock_expire`.

Open a PR with the template in `agents/README.md`, paste the acceptance output verbatim, then post the Hand-off line in chat with the commit SHA.
