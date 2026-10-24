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
- `src/session.ts`: `create_session` inputs, instruction and read-back. It picks the layout from the
  `create_session` args in `packages/client/idl.json` (PR #7's `nonce + params`, or `cursor_main`'s flat
  args; see `docs/DECISIONS.md`). Tests: `npx tsx --test keeper/src/session.test.ts`.
- `src/run.ts`: part 1 creates the PLAY mint (6 decimals), calls `create_session` with everything from
  `data/cpi-yoy-replay.json`, writes `data/session.json`, and checks every Session field it set. Part 2
  seeds the four sides from the keeper (`--seed 90,100,90,100` by default, `--seed none` to skip).
- `src/program.ts`: generic IDL instruction builder (accounts matched by IDL name), account decoding,
  PLAY formatting, `data/session.json` helpers. Tests: `npx tsx --test keeper/src/program.test.ts`.
- `src/replay.ts`: `npm run replay` posts the 48 observations in order, at least 2 s apart, each only after
  the previous one confirms. It resumes from `Session.next_index`. A row is never double-posted, even across
  `kill -9`: the signature is saved to `data/replay-pending.json` before each broadcast, and on restart that
  transaction must be confirmed or provably expired before the row is rebuilt.
- `src/ops.ts` and `src/admin.ts`: `npm run admin -- <seed|lock|settle|status>` for the session in
  `data/session.json`. Every command reads the session first and sends nothing if that step is already
  done. These, and seeding, need the flat (`cursor_main`) layout, the only one with real instruction bodies.

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

Options: `--session-id`, `--mint`, `--controller`, `--deposit-window`, `--replay-window`, `--idl`, `--replay`,
`--out`, `--seed`. If you re-run with an existing `--session-id`, nothing is sent: it re-checks the session against
`data/session.json`. It exits 1 if any read-back field differs.
