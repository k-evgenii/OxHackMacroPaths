# 14 keeper-bridge

**Goal.** Write the keeper scripts that create a session, replay the 48 observations with resume, and run the admin and seller calls, on top of Phill's env.ts and tx.ts.

**Branch and worktree.** `agent/14-keeper-bridge`, worktree `~/wt/14-keeper-bridge` (see `agents/README.md` Setup). Wave 4.

**Read first.** `AGENTS.md`; `docs/program-spec.md` §1.2 seeds, §1.8 argument lists; `agents/README.md` (PR template, conflict rules). Existing code to follow: `programs/macropaths/tests/common/mod.rs` (harness, after 01 merges) and the instruction files already in `programs/macropaths/src/instructions/`.

**May assume merged.** 10 (seller subcommands: 13). Do not start before the orchestrator has posted `main moved` for those. Rebase on `main` whenever it posts again.

**Before step 1.** In your worktree: `pixi install --locked && anchor build && cargo test -p macropaths` green.

**Rules.** Integer arithmetic only, `checked_*`, `u128` intermediates, floors everywhere. Every expected number in a test comes from `tests/vectors.json`. Edit only the files under "Files you own"; add lines to shared files, never remove others'. If the spec is silent, ask the orchestrator and wait.

## Scope and steps

**Files you own:** `keeper/src/run.ts`, `keeper/src/replay.ts`, `keeper/src/admin.ts`, `keeper/src/client.ts` (Anchor Program from `packages/client/idl.json`), `keeper/README.md` (usage section). Do not edit `env.ts` or `tx.ts` (Phill's, commit f123748); use them.
**Package facts:** `keeper/` is ESM (`"type": "module"`, imports end in `.js`), has its own lockfile, runs as `pixi run npm --prefix keeper run tsx <file>`; deps already present: `@anchor-lang/core`, `@solana/web3.js` v1, `@solana/spl-token`, `dotenv`.
1. `client.ts`: load IDL, build `Program` with `AnchorProvider` from `getConnection()` and `loadKeypair()` in `env.ts`; export PDA helpers mirroring §1.2 seeds. The keeper keypair **is the session authority** (it signs `lock_and_start`, `set_entry_quote`, `sweep_dust`).
2. `run.ts`: create PLAY mint (6 dp) with `@solana/spl-token` or reuse `PLAY_MINT` from `.env`; read `data/cpi-yoy-replay.json`; `create_session` with `k=40000, d_cap=80000, a_cap=800000`, deadlines now+30 min / now+2 h, `dataset_id`, `c0`, `terminal`; mint 1,000 PLAY to a seeder wallet and deposit `[90,100,90,100]` PLAY; print session address and write it to `.env.session`.
3. `replay.ts`: read `Session.next_index`; for `i` from there to 47 send `observe(i, period_id, x, next_commitment)` via `sendAndConfirmWithRetry` from `tx.ts`. Rules imposed by `tx.ts`: the `TxBuilder` for row `i` must be a pure function of `i` (it may be called again with a fresh blockhash after an expiry); on `TransactionFailedError` whose logs contain the program's `WrongIndex` code, re-read `next_index` and continue (a transaction landed between kill and restart); any other `TransactionFailedError` aborts with logs printed. Confirm each row before the next, `--spacing-ms` (default 2000); print index, value, signature.
4. `admin.ts`: subcommands `lock`, `settle`, `expire`, `sweep`, and (if 13 merged) `seller-fund <amount>`, `quote` (reads `forecast/table.json` row 0, `p = clamp(V + 0.5σ, 0.05, 0.95)` to millionths; if the file is missing, take `--p0 --p1` flags), `seller-settle <product>`, `seller-withdraw <amount>`.
5. Run the whole thing against a local Surfnet: run → lock → replay → settle → a claim from a second keypair → sweep; then kill replay at row 20 and restart; document both in `keeper/README.md`.

## Acceptance and hand-off

**Acceptance:** local Surfnet end-to-end settles to `827387 / 863980`; resume works. Hand-off includes replay wall-clock.

Open a PR with the template in `agents/README.md`, paste the acceptance output verbatim, then post the Hand-off line in chat with the commit SHA.
