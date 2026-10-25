# 04 create-session

**Goal.** Fill create_session: parameter checks, Session initialisation and the two vault token accounts.

**Branch and worktree.** `agent/04-create-session`, worktree `~/wt/04-create-session` (see `agents/README.md` Setup). Wave 1.

**Read first.** `AGENTS.md`; `docs/program-spec.md` §1.8 create_session, §1.2; `agents/README.md` (PR template, conflict rules). Existing code to follow: `programs/macropaths/tests/common/mod.rs` (harness, after 01 merges) and the instruction files already in `programs/macropaths/src/instructions/`.

**May assume merged.** 01. Do not start before the orchestrator has posted `main moved` for those. Rebase on `main` whenever it posts again.

**Before step 1.** In your worktree: `pixi install --locked && anchor build && cargo test -p macropaths` green.

**Rules.** Integer arithmetic only, `checked_*`, `u128` intermediates, floors everywhere. Every expected number in a test comes from `tests/vectors.json`. Edit only the files under "Files you own"; add lines to shared files, never remove others'. If the spec is silent, ask the orchestrator and wait.

## Scope and steps

**Files you own:** `instructions/create_session.rs`, `tests/create_session.rs`.
1. Fill the handler per §1.8: checks, then every field write, `peak = i64::MIN`.
2. Tests: (a) happy path with `create_session_default`: read `Session`, assert every field including `vaults` keys equal the PDAs and both vault token accounts have `mint == PLAY`, `owner == session`, amount 0; (b) `deposit_deadline ≤ now` → `InvalidParams`; (c) `replay_deadline ≤ deposit_deadline` → `InvalidParams`; (d) `d_cap = 0` → `InvalidParams`; (e) same `session_id` twice → account-already-exists failure.

## Acceptance and hand-off

**Acceptance:** `cargo test -p macropaths create_session`. Hand-off line.

Open a PR with the template in `agents/README.md`, paste the acceptance output verbatim, then post the Hand-off line in chat with the commit SHA.
