# 03 chain

**Goal.** Implement the Rust side of the commitment chain so it matches the encoding already agreed by Dev and Phill on main (`docs/commitment-chain.md`, `tests/vectors.json`). DONE and merged as `agent/03-chain-v2`; this brief is kept as a record.

**Branch and worktree.** `agent/03-chain`, worktree `~/wt/03-chain` (see `agents/README.md` Setup). Wave 0.

**Read first.** `AGENTS.md`; `docs/program-spec.md` §1.6; `agents/README.md` (PR template, conflict rules). Existing code to follow: `programs/macropaths/tests/common/mod.rs` (harness, after 01 merges) and the instruction files already in `programs/macropaths/src/instructions/`.

**May assume merged.** none. Do not start before the orchestrator has posted `main moved` for those. Rebase on `main` whenever it posts again.

**Before step 1.** In your worktree: `pixi install --locked && anchor build && cargo test -p macropaths` green.

**Rules.** Integer arithmetic only, `checked_*`, `u128` intermediates, floors everywhere. Every expected number in a test comes from `tests/vectors.json`. Edit only the files under "Files you own"; add lines to shared files, never remove others'. If the spec is silent, ask the orchestrator and wait.

## Scope and steps (as shipped)

**Files you own:** `programs/macropaths/src/chain.rs`, `programs/macropaths/tests/chain_vectors.rs`, `pub mod chain;` in `lib.rs`. You do not own `docs/commitment-chain.md`, `tests/make_vectors.py`, `tests/vectors.json`, `keeper/src/prepare.ts` or `keeper/src/prepare.test.ts`: those are Dev's and Phill's, authoritative on main, and must stay byte-identical to `origin/main`.
1. `chain.rs`: `end_hash`, `obs_hash` on `solana_sha256_hasher::hashv`; `dataset_preimage` and `dataset_id` for tests.
2. `chain_vectors.rs`: read `vectors.json`; assert `end_hash == commitment.C_N`, rebuild `dataset_id` from the term sheet and assert it equals `commitment.dataset_id`, and assert `obs_hash` for every row equals that row's `C_i`.

## Acceptance and hand-off

**Acceptance:** `cargo test -p macropaths chain_` green; `pixi run vectors` prints `D=66191 A=691184 827387 863980` and the committed `dataset_id`, `C_0`, `C_N`; then `git checkout tests/vectors.json`.
