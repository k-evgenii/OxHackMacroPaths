# MacroPaths keeper

Off-chain keeper (TypeScript, `@solana/web3.js` v1, `@anchor-lang/core` 1.0.2).
Run everything through pixi so Node 20 comes from the shared env.

```bash
pixi install --locked
pixi run npm --prefix keeper ci          # install deps from package-lock.json
pixi run npm --prefix keeper run typecheck
```

## Config

Copy `.env.example` to `.env` at the repo root and fill `RPC_URL` and `KEEPER_KEYPAIR`.
`src/env.ts` walks up from the cwd to the repo root to find `.env`, or loads
`DOTENV_PATH` if set. `KEEPER_KEYPAIR` supports `~`; relative paths resolve against the repo root.

```bash
pixi run npm --prefix keeper run env:check   # prints set/not set, RPC host, keeper pubkey; never secrets
```

## Modules

- `src/env.ts`: `getConfig()`, `loadKeypair()`, `getConnection()`, `describeEnv()`. Errors name the
  variable and never include its value. URLs are reduced to their hostname.
- `src/tx.ts`: `sendAndConfirmWithRetry(connection, buildTx, signers, opts)` and
  `getSignatureState()` / `isBlockhashExpired()` for resume logic. It only rebuilds a transaction once the
  previous one's blockhash is past the finalized block height and the signature is still unknown,
  so it cannot double-post. See the header comment.
- `src/session.ts`: `create_session` inputs, instruction and read-back for the `cursor_main` program.
  `checkIdl` fails if `packages/client/idl.json` has different `create_session` args (see `docs/DECISIONS.md`).
  Tests: `npx tsx --test keeper/src/session.test.ts`.
- `src/run.ts`: part 1 creates the PLAY mint (6 decimals), calls `create_session` with everything from
  `data/cpi-yoy-replay.json`, writes `data/session.json`, and checks every Session field it set. Part 2
  seeds the four sides from the keeper (`--seed 90,100,90,100` by default, `--seed none` to skip).
- `src/program.ts`: generic IDL instruction builder (accounts matched by IDL name), account decoding,
  PLAY formatting, `data/session.json` helpers. Tests: `npx tsx --test keeper/src/program.test.ts`.
- `src/replay.ts`: `npm run replay` posts the 48 observations in order, at least 2 s apart, each only after
  the previous one confirms. It resumes from `Session.next_index`. A row is never double-posted, even across
  `kill -9`: the signature is saved to `data/replay-pending.json` before each broadcast, and on restart that
  transaction must be confirmed or provably expired before the row is rebuilt.
- `src/ops.ts` and `src/admin.ts`: `npm run admin -- <seed|lock|settle|status|expire|sweep|claim|seller>` for the session in
  `data/session.json`. Every command reads the session first and sends nothing if that step is already
  done. `sweep` takes `--treasury <pubkey>` and creates that wallet's PLAY account when it is missing.
  `claim` takes `--keypair <file>` and prints that wallet's PLAY balance before and after. `status` also
  prints `scores`, `p_budget`, `r_budget`, `claimed_count/position_count`, the four side totals, and both
  vault balances in PLAY. `seller` is `fund`, `quote`, `buy`, `settle`, and `withdraw` (`src/seller.ts`).

## Local smoke test (no devnet)

