# MacroPaths frontend integration

The consumer interface remains the MacroPaths design from `9b4f9c3`, with a Forecast view and selective read-only API integration from `evgenii/frontend-final` (`832edae`). The teammate branch's page designs, shell, wallet controls and chart styling were not imported. Current `cursor_main` history is preserved.

## Run in WSL / Linux (Node 20+)

```bash
cd packages/client && npm ci && cd ../../web
npm ci
NEXT_PUBLIC_USE_FIXTURES=1 npx next dev --hostname 0.0.0.0 --port 3101
```

Production preview:

```bash
NEXT_PUBLIC_USE_FIXTURES=1 npx next build
NEXT_PUBLIC_USE_FIXTURES=1 npx next start --hostname 0.0.0.0 --port 3101
```

The fixture flag is compiled into browser bundles. To use live reads, rebuild without it and set server-only `RPC_URL` to a Solana devnet endpoint. Never put RPC credentials in a `NEXT_PUBLIC_` variable. The app's `predev` and `prebuild` scripts validate the committed research artifacts; they no longer overwrite them.

## Connected areas

- Forecast: `/api/catalog` discovers the versioned `/api/artifacts/bundle`. The view shows modelled final product scores at each step in the historical January 2021–December 2024 replay, with one-standard-deviation model dispersion. It is not a forecast of current/future CPI readings. Research caps are separate from the reference session's settlement caps.
- Settlement verification: the catalog and `/api/sessions/[addr]/overview` validate the recorded reference session, its dataset, state, scores and caps.
- Wallet lookup: `/api/wallet/[owner]` returns registered balances and holdings by public address. Fixture mode clearly labels saved test data. The sample identity is separate from the local practice portfolio. No wallet signing or token transfers are provided.
- Inflation news continues through the existing news API independently of fixture mode.

`/forecast` opens the new consumer view. Legacy session views, planner and developer console remain gated by server-only `DEV_CONSOLE=1`.

The API infrastructure also includes paginated history. No history UI or hosted Redis service is required for these connected areas; its default cache is in memory. The included Redis adapter is optional and not automatically configured.

## Product boundaries

The two deployed CPI products use caps 80000 / 800000 and reference scores 827387 / 863980 millionths. Fuel remains research only (cap 36411, showcase statistic 72833). Practice positions remain local previews and never represent on-chain deposits or claims. Live API failures surface as errors; they never silently become fixture data.

## Verification commands

```bash
cd packages/client && npm run typecheck && npm test
cd ../../web
node scripts/artifacts/validate.mjs
npm run typecheck
npm run lint
npm test
NEXT_PUBLIC_USE_FIXTURES=1 npx next build
```
