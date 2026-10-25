# Worker 14 handoff

## Identity

- Worker ID and assignment: 14, products-and-planner
- Foundation/checkpoint SHA: 6d2865b (foundation checkpoint on frontend-v2/integration not yet merged)
- Branch and commit SHA(s): frontend-v2/14-products-and-planner, see final commit message
- Status: incomplete (logic and tests complete; UI not type-checked or browser-verified pending checkpoint)

## Delivered

- `web/src/lib/planner.ts`: 21-policy algorithm and tie-break unchanged; added `checkInputs(q, B)` (finite, gallons >= 0, budget > 0).
- `web/src/features/products/model.ts`: pure view models. `planView` (recommendation sentence, cash-wins / zero-exposure copy, showcase residual vs cash, tail note that zero sample tail loss is not protection, chart series with allocation x-axis and cash point at x=0 plus cash-only threshold, 21-row ranking, methodology incl. overlapping windows, caps, basis mismatch). `offerView` maps coverOffer ReadSection to distinct available / not_configured / closed (settled = historical) / unfunded / unavailable states; quote only exposed when available, never a model price; always carries the no-transactions note.
- `web/src/features/products/PlannerSection.tsx`: inputs, aria-live recommendation, residual vs cash, TailLoss95 + expected end cash, GlowLineChart (comparison variant; hidden when cash wins at zero exposure), keyboard-native `<details>` "See all comparisons" with table + methodology. USD labels and the required USD/PLAY note.
- `web/src/features/products/ProductsPage.tsx`, `products.module.css`, `web/src/app/products/page.tsx`: catalogue Excess, Cooling, Fuel Research; on-chain offer per product index from session overview; Research references section from bundle terms, with explicit "not the selected session's terms" unless `associatedSession` equals the selected address.
- Defaults/results come from the artifact (no copied constants in JSX).

## Evidence

- `npx vitest run test/planner` (WSL, node 24): 2 files, 20 tests passed. Covers Python agreement on 21 rows (existing test), default Fuel 40 / 199.55 / 528.33 read from artifact, invalid/nonfinite inputs, zero exposure -> cash, tie-break (cash, then lower stake, excess before fuel), small (0.01) and large (5000) budgets, chart truthfulness (no date IDs, cash baseline), offer states.
- Not run: `tsc`, lint, Next build, browser screenshots (375/768/1440), a11y checks. Blocked: foundation imports absent in worktree.

## Integration dependencies

Imports coded to interfaces.md: `useCatalog`, `useSessionOverview`, `useResearchBundle` from `@/lib/hooks`; `useSelectedSession` from `@/features/shell`; `GlowLineChart`, `ErrorState`, `Skeleton` from `@macropaths/ui`; `fmtQuotePlay` from `@macropaths/client`. `PlannerArtifact` type from `@/lib/artifacts` (should re-export the client schema). Requests to 15: `useSelectedSession` likely uses search params, so the products route may need a Suspense boundary; vitest include covers only `.test.ts` (no component tests). No stubs or mock fallbacks in production code.

## Remaining issues

After the checkpoint merge: typecheck, fix any signature drift, capture screenshots (Fuel-recommended and cash-recommended states), verify the chart axis labelling in GlowLineChart (x = allocation, not date). Legacy `/planner` route left intact for Agent 15.
