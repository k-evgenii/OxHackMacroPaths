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

## Queued for integration (after producers merge)
- From the coordinator: remove the `predev`/`prebuild` copy-artifacts step; add a prebuild step that runs `node scripts/artifacts/validate.mjs`, plus `artifacts:validate`/`artifacts:publish` scripts (worker 07's design); retire/update the changed cases in `web/test/api/routes.test.ts` (04) and `events-session.test.ts` (03).
- From curator report 16: redirect/remove public `/forecast`, `/planner`, `/session/[addr]/{path,results,seller,activity}`; delete Provenance, ResearchCaps, Overview and SessionHeader once nothing imports them; put legacy `/api/sessions*` routes behind a server-side DEV_CONSOLE check (or confirm no new screen uses them); restrict `/api/artifacts/[name]` to a fixed allowlist (with 07); in the Playwright pass, check that the new screens show no raw addresses, ids or debug JSON.

## Playwright prep (checkpoint 1)
- `web/playwright.config.ts`: projects at 375x812, 768x1024 and 1440x900; webServer `next dev` with fixture mode and DEV_CONSOLE.
- `web/test/e2e/support.ts`: `page.route` serves `/api/*` from `test/support/frontend-v2/handlers`, records browser JSON-RPC/RPC-host requests and console errors.
- `web/test/e2e/scenarios.spec.ts`: skeleton scenarios (disconnected, empty owner, partial history, catalog error) that take screenshots and assert zero browser RPC, no hydration errors and no horizontal overflow, plus a `/dev` gate check. Limitation: `page.route` only intercepts requests the browser makes; server-side reads rely on the app's own fixture mode.

## Checks
- Checkpoint 1 (85a62e8) merged; npm ci in client, ui and web; `tsc --noEmit` in web: clean; `vitest run`: 13 files passed, 1 skipped (92 tests passed, 1 skipped). Playwright has not been run yet (browsers not installed, no app pages yet). Legacy copies still import `@/components/charts/_fallback/*`, `@/lib/hooks`, `@/components/shell/*`; they must be remapped before the fallback files are deleted.

## Environment variable names
- `DEV_CONSOLE` (server only, `1` enables `/dev`).

## Producer SHAs integrated
- None.
