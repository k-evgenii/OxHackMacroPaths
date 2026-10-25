# 02 math

**Goal.** Implement the pure integer maths of the contract and pin it to tests/vectors.json, including a 10,000-case conservation property.

**Branch and worktree.** `agent/02-math`, worktree `~/wt/02-math` (see `agents/README.md` Setup). Wave 0.

**Read first.** `AGENTS.md`; `docs/program-spec.md` §1.5, §1.1; `agents/README.md` (PR template, conflict rules). Existing code to follow: `programs/macropaths/tests/common/mod.rs` (harness, after 01 merges) and the instruction files already in `programs/macropaths/src/instructions/`.

**May assume merged.** none. Do not start before the orchestrator has posted `main moved` for those. Rebase on `main` whenever it posts again.

**Before step 1.** In your worktree: `pixi install --locked && anchor build && cargo test -p macropaths` green.

**Rules.** Integer arithmetic only, `checked_*`, `u128` intermediates, floors everywhere. Every expected number in a test comes from `tests/vectors.json`. Edit only the files under "Files you own"; add lines to shared files, never remove others'. If the spec is silent, ask the orchestrator and wait.

## Scope and steps

**Files you own:** `programs/macropaths/src/math.rs`, `programs/macropaths/tests/math_vectors.rs`, `programs/macropaths/tests/math_conservation.rs`, `pub mod math;` line in `lib.rs`.
1. Write `math.rs` with the seven functions in §1.5, signatures exact, `u128` intermediates, no `as` casts that can truncate (use `u64::try_from`).
2. `math_vectors.rs`: load `tests/vectors.json` (path `concat!(env!("CARGO_MANIFEST_DIR"), "/../../tests/vectors.json")`). Tests, one per block: (a) replay `rows[].x` through `step_cooling`/`step_excess` from `peak = i64::MIN, 0, 0` and assert each row's `running` M, D, A; (b) `final` D, A, s1, s2 and `s2_cap40` via `score`; (c) every `annual_slices` entry; (d) every `synthetic` path; (e) `threshold` cases; (f) `budget_3v2`: `side_budgets(3,2,0) == (0,4,1,0)`, claims `[0,0,4]`, dust 1; (g) `worked_example`: both products' P, R, `buyer_claim`, and `buyer_total == 33827340`; (h) `cover_split(500000, 3) == (2, 1)`, `cover_split(ONE, 10) == (10, 0)`, `cover_claim(827387, 20_000_000) == 16_547_740`.
3. `math_conservation.rs` with `proptest!` 10,000 cases: random `S0,S1 ∈ [0, 1e12]`, `s ∈ [0, ONE]`, each side split into 1–8 random deposits summing to `S_j`; assert per-side `Σ claim ≤ R_j + P_j`, total `≤ S0+S1`, and `P0+P1 == 2·min(S0,S1)`. Second property: for random `p, units`, `cover_split` parts sum to `units` and `buyer ≥ p·units/ONE`.
4. Add `pub mod math;` to `lib.rs` (one line; union-merge safe).

## Acceptance and hand-off

**Acceptance:** `cargo test -p macropaths math_` green, output shows `D=66191 A=691184` in a `println!` of test (b). Hand-off: `agent 02 done: agent/02-math <sha> N tests passing`.

Open a PR with the template in `agents/README.md`, paste the acceptance output verbatim, then post the Hand-off line in chat with the commit SHA.
