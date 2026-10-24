# 14 keeper-bridge

**Status.** Rewritten after Phill shipped the keeper on main (PRs #14, #21, #22). The original brief described `run.ts`, `replay.ts` and `admin.ts`; Phill wrote all three, with resume and a pending-file guard against double posts. Do not rewrite them. What remains is below.

**Goal.** Make Phill's keeper target the one program on `cursor_main` and complete the admin surface: drop the dual `create_session` layout, add the missing admin subcommands, add the seller callers if the extension is on, and run the full keeper path once on a local Surfnet.

**Branch and worktree.** `agent/14-keeper-bridge`, worktree `~/wt/14-keeper-bridge`. Wave 4.

**Read first.** `AGENTS.md`; `docs/program-spec.md` §1.2, §1.8; `docs/DECISIONS.md` (the two entries about layouts); `keeper/README.md`; `keeper/src/session.ts`, `ops.ts`, `program.ts`, `admin.ts`, `replay.ts`, `run.ts`, `tx.ts`, `env.ts`; `tests/integration/test_keeper_lifecycle.py` from agent 10.

**May assume merged.** Agent 10, and `origin/main` including Phill's keeper. Seller subcommands only after agent 13 is merged and `cursor_main moved: 13-cover` is posted. Dev has agreed `cursor_main`'s flat layout is the program (orchestrator confirms in chat before you start step 1).

**Before step 1.** `git fetch origin && git switch -C agent/14-keeper-bridge origin/cursor_main`, then `pixi install --locked && anchor build && pixi run npm --prefix keeper ci && pixi run npm --prefix keeper run typecheck`.

**Rules.** The package is ESM: imports end in `.js`. Run scripts as `pixi run npm --prefix keeper run <script> -- <args>`. Do not change `tx.ts` or `env.ts`. Every transaction goes through `sendAndConfirmWithRetry`. Keep Phill's CLI flags; add, never rename. Tell Phill in chat what you changed in his files, with the commit SHA.

## Scope and steps

**Files you own:** `keeper/src/session.ts`, `keeper/src/ops.ts`, `keeper/src/admin.ts`, `keeper/src/seller.ts` (new, extension only), `keeper/src/session.test.ts`, `keeper/README.md`, `docs/DECISIONS.md` (one new entry).

1. **One layout.** Remove the `params` branch from `session.ts` (`detectLayout`, `createSessionArgs`, `expectedSession`, `seriesCode` if unused) and the `--controller` option from `run.ts`'s help text if it only applied to that layout. `detectLayout` becomes a check that the IDL is the flat layout and throws otherwise. Update `session.test.ts`. Add a `docs/DECISIONS.md` entry on top: "cursor_main flat layout is the program; params layout removed; see PR #7 discussion", decided by Evgenii and Dev, date.
2. **Admin subcommands.** Add `expire` (calls `expire_incomplete`) and `sweep -- --treasury <pubkey>` (calls `sweep_dust`) to `admin.ts` via `ops.ts`, following `lockSession`/`settleSession`. `status` prints `scores`, `p_budget`, `r_budget`, `claimed_count/position_count` and the four side totals in PLAY.
3. **Claim from the CLI.** Add `admin -- claim --keypair <file>` so the demo can claim from a second wallet without the frontend. Uses `positionPda` from `program.ts`.
4. **Seller callers, only if 13 is merged.** `keeper/src/seller.ts` with `fund <amount>`, `quote --p0 <millionths> --p1 <millionths>` (and `--from-forecast forecast/table.json` applying `p = clamp(V + 0.5σ, 0.05, 0.95)` if that file exists), `buy --product <0|1> --units <n> --keypair <buyer>`, `settle --product <0|1>`, `withdraw <amount>`. Wire them as `admin -- seller <sub>`.
5. **End to end on Surfnet.** Rerun agent 10's `tests/integration/test_keeper_lifecycle.py` on your branch; extend it with `admin -- claim` for the buyer and `admin -- sweep`, and with the seller path if step 4 was done. Record the wall-clock in `docs/compute-budget.md` under a new heading.
6. **README.** Update `keeper/README.md`: the command sequence for a demo run, start to finish, in order, with the expected console line after each.

## Acceptance and hand-off

**Acceptance:** `pixi run npm --prefix keeper run typecheck` clean; keeper unit tests green; `pixi run test-surfpool` green including the extended lifecycle test; `grep -rn "params" keeper/src/session.ts` finds no layout branch.

Open a PR into `cursor_main`, paste the Surfnet run output, and post the Hand-off line with the SHA and the replay wall-clock. Tell Phill.
