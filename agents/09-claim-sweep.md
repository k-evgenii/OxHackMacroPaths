# 09 claim-sweep

**Goal.** Fill claim (settled and refund branches) and sweep_dust, and prove conservation on-chain.

**Branch and worktree.** `agent/09-claim-sweep`, worktree `~/wt/09-claim-sweep` (see `agents/README.md` Setup). Wave 1.

**Read first.** `AGENTS.md`; `docs/program-spec.md` §1.8 claim, sweep_dust; §1.5; §1.9; `agents/README.md` (PR template, conflict rules). Existing code to follow: `programs/macropaths/tests/common/mod.rs` (harness, after 01 merges) and the instruction files already in `programs/macropaths/src/instructions/`.

**May assume merged.** 01, 02. Do not start before the orchestrator has posted `main moved` for those. Rebase on `main` whenever it posts again.

**Before step 1.** In your worktree: `pixi install --locked && anchor build && cargo test -p macropaths` green.

**Rules.** Integer arithmetic only, `checked_*`, `u128` intermediates, floors everywhere. Every expected number in a test comes from `tests/vectors.json`. Edit only the files under "Files you own"; add lines to shared files, never remove others'. If the spec is silent, ask the orchestrator and wait.

## Scope and steps

**Files you own:** `instructions/claim.rs`, `instructions/sweep_dust.rs`, `tests/claim_sweep.rs`.
1. Fill both handlers per §1.8.
2. Tests: (a) **3-vs-2 on-chain**: three wallets deposit `[1,0,0,0]`, `[2,0,0,0]`, `[0,2,0,0]` base units and a fourth wallet deposits `[0,0,1,1]` so lock passes; replay the real 48 rows; settle; each wallet claims. Assert every claim equals `math::claim_amount(deposited[j], r_budget[j], p_budget[j], side_totals[j])` read from the on-chain budgets, that total paid ≤ total deposited, and vault dust ≥ 0. (The exact `s = 0` arithmetic of `budget_3v2` is already pinned in agent 02's unit tests.) (b) worked example: seed `[90,100,90,100]` by a seeder, buyer deposits `[10,0,10,0]`, full replay, settle, buyer claims `33_827_340` exactly; (c) double claim → `AlreadyClaimed`; (d) claim in Running → `WrongState`; (e) refund path: deposit, expire via deadline, claim returns exact deposits; (f) zero-payout position: in (b) add a wallet that deposits 1 base unit on side 1 of product 0 (`[0,1,0,0]`); after settlement its `claim_amount` is 0 (floor); claiming must still succeed, set `claimed = true` and increment `claimed_count`; (g) `sweep_dust` before all claimed → `NotAllClaimed`; after all claimed → vaults empty and treasury received the dust; non-authority → constraint failure.

## Acceptance and hand-off

**Acceptance:** `cargo test -p macropaths claim_sweep`; hand-off includes `33827340`.

Open a PR with the template in `agents/README.md`, paste the acceptance output verbatim, then post the Hand-off line in chat with the commit SHA.
