# MacroPaths web

Next.js (app router) frontend for the MacroPaths program on Solana devnet. This pass is read-only.
`web/` lives on the `evgenii/frontend` branch; `main` does not contain it.

```bash
pixi install --locked            # repo root: Node comes from pixi (or put .pixi/envs/default on PATH)
(cd packages/client && npm ci)   # first: web depends on it as file:../packages/client
cd web && npm ci
cp .env.example .env.local       # set RPC_URL to a keyed devnet endpoint (Helius/QuickNode); the public one rate-limits
npm run dev
npm test && npm run typecheck && npm run lint && npm run build
```

`NEXT_PUBLIC_USE_FIXTURES=1` answers every `/api` path from `packages/client/fixtures`, so no RPC is needed.
The program id comes from the IDL via `@macropaths/client`, the reference session from `NEXT_PUBLIC_DEFAULT_SESSION`
(fixture session as fallback). Research caps and scores (`public/data`) are a p90 parameterisation, not a session's terms,
and the UI labels them as such.

## Ownership (frontend pass 1)

| Path | Owner |
| --- | --- |
| `../packages/client/src/types.ts`, `../packages/client/fixtures/`, `src/lib/api-client.ts`, `src/lib/providers.tsx`, `test/contract/` | integrator (frozen contract) |
| `../packages/client/src/**` (rest) | fe/01-client |
| `src/app/api/**`, `src/server/**`, `test/api/**` | fe/02-api |
| `src/app/layout.tsx`, `src/app/page.tsx`, `src/app/session/[addr]/{page,layout}.tsx`, `src/app/session/[addr]/activity/**`, `src/components/{shell,ui}/**`, `src/lib/hooks/**`, `src/styles/**`, `src/app/globals.css` | fe/03-shell |
| `src/app/session/[addr]/{path,results,seller}/**`, `src/components/charts/**` | fe/04-path |
| `src/app/{forecast,planner}/**`, `src/lib/planner.ts`, `test/planner/**`, `scripts/copy-artifacts.mjs`, `public/data/**` | fe/05-forecast |
