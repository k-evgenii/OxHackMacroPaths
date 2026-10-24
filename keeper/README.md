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
