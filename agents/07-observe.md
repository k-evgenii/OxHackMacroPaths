# 07 observe

**Goal.** Fill observe: hash-chain verification and the O(1) recursions, rejecting every tampered or misordered row with no state change.

**Branch and worktree.** `agent/07-observe`, worktree `~/wt/07-observe` (see `agents/README.md` Setup). Wave 1.

**Read first.** `AGENTS.md`; `docs/program-spec.md` §1.8 observe, §1.5, §1.6; `agents/README.md` (PR template, conflict rules). Existing code to follow: `programs/macropaths/tests/common/mod.rs` (harness, after 01 merges) and the instruction files already in `programs/macropaths/src/instructions/`.

**May assume merged.** 01, 02, 03. Do not start before the orchestrator has posted `main moved` for those. Rebase on `main` whenever it posts again.

**Before step 1.** In your worktree: `pixi install --locked && anchor build && cargo test -p macropaths` green.

**Rules.** Integer arithmetic only, `checked_*`, `u128` intermediates, floors everywhere. Every expected number in a test comes from `tests/vectors.json`. Edit only the files under "Files you own"; add lines to shared files, never remove others'. If the spec is silent, ask the orchestrator and wait.

## Scope and steps

**Files you own:** `instructions/observe.rs`, `tests/observe.rs`.
1. Fill handler per §1.8, checks in the listed order, using `chain::obs_hash`, `math::step_cooling`, `math::step_excess`; emit `Observed`.
2. Use the real data: `create_session_default` (its `c0`/`terminal` come from `vectors.json.chain`), and take rows and commitments from `vectors.json.rows` and `vectors.json.chain`. For the happy path observe only the first 10 real rows; `n_obs` stays 48. Do not build a synthetic chain.
3. Tests: (a) 10 real rows in order: after each, `Session.peak/max_decline/excess_acc/values[i]/next_index/commitment` equal `vectors.running[i]` and `chain.commitments[i+1]`; (b) wrong value → `BadCommitment`, state unchanged (compare full account bytes before/after); (c) wrong `next_commitment` → `BadCommitment`; (d) skip an index → `WrongIndex`; (e) replay the same row twice → `WrongIndex`; (f) swap rows 3 and 4 → `BadCommitment`; (g) `period_id` not increasing but hash valid is impossible (hash binds period), so test that a tampered period fails `BadCommitment`; (h) state Open → `WrongState`; (i) `set_time(replay_deadline+1)` → `PastDeadline`; (j) log the compute units of one observe from `meta.compute_units_consumed` and print it.

## Acceptance and hand-off

**Acceptance:** `cargo test -p macropaths observe`; hand-off includes the CU number.

Open a PR with the template in `agents/README.md`, paste the acceptance output verbatim, then post the Hand-off line in chat with the commit SHA.
