# 01 skeleton

**Goal.** Lay down every account, error, event and instruction signature, plus the shared LiteSVM test harness, so six agents can fill handlers in parallel without touching shared files.

**Branch and worktree.** `agent/01-skeleton`, worktree `~/wt/01-skeleton` (see `agents/README.md` Setup). Wave 0.

**Read first.** `AGENTS.md`; `docs/program-spec.md` §1.1–1.4, §1.8 (account lists only), §1.10; `agents/README.md` (PR template, conflict rules). Existing code to follow: `programs/macropaths/tests/common/mod.rs` (harness, after 01 merges) and the instruction files already in `programs/macropaths/src/instructions/`.

**May assume merged.** none. Do not start before the orchestrator has posted `main moved` for those. Rebase on `main` whenever it posts again.

**Before step 1.** In your worktree: `pixi install --locked && anchor build && cargo test -p macropaths` green.

**Rules.** Integer arithmetic only, `checked_*`, `u128` intermediates, floors everywhere. Every expected number in a test comes from `tests/vectors.json`. Edit only the files under "Files you own"; add lines to shared files, never remove others'. If the spec is silent, ask the orchestrator and wait.

## Scope and steps

**Files you own:** `programs/macropaths/src/{constants.rs,state.rs,error.rs,events.rs,lib.rs,instructions.rs}`, `programs/macropaths/src/instructions/*.rs` (stubs only), `programs/macropaths/tests/common/mod.rs`, `programs/macropaths/Cargo.toml` (dev-deps only), `packages/client/idl.json`, and the three template tests that call `initialize`: `tests/macropaths.ts`, `tests/integration/initialize.test.ts`, `tests/integration/test_surfpool_smoke.py` (the `test_client_calls_initialize` case only).
1. Delete `instructions/initialize.rs`, the `initialize` entry in `lib.rs`, and `programs/macropaths/tests/test_initialize.rs`. Replace the three template tests that call `initialize` so nothing references it: `tests/macropaths.ts` becomes a test that loads the workspace program and asserts `program.idl.instructions.length === 14`; `tests/integration/initialize.test.ts` is renamed `idl.test.ts` and asserts the same against the deployed program's IDL; in `tests/integration/test_surfpool_smoke.py` point `test_client_calls_initialize` at `idl.test.ts` and rename it `test_client_reads_idl`.
2. Write `constants.rs` exactly as spec §1.1.
3. Write `state.rs` exactly as §1.2, with `InitSpace` derives and a `impl Session { pub fn signer_seeds(&self) -> [&[u8]; 4] }` helper returning the four seed slices.
4. Write `error.rs` with every variant in §1.3 and a `#[msg]` per variant.
5. Write `events.rs` as §1.4.
6. For each of the 14 instructions in §1.8, create `instructions/<name>.rs` with the full `#[derive(Accounts)]` struct exactly as the spec's account list (seeds, bumps, `has_one`, `token::mint`, `token::authority`, `mut`, `init`/`init_if_needed` with `payer` and `space = 8 + T::INIT_SPACE`), and `pub fn handler(ctx, args) -> Result<()> { Ok(()) }`. Account constraints are the real ones now; logic is empty.
7. `instructions.rs` re-exports all 14; `lib.rs` declares all 14 entry points with the exact argument names and types from §1.8.
8. Add dev-dependencies `litesvm-token`, `serde_json`, `proptest`. Keep `litesvm = "0.10.0"` and the four `solana-*` crates.
9. Write `tests/common/mod.rs` with every function in §1.10. `env()` must create the PLAY mint with 6 decimals. `set_time` writes a `Clock` with the given `unix_timestamp`.
10. Write `tests/harness_smoke.rs`: `env()` succeeds, `ata_with` mints 1 PLAY and `token_balance` reads `1_000_000`, `set_time(1_700_000_000)` then reading Clock from a dummy transaction log is not required; just assert no panic.
11. `anchor build`; copy `target/idl/macropaths.json` to `packages/client/idl.json`.

## Acceptance and hand-off

**Acceptance:** `anchor build && cargo test -p macropaths` green (harness_smoke), IDL lists 14 instructions and 5 accounts. Hand-off: `agent 01 done: agent/01-skeleton <sha> harness_smoke passing, IDL committed`.

Open a PR with the template in `agents/README.md`, paste the acceptance output verbatim, then post the Hand-off line in chat with the commit SHA.