Uses [surfpool](https://surfpool.run) as a local validator, run from outside the repo:

```bash
# terminal 1: headless local validator on 127.0.0.1:8899
cd /tmp/surfpool && surfpool start --offline --no-tui --no-studio --no-deploy --yes --airdrop-amount 0

# terminal 2: throwaway keypair + env file outside the repo, then the smoke test
pixi run npm --prefix keeper run tsx scripts/init-local-env.ts /tmp/keeper-local
DOTENV_PATH=/tmp/keeper-local/local.env pixi run npm --prefix keeper run smoke:transfer
DOTENV_PATH=/tmp/keeper-local/local.env pixi run npm --prefix keeper run smoke:transfer -- --expiry  # +~45s
```

The smoke test refuses to run unless `RPC_URL` points at localhost. It covers a SOL transfer, an on-chain
failure (thrown once, never resubmitted), a preflight rejection, and with `--expiry` an expired blockhash
that is rebuilt exactly once.

## Create a session locally (task 10)

The program must be loaded at the IDL's address. With no program keypair, load a built `.so` into
Surfpool via the `surfnet_writeProgram` cheatcode (local only):

```bash
pixi run npx --prefix keeper tsx keeper/src/prepare.ts   # writes data/cpi-yoy-replay.json
anchor build                      # or cargo-build-sbf; gives target/deploy/macropaths.so
DOTENV_PATH=/tmp/keeper-local/local.env pixi run npm --prefix keeper run program:load -- \
  target/deploy/macropaths.so FvT786RtMTtbdXWemA9zgA9rfwhvxFsKY1ypiMMNwMbS
# fund the keeper (Surfpool started with --airdrop-amount 0), then:
DOTENV_PATH=/tmp/keeper-local/local.env pixi run npm --prefix keeper run session:create
```

Then lock it, replay the 48 rows (safe to kill and restart at any point), and settle:

```bash
DOTENV_PATH=/tmp/keeper-local/local.env pixi run npm --prefix keeper run admin -- lock
DOTENV_PATH=/tmp/keeper-local/local.env pixi run npm --prefix keeper run replay   # --limit n, --interval-ms
DOTENV_PATH=/tmp/keeper-local/local.env pixi run npm --prefix keeper run admin -- settle   # after 48 rows
DOTENV_PATH=/tmp/keeper-local/local.env pixi run npm --prefix keeper run admin -- status
```

Options: `--session-id`, `--mint`, `--deposit-window`, `--replay-window`, `--idl`, `--replay`,
`--out`, `--seed`. If you re-run with an existing `--session-id`, nothing is sent: it re-checks the session against
`data/session.json`. It exits 1 if any read-back field differs.

## Demo run

Local Surfnet, keeper funded, `DOTENV_PATH` set as in the smoke test above. Commands are in order.
The line under each command is the one that command prints (addresses and signatures vary; these are the stable lines).

```bash
pixi run npx --prefix keeper tsx keeper/src/prepare.ts
# wrote replay (48 rows, C_0, C_N) to data/cpi-yoy-replay.json

anchor build --ignore-keys

DOTENV_PATH=/tmp/keeper-local/local.env pixi run npm --prefix keeper run program:load -- \
  "$(pwd)/target/deploy/macropaths.so" FvT786RtMTtbdXWemA9zgA9rfwhvxFsKY1ypiMMNwMbS
# loaded 511496 bytes at FvT786RtMTtbdXWemA9zgA9rfwhvxFsKY1ypiMMNwMbS (owner BPFLoaderUpgradeab1e11111111111111111111111)

DOTENV_PATH=/tmp/keeper-local/local.env pixi run npm --prefix keeper run session:create -- \
  --deposit-window 600 --replay-window 3600 --seed 90,100,90,100 --session-id 1001
# created PLAY mint <mint> (6 decimals, authority keeper)
# session <session>
# read-back: all 20 fields match
# seed: depositing 90, 100, 90, 100 PLAY (minting 380)

DOTENV_PATH=/tmp/keeper-local/local.env pixi run npm --prefix keeper run admin -- lock
# state        running

DOTENV_PATH=/tmp/keeper-local/local.env pixi run npm --prefix keeper run replay -- --interval-ms 2000
# replay: 48 of 48 posted; commitment equals C_N

DOTENV_PATH=/tmp/keeper-local/local.env pixi run npm --prefix keeper run admin -- settle
# scores       0.827387, 0.863980  (cooling, excess)

DOTENV_PATH=/tmp/keeper-local/local.env pixi run npm --prefix keeper run admin -- claim --keypair "$KEEPER_KEYPAIR"
# claim: PLAY before 0
# claim: PLAY after 380

DOTENV_PATH=/tmp/keeper-local/local.env pixi run npm --prefix keeper run admin -- sweep --treasury <pubkey>
# sweep: vaults are already empty

DOTENV_PATH=/tmp/keeper-local/local.env pixi run npm --prefix keeper run admin -- status
# claimed_count/position_count 1/1
# vaults       0, 0 PLAY
```

`claim` pays the seeder (the keeper, who deposited `90,100,90,100`). One position holds every side, so the payout is the whole deposit and both vaults are already 0; `sweep` reads that and sends nothing. A second `sweep` prints the same line. `status` repeats `scores`, `p_budget`, `r_budget`, the four side totals in PLAY, `claimed_count/position_count`, and the two vault balances.

The field count in `read-back: all 20 fields match` is what `session:create` prints for this program. The `511496` byte line is this build of `target/deploy/macropaths.so`. `npm --prefix keeper` runs the script with `keeper/` as the working directory, so the demo passes the `.so` as `$(pwd)/target/deploy/macropaths.so` from the repo root.

## Seller run

On a session that is still open, before `lock`. The keeper is the seller. Quote prices are millionths (`500000` = 0.50). `--from-forecast forecast/table.json` uses row 0 when that file exists: `p = clamp(V + floor(σ / 2), 0.05, 0.95)` in millionths, for both products. `V` and `sigma` are probabilities.

```bash
DOTENV_PATH=/tmp/keeper-local/local.env pixi run npm --prefix keeper run admin -- seller fund 20
# fund: 20 PLAY

DOTENV_PATH=/tmp/keeper-local/local.env pixi run npm --prefix keeper run admin -- seller quote --p0 500000 --p1 500000
# quote: 500000 500000

DOTENV_PATH=/tmp/keeper-local/local.env pixi run npm --prefix keeper run admin -- seller buy --product 0 --units 10 --keypair /tmp/buyer.json
# buy: product 0 10 PLAY
```

After that session has been settled:

```bash
DOTENV_PATH=/tmp/keeper-local/local.env pixi run npm --prefix keeper run admin -- seller settle --product 0
# seller settle: product 0

DOTENV_PATH=/tmp/keeper-local/local.env pixi run npm --prefix keeper run admin -- seller withdraw 1
# withdraw: 1 PLAY
```

`fund` tops free_cash up to the amount and mints any PLAY the keeper is short. `buy` creates the buyer's PLAY account when it is missing. A second `quote` with the same prices prints `quote: already 500000 500000` and sends nothing.
