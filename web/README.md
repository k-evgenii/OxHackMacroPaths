# MacroPaths web

Next.js (app router) frontend for the MacroPaths program on Solana devnet. This pass is read-only.

```bash
# from the main repo, Node comes from pixi; or put .pixi/envs/default on PATH
cp .env.example .env.local     # set RPC_URL; NEXT_PUBLIC_USE_FIXTURES=1 works without RPC
npm install && npm run dev
npm test && npm run typecheck && npm run build
```

## Ownership (frontend pass 1)

| Path | Owner |
| --- | --- |
| `../packages/client/src/types.ts`, `../packages/client/fixtures/`, `src/lib/api-client.ts`, `src/lib/providers.tsx`, `test/contract/` | integrator (frozen contract) |
| `../packages/client/src/**` (rest) | fe/01-client |
| `src/app/api/**`, `src/server/**`, `test/api/**` | fe/02-api |
| `src/app/layout.tsx`, `src/app/page.tsx`, `src/app/session/[addr]/{page,layout}.tsx`, `src/app/session/[addr]/activity/**`, `src/components/{shell,ui}/**`, `src/lib/hooks/**`, `src/styles/**`, `src/app/globals.css` | fe/03-shell |
| `src/app/session/[addr]/{path,results,seller}/**`, `src/components/charts/**` | fe/04-path |
| `src/app/{forecast,planner}/**`, `src/lib/planner.ts`, `test/planner/**`, `scripts/copy-artifacts.mjs`, `public/data/**` | fe/05-forecast |
