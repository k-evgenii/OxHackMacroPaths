# 10 lifecycle

**Goal.** Run the whole base lifecycle in LiteSVM and on a local Surfnet, assert the conservation invariants at every stage, and measure compute and wall-clock. This is the gate G1/G2 test.

**Branch and worktree.** `agent/10-lifecycle`, worktree `~/wt/10-lifecycle` (see `agents/README.md` Setup). Wave 2.

**Read first.** `AGENTS.md`; `docs/program-spec.md` §1.8, §1.9; `agents/README.md` (PR template, conflict rules). Existing code to follow: `programs/macropaths/tests/common/mod.rs` (harness, after 01 merges) and the instruction files already in `programs/macropaths/src/instructions/`.

**May assume merged.** 04, 05, 06, 07, 08, 09. Do not start before the orchestrator has posted `main moved` for those. Rebase on `main` whenever it posts again.

**Before step 1.** In your worktree: `pixi install --locked && anchor build && cargo test -p macropaths` green.

**Rules.** Integer arithmetic only, `checked_*`, `u128` intermediates, floors everywhere. Every expected number in a test comes from `tests/vectors.json`. Edit only the files under "Files you own"; add lines to shared files, never remove others'. If the spec is silent, ask the orchestrator and wait.

## Scope and steps

**Files you own:** `tests/lifecycle.rs`, `tests/integration/lifecycle.test.ts`, `docs/compute-budget.md`.
1. One Rust test running the whole base path: create, seed, two buyers deposit, lock, 48 observes, settle, both claims, seeder claim, sweep; assert §1.9 invariants after every stage; assert final per-wallet balances equal the vectors' worked example; print total CU and the max CU of a single `observe`.
2. One-product variant: same but buyer deposits only on product 0. This is the **G1 test**.
3. Surfpool: TypeScript test in `tests/integration/` using `@anchor-lang/core` and `packages/client/idl.json`: deploy to local Surfnet (`surfpool start` per `tests/integration/test_surfpool_smoke.py` pattern), run the same path with 48 observes sent through Phill's `keeper/src/tx.ts` `sendWithRetry`; measure wall-clock of the 48 observes at 0 ms spacing and at 2000 ms spacing; write both numbers to `docs/compute-budget.md`.

## Acceptance and hand-off

**Acceptance:** `cargo test -p macropaths lifecycle`; `pixi run test-surfpool` green. Hand-off includes both timings and `G1 candidate: pass/fail`.

Open a PR with the template in `agents/README.md`, paste the acceptance output verbatim, then post the Hand-off line in chat with the commit SHA.
