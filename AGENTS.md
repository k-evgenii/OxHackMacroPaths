# MacroPaths: rules for every agent

You are one of fifteen agents building the MacroPaths Solana program for OxHack '26. Your brief is in `agents/NN-name.md`. The program specification is `docs/program-spec.md`. Read both before touching a file. Where the spec is silent, ask the orchestrator in the team chat and wait; do not design.

## What this is

A path-dependent contract on US CPI year-on-year inflation, settled by an O(1) integer recursion over a committed data replay. Two products: Inflation Cooling (largest decline from an earlier peak) and Excess Inflation (accumulated inflation above 4%). Two-sided pool with side-level budgets, plus a funded single-seller extension.

It is **not** a prediction market, an AMM, an order book, a liquidity pool, or a per-user matched book. Those were rejected after review. Do not reintroduce them. Do not use the words "fair value", "bet", "option" or "insurance" in code, comments or docs; say "forecast", "position", "cover".

## Environment

- Work in WSL under `~/wt/NN-name` (a git worktree). Never under `/mnt/d`.
- Anchor CLI **1.0.2** (`anchor --version`); crates pinned `=1.0.2`; Rust from rustup via `rust-toolchain.toml`; Node via `pixi run ...`. If a command fails, read `TOOLCHAIN.md` and `ANCHOR.md` before trying anything else.
- Before step 1 of your brief: `pixi install --locked && anchor build && cargo test -p macropaths` must pass in your worktree.
- Never commit `target/`, keypairs, `.env`, or `data/` contents other than `fetch.py` and `series.toml`.

## Integer discipline (non-negotiable)

- All on-chain arithmetic is `i64`/`u64` with `checked_*` and `u128` intermediates. No floats anywhere in Rust, TypeScript or Python that touches a chain value.
- Scores and prices are millionths (`ONE = 1_000_000`). `x_t`, `k`, caps and the cooling statistics are in 1e-4 percentage points (`32500` = 3.25%). The excess accumulator is in 1e-4 pp-months. PLAY has 6 decimals.
- Every division floors. `div_euclid` for signed values.
- Settlement uses side-level budgets, never per-user floor matching:
  `M = min(S0,S1)`, `P0 = floor(2·M·s / ONE)`, `P1 = 2M − P0`, `R_j = S_j − M`,
  `claim = floor(a·R_j/S_j) + floor(a·P_j/S_j)`. Dust stays in the vault.
- Cover: `buyer_pays = ceil(p·units/ONE)`, `seller_pays = units − buyer_pays`; `claim_cover = floor(s·units/ONE)`; seller remainder `= n_sold − floor(s·n_sold/ONE)`.
- Every number in a test comes from `tests/vectors.json`. Never type a reference value from memory.

## Security baseline for any instruction that moves tokens

Before any transfer: PDA seeds and bump checked, account owner checked, mint checked, token program is `anchor_spl::token::ID`, the right signer, session state checked, deadline checked. `vault_0 != vault_1`. `init_if_needed` accounts detect first use by `owner == Pubkey::default()`.

## Branch protocol

- Branch `agent/NN-name` from `cursor_main`, one PR per agent. Rebase on `cursor_main` when the orchestrator posts `cursor_main moved`.
- Edit only the files listed under "Files you own" in your brief. `lib.rs`, `instructions.rs`, `error.rs`, `events.rs` are shared: add lines, never remove or reorder others' lines. `state.rs` and `constants.rs` are owned by agents 01 and 12 only; if you need a field, constant or error variant, ask in chat.
- Commit messages: what and why, one logical change per commit.
- Done means the Acceptance commands in your brief pass and you posted the Hand-off line in chat with the commit SHA.

## Skills and tools available to you

- `.cursor/skills/solana-anchor-reference`: open its `SKILL.md` first; it says which reference file answers which question and lists the team's stack decisions that override the reference material (web3.js v1 and `@anchor-lang/core`, no Kit, no Codama, no Pinocchio, no Trident).
- `.cursor/skills/solana-vulnerability-scanner`: the audit checklist, used by agent 11 and anyone touching a token transfer.
- Solana MCP server (`.cursor/mcp.json`): documentation lookup. Use it for API questions before guessing.

## Commands

```
anchor build                      # also regenerates target/idl/macropaths.json
cargo test -p macropaths          # LiteSVM tests in programs/macropaths/tests
cargo test -p macropaths <name>   # one test file
pixi run vectors                  # must always print: D=66191 A=691184 827387 863980
pixi run test-surfpool            # local Surfnet integration (agents 10, 14 only)
```
