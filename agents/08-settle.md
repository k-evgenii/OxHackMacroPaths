# 08 settle

**Goal.** Fill settle: scores from the accumulated statistics and side-level budgets per product.

**Branch and worktree.** `agent/08-settle`, worktree `~/wt/08-settle` (see `agents/README.md` Setup). Wave 1.

**Read first.** `AGENTS.md`; `docs/program-spec.md` §1.8 settle, §1.5; `agents/README.md` (PR template, conflict rules). Existing code to follow: `programs/macropaths/tests/common/mod.rs` (harness, after 01 merges) and the instruction files already in `programs/macropaths/src/instructions/`.

**May assume merged.** 01, 02. Do not start before the orchestrator has posted `main moved` for those. Rebase on `main` whenever it posts again.

**Before step 1.** In your worktree: `pixi install --locked && anchor build && cargo test -p macropaths` green.

**Rules.** Integer arithmetic only, `checked_*`, `u128` intermediates, floors everywhere. Every expected number in a test comes from `tests/vectors.json`. Edit only the files under "Files you own"; add lines to shared files, never remove others'. If the spec is silent, ask the orchestrator and wait.

## Scope and steps

**Files you own:** `instructions/settle.rs`, `tests/settle.rs`.
1. Fill handler per §1.8.
2. Tests: (a) seed `[90,100,90,100]`, lock, observe all 48 real rows (`observe_all`, built from `vectors.json.chain` and `vectors.json.commitment`), settle → `scores == [827387, 863980]`, `p_budget`, `r_budget` equal `side_budgets` of the vectors' `worked_example` numbers scaled to the seeds (compute expected in the test with `math::side_budgets`), state Settled, `Settled` event present in logs; (b) settle at `next_index == 47` → `ChainIncomplete`; (c) settle in Open → `WrongState`; (d) settle twice → `WrongState`.

## Acceptance and hand-off

**Acceptance:** `cargo test -p macropaths settle`; hand-off includes `827387 863980`.

Open a PR with the template in `agents/README.md`, paste the acceptance output verbatim, then post the Hand-off line in chat with the commit SHA.
