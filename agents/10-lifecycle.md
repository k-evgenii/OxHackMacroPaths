# 10 lifecycle

**Goal.** Prove that the six wave 1 instructions work together. Every wave 1 agent tested its instruction in isolation against fixtures; nobody has yet run create → deposit → lock → 48 × observe → settle → claim → sweep through the real instructions. You do that twice in LiteSVM (gates G1 and G2), then once more on a local Surfnet by driving Phill's keeper command line, which is the demo path.

**Branch and worktree.** `agent/10-lifecycle`, worktree `~/wt/10-lifecycle`. Wave 2.

**Read first.** `AGENTS.md`; `docs/program-spec.md` §1.8, §1.9, §1.11; `programs/macropaths/tests/common/mod.rs` (harness: `env`, `ata_with`, `create_session_default`, `seed_sides`, `observe_all`, `read`, `token_balance`); `programs/macropaths/tests/observe.rs` `series()` and `programs/macropaths/tests/settle.rs` `replay()` for how to turn `vectors.json` into the 48 observe rows; `tests/integration/test_surfpool_smoke.py` (how a Surfnet is started and the program loaded in pytest); `keeper/README.md` and the header comments of `keeper/src/run.ts`, `keeper/src/admin.ts`, `keeper/src/replay.ts`, `keeper/scripts/load-program.ts` (Phill's CLI; you call it, you do not edit it).

**May assume merged.** Wave 1 (04–09), agent 01b (`_reserved` padding, `u32` row index), and `origin/main` up to Phill's keeper PRs #14, #21, #22. Do not start before the orchestrator posts `cursor_main moved` naming all three. Check: `grep -n "next_index: u32" programs/macropaths/src/state.rs` prints a line, and `keeper/src/replay.ts` exists.

**Before step 1.** `git fetch origin && git switch -C agent/10-lifecycle origin/cursor_main`, then `pixi install --locked && anchor build && cargo test -p macropaths` (64 passed) and `pixi run npm --prefix keeper ci`.

**Rules.** Use the real instructions only: never `put_session`, `put_vaults` or `put_position` in this brief. Amounts are PLAY base units (1 PLAY = 1_000_000). Every expected number comes from `tests/vectors.json` (`final`, `worked_example`, `commitment`, `chain`). If a step fails, do not fix another agent's instruction: write the failing instruction, the error code and the logs into the PR, post it to the orchestrator, and stop that test. You may still finish the other tests. Edit only the files under "Files you own". Do not edit anything under `keeper/`.

## Scope and steps

**Files you own:** `programs/macropaths/tests/lifecycle.rs`, `tests/integration/test_keeper_lifecycle.py`, `docs/compute-budget.md`.

1. **`lifecycle_one_product` (gate G1).** `create_session_default`; a seeder deposits `[90, 100, 0, 0]` PLAY via `seed_sides`; a buyer deposits `[10, 0, 0, 0]` PLAY; product 1 gets `[0, 0, 1, 1]` from the seeder so lock passes (`EmptySide` otherwise); `lock_and_start` signed by `env.authority`; 48 observes via `observe_all` with rows built as in `settle.rs::replay()`; `settle`; buyer claims; seeder claims; `sweep_dust` to a treasury ATA (`ata_with(env, &treasury, 0)`). Assert after lock `matched == [90_000_000, 1_000_000]`; after settle `scores[0] == 827387`; buyer's product-0 claim equals `math::claim_amount(10_000_000, r_budget[0], p_budget[0], side_totals[0])` computed in the test from the on-chain budgets.
2. **`lifecycle_full` (gate G2).** Seeder `[90, 100, 90, 100]` PLAY, buyer `[10, 0, 10, 0]` PLAY, full replay, settle, both claim, sweep. Assert `scores == [827387, 863980]` and the buyer's balance rises by exactly `worked_example.buyer_total` (33_827_340). Assert the seeder's claim equals the sum of its four `claim_amount`s.
3. **Invariants after every stage, both tests** (§1.9): before any claim, `vault_0 + vault_1 == Σ side_totals`; after each claim, vault balances fell by exactly that claim; after all claims, `Σ paid ≤ Σ deposited` and each vault holds only dust `≥ 0`; after sweep both vaults are 0 and the treasury holds the dust; `claimed_count == position_count`.
4. **Compute units.** From each `observe`'s `TransactionMetadata.compute_units_consumed` record the max and the mean; also the CU of `settle` and of one `claim`. Print them and write them to `docs/compute-budget.md` with the date and the commit SHA.
5. **Keeper end-to-end on Surfnet (the demo path), `tests/integration/test_keeper_lifecycle.py`**, marked `@pytest.mark.surfpool`, reusing the `surfnet`, `built`, `payer` fixtures from `test_surfpool_smoke.py` (import them or copy the three fixtures; do not change that file). Steps the test runs as subprocesses, each with `DOTENV_PATH` pointing at a temp `.env` whose `RPC_URL` is the Surfnet and `KEEPER_KEYPAIR` is the payer:
   - generate the replay file if missing: `pixi run fetch` (needs network; if `data/snapshots/CPIAUCNS.json` already exists skip) then `pixi run npm --prefix keeper run tsx src/prepare.ts` so that `data/cpi-yoy-replay.json` exists;
   - `npm --prefix keeper run program:load -- target/deploy/macropaths.so <declared id>`;
   - `npm --prefix keeper run session:create -- --deposit-window 600 --replay-window 3600 --seed 90,100,90,100`;
   - `npm --prefix keeper run admin -- lock`;
   - `npm --prefix keeper run replay -- --interval-ms 2000`, timed; then a second run of the same session must print that nothing is left to post;
   - `npm --prefix keeper run admin -- settle`, then `admin -- status`, and assert the status output contains `827387` and `863980`.
   Record the wall-clock of the replay at `--interval-ms 2000` in `docs/compute-budget.md`. The keeper enforces a 2000 ms minimum, so there is no 0 ms measurement; note that instead.
6. **Recovery drill** inside the same pytest: start a replay with `--limit 20`, then run `replay` again without a limit and assert it continues from row 20 and finishes. Record the row count per run.

## Acceptance and hand-off

**Acceptance:** `cargo test -p macropaths lifecycle` shows `2 passed`; full `cargo test -p macropaths` green; `pixi run test-surfpool` green including `test_keeper_lifecycle.py`; `docs/compute-budget.md` has the CU numbers and the replay wall-clock.

Open a PR with the template in `agents/README.md`, paste the three outputs, and post the Hand-off line with the SHA and `G1 candidate: pass|fail`, `G2 candidate: pass|fail`. If either test failed because of another agent's instruction, the hand-off names the instruction and the error.
