# Worker 15 report — integration and QA (preparation checkpoint)

Status: PARTIAL. Foundation checkpoint (frontend-v2/integration) and producer branches were not yet available; no integration, browser QA or acceptance run has been performed.

## Done
- Snapshotted legacy raw routes from ORIGINAL_FRONTEND_SHA d2f3aa8 via `git show` into `web/src/app/dev/legacy/` (forecast, planner + `_fallback`, session path/results/seller/activity). `forecast/product-card.tsx` was taken from the same SHA if present, otherwise from the foundation HEAD.
- `web/src/app/dev/layout.tsx`: server-side gate, `process.env.DEV_CONSOLE !== "1"` -> `notFound()`, `force-dynamic`; no query or public-flag bypass.
- `web/src/app/dev/page.tsx`: index listing legacy views.

## Not done / pending checkpoint
- Provider composition, root layout, `@macropaths/ui` exports, redirects (Path/Results -> Session, Activity -> `/activity?session=`, Seller/Forecast/Planner -> Products), API explorer, fallback removal.
- Playwright config/scenarios, browser QA at 375x812 / 768x1024 / 1440x900, RPC/hydration inspection, screenshots.
- Explicit artifact publishing (remove `predev`/`prebuild` copy-artifacts side effect) — package.json change to be serialized with coordinator.

## Checks
- No `web/node_modules` in the worktree; `tsc --noEmit` could not run meaningfully. Legacy copies still import `@/components/charts/_fallback/*`, `@/lib/hooks`, `@/components/shell/*`; they must be remapped onto the adopted kit before those fallbacks are deleted.

## Environment variable names
- `DEV_CONSOLE` (server only, `1` enables `/dev`).

## Producer SHAs integrated
- None.
