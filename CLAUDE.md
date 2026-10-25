# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

MacroPaths (OxHack '26) is a Solana program, written in Anchor 1.0.2, that pays a graded share of a two-sided pool according to the **path** US CPI year-on-year inflation takes over 48 months. The months are replayed on-chain from a historical dataset committed before anyone deposits. There are two products:

- **Inflation Cooling** (product 0): the largest decline from an earlier peak, capped at `d_cap`.
- **Excess Inflation** (product 1): inflation above 4% (`k`), accumulated month by month and capped at `a_cap`.

A funded single-seller "cover" extension sits on top. The design is deliberately **not** a prediction market, AMM, order book, LP vault or per-user matched book; don't reintroduce any of them. In code, comments and docs, never write "fair value", "bet", "option" or "insurance". Use "forecast", "position" and "cover".

The specification is `docs/program-spec.md`. Agent rules are in `AGENTS.md`, plus `.cursor/rules/program.mdc`. Decisions are recorded in `docs/DECISIONS.md`, and the deployed program and sessions in `docs/deployments.md`. `docs/verify.md` recomputes session A's hashes, scores and the worked payout by hand; `docs/security-review.md` is the countersigned review.

**The deployed program is fixed.** Devnet `FvT786RtMTtbdXWemA9zgA9rfwhvxFsKY1ypiMMNwMbS` runs commit `dab88ff`; reference session A (`B89zLL…BVju`) is settled at 827387 / 863980 and is read-only. Don't deploy, upgrade, settle another session or spend SOL unless asked.

## Branches

- **`cursor_main` is the integration branch.** Work branches from it (`agent/NN-name`, `phill/<task>`, …), and PRs target it.
- **`main` only moves forward to `cursor_main`** at team gates. Never push to `main`.
- **Research lives on `evgenii/macro-research`**: `research/`, `forecast/`, notebooks. Keep it off `cursor_main`; research PRs target that branch. (PR #32's backtest commits also reached `main`.)
- **The frontend lives on `evgenii/frontend`**: `web/` (Next.js) and the UI parts of `packages/client/`. Frontend PRs target that branch; `cursor_main` has no `web/`.
- **Shared program files** (`lib.rs`, `instructions.rs`, `error.rs`, `events.rs`) are add-only: never remove or reorder someone else's lines. `state.rs` and `constants.rs` have owners, so ask before changing them.

## Toolchain (non-obvious)

- **`pixi run prepare` and `pixi run forecast`** point at `data/prepare.py` and `forecast/ar1.py`, which are on no branch yet; both tasks fail.
- **Pixi for everything:** `pixi install --locked`, then `pixi run <cmd>` or `pixi shell`. Node 20 and the Python 3.12 stack only exist inside pixi; outside it you get system Node 18. Don't edit `pixi.toml` or `pixi.lock` casually. There is no CI.
- **Rust comes from rustup, not pixi.** `rust-toolchain.toml` pins 1.89.0. Rust inside pixi shadows rustup's `cargo`, and `anchor build` then fails with `no such command: +1.89.0-sbpf-solana-…`.
- **Anchor CLI must be 1.0.2.** The Solana installer gives 1.1.2, so run `avm install 1.0.2 && avm use 1.0.2`. The crates are pinned `=1.0.2`; a bare `"1.0.2"` resolves to 1.2.x.
- **Program keypair.** In a fresh worktree, `target/deploy/macropaths-keypair.json` doesn't match `declare_id!`, so build with **`anchor build --ignore-keys`** and never change the declared ID. Only the deployer holds the real program keypair. Never commit `target/`, keypairs, `.env`, or anything in `data/` except `fetch.py` and `series.toml`.

## Commands

```bash
pixi install --locked
anchor build --ignore-keys                  # program .so + target/idl/macropaths.json (~3 min first time)
cargo test -p macropaths                    # Rust LiteSVM tests in programs/macropaths/tests/
cargo test -p macropaths --test observe     # one test file
cargo test -p macropaths <name_substring>   # tests matching a name
pixi run vectors                            # must print D=66191 A=691184 827387 863980
pixi run test                               # fast toolchain/repo checks (tests/env)
pixi run test-surfpool                      # slow: build, deploy to a local Surfnet, call it (pytest -m surfpool)
pixi run fetch                              # freeze FRED series into data/snapshots/ (gitignored)

# keeper (TypeScript)
pixi run npm --prefix keeper ci
pixi run npm --prefix keeper run typecheck
pixi run npx --prefix keeper tsx --test keeper/src/*.test.ts           # all keeper tests
pixi run npx --prefix keeper tsx --test keeper/src/session.test.ts      # one keeper test file
pixi run npx --prefix keeper tsx keeper/src/prepare.ts --check tests/vectors.json

# web (on evgenii/frontend); packages/client must be installed first (web depends on file:../packages/client)
(cd packages/client && pixi run npm ci) && cd web && pixi run npm ci
cp .env.example .env.local      # RPC_URL: a keyed devnet endpoint; the public one rate-limits getTransaction
pixi run npm run dev            # NEXT_PUBLIC_USE_FIXTURES=1 serves packages/client/fixtures with no RPC
pixi run npm test && pixi run npm run typecheck && pixi run npm run lint && pixi run npm run build
```

**The LiteSVM tests load `target/deploy/macropaths.so`, not your source.** After any program change, rebuild with `anchor build --ignore-keys` or `cargo-build-sbf`, or the tests run the old binary.

## Architecture

### One commitment chain, three implementations
Data flows from FRED into a hash chain, and three implementations must agree on it byte for byte:

- **Snapshots.** `data/fetch.py` freezes raw FRED CSVs as `data/snapshots/<ID>.json`, with `retrieved_at` and the raw file's sha256. It never overwrites a snapshot without `--refresh`. Sessions and `tests/vectors.json` were built from the frozen CPIAUCNS snapshot. FRED's CPIAUCNS has an **empty value for 2025-10**, so no window can span that month.
- **The three implementations:**
  - `tests/make_vectors.py`: the Python reference. It writes `tests/vectors.json` and leaves the file untouched if `dataset_id` is unchanged.
  - `keeper/src/prepare.ts`: TypeScript, BigInt. It writes `data/cpi-yoy-replay.json`, and `--check` diffs it against the vectors.
  - `programs/macropaths/src/chain.rs` and `math.rs`: Rust. They're pinned by `tests/chain_vectors.rs` and `tests/math_vectors.rs`, which read `vectors.json`.
- **The encoding** is in `docs/commitment-chain.md`; don't change it:
  - all integers are little-endian;
  - `dataset_id` hashes the source, window, transform, 60 levels, N, first period, K and both caps;
  - `C_N = SHA256("PATH-END-v1" ‖ dataset_id ‖ u32 N)`;
  - `C_i = SHA256("PATH-OBS-v1" ‖ dataset_id ‖ u32 i ‖ u32 period ‖ i64 value ‖ C_{i+1})`.
- **Test values always come from `tests/vectors.json`.** Never type a reference number from memory.

### Units and integer discipline
- `x_t`, `k`, caps and Cooling's D are in 1e-4 percentage points (32500 = 3.25%). The Excess accumulator A is in 1e-4 pp-months. Scores and prices are millionths (`ONE = 1_000_000`). PLAY has 6 decimals.
- On-chain maths is `i64`/`u64` with `checked_*` and `u128` intermediates. Every division floors (`div_euclid` for signed values). No floats near chain values in any language.
- **Settlement uses side-level budgets:** `M = min(S0,S1)`, `P0 = floor(2·M·s/ONE)`, `P1 = 2M − P0`, `R_j = S_j − M`, `claim = floor(a·R_j/S_j) + floor(a·P_j/S_j)`. Dust stays in the vault.
- **Cover:** buyer pays `ceil(p·U/ONE)`, seller escrows `U − premium`, the buyer's payout is `floor(s·U/ONE)`, and the quote `p` must be in [0.05, 0.95].

### Program (`programs/macropaths`)
- **PDAs:** session `["session", authority, session_id u64 LE]`; vaults `["vault", session, [0|1]]`, one per product; position `["position", session, owner]`.
- **State machine:**
  - `create_session` → Open;
  - `deposit`, then `lock_and_start` (inside the deposit window) → Running;
  - 48 × `observe` → `settle` → Settled;
  - `expire_incomplete` → Refunding, once a deadline has passed or the chain can't complete;
  - `claim` and `sweep_dust` close things out;
  - extension: `seller_fund`, `set_entry_quote`, `buy_cover`, `claim_cover`, `seller_settle`, `seller_withdraw`.
- **`observe` is permissionless.** Each row must open the stored commitment, and the last row must land exactly on `terminal`.
- **`Session` is a fixed 913-byte account** (it ends in `_reserved: [u8; 64]`). Anchor rejects an account shorter than the struct (`AccountDidNotDeserialize`), so **never grow `Session` in a program that is already deployed**: existing sessions become unusable. Add a new account type instead.
- The TS client and keeper read **`packages/client/idl.json`**. Regenerate it from `target/idl/` when the program's interface changes.

### Keeper (`keeper/`)
- **Stack:** `@solana/web3.js` v1 and `@anchor-lang/core`, chosen over Kit, Codama and others.
- **Everything is encoded through `BorshCoder`** from the IDL, so nothing hard-codes a field width. `session.ts` `checkIdl` refuses a `create_session` whose args don't match.
- **Config:** `.env` provides `RPC_URL` and `KEEPER_KEYPAIR` (a path); `DOTENV_PATH` overrides it. `env.ts` never prints secret values.
- **Flow:**
  1. `prepare.ts`.
  2. `npm run session:create` (`run.ts`): mint, `create_session`, a field-by-field read-back, then seed the sides. Writes `data/session.json`. Without `--session-id` the id is the cluster time, so it refuses to replace an existing `data/session.json` unless given `--session-id`, another `--out`, or `--force`.
  3. `npm run admin -- lock`.
  4. `npm run replay`: resumes from `Session.next_index`.
  5. `npm run admin -- settle`, then `status`, `claim` (defaults to the keeper's own position), expire and sweep. `seller.ts` drives the cover side (`admin -- seller fund|quote|buy|claim-cover|settle|withdraw`); `sweep` refuses until every cover is claimed, so run `seller claim-cover --keypair <buyer>` first.
  - `keeper/README.md` has the local Surfpool demo and the devnet runbook (explicit `--session-id`, seller steps before `lock`).
- **`--session-file`** selects a session other than the default `data/session.json`.
- **`tx.ts` `sendAndConfirmWithRetry`** only rebuilds a transaction after its blockhash has provably expired, so it can't double-post.
- **`replay.ts` saves each signature to `data/replay-pending.json` before broadcasting.** That file is shared, so replay one session at a time.
- **Local runs use Surfpool.** `npm run program:load` writes a `.so` into Surfpool at the program address via the `surfnet_writeProgram` cheatcode, so no program keypair is needed. The smoke scripts refuse any RPC host that isn't localhost.

### Research (on `evgenii/macro-research`)
- `research/macrolib.py` holds loaders, AR(1)/OU fitting and simulation. **`fit_ou(until=…)` includes `until`**, so pass `t0 − 1` for a forecast made at `t0`.
- `research/build_notebook.py` generates the notebook; edit it, not the `.ipynb`.
- `forecast/backtest.py` (tests in `tests/research/`; added by PR #32) is the rolling-origin backtest. Its JSON and Markdown report are generated, so rerun the script rather than editing them.
- Floats are fine in research code, but realised outcomes use the exact integer maths in `make_vectors.py`. The model's expected score is a forecast, not a price; the seller's quote is a separate declared policy.
