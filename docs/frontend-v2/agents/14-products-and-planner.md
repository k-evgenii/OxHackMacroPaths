# Agent 14 — Products and Planner

## Mission

Build the cover-buyer product catalogue and turn the existing Planner into a clear historical decision comparison. Lead with the recommendation and remaining shortfall, while keeping executable session facts separate from research assumptions.

## Read before editing

Read applicable repository instructions, `../README.md`, `../product-and-content.md`, `../interfaces.md`, `../api-and-architecture.md`, `../design-system.md`, `../parallel-execution.md`, and `../acceptance.md`. Read delivery/UI/exact-data skills when present. Inspect the current `web/src/lib/planner.ts` and its tests before modifying presentation bindings.

## Exclusive ownership

- `web/src/app/products/**`.
- `web/src/features/products/**`, including private adapters, CSS modules, and tests.
- `web/src/lib/planner.ts`.
- `web/test/planner/**`.

Do not edit artifact producer files, bundle metadata, artifact routes, query hooks, shared schemas/components, global CSS, old Forecast/Planner routes, manifests, or root providers/layout. The research-bundle owner supplies normalized validated data. Agent 15 migrates old routes and installs dependencies.

## Parallel start

The foundation supplies catalog/overview/research interfaces, known bundle fixtures, and chart props. Implement recommendation copy, inputs, result models, comparison layout, and tests immediately against those declarations. Live bindings are integrated after the corresponding services land; mocks never serve as a fallback for live errors.

## Catalogue

Show Excess Inflation, Inflation Cooling, and Fuel Research. Do not add Diesel, Floating-Loan, or v2 purchase actions in this round.

- Excess Inflation: pays according to how far and how long inflation is above its session threshold.
- Inflation Cooling: pays according to the largest decline from an earlier inflation peak; describe it as a view rather than a guarantee about a household bill.
- Fuel: research illustration linked more directly to gasoline exposure.

Use actual selected-session terms and validated on-chain seller quotes for cover offers. State price as PLAY per unit of maximum payout, not a probability or expected return. A settled session is historical. Missing quote, unfunded seller, closed window, and unavailable seller read are different states.

The interface remains read-only: a valid cover offer does not authorize a purchase flow. Transaction controls must explain unavailability. Model prices can appear in the Research section only, labelled as research references, never substituted into a missing live offer.

## Planner hierarchy

1. Inputs: gallons per month and illustrative budget; explain the fixed illustrative gasoline budget price from the artifact.
2. One recommendation sentence with product and allocation.
3. Remaining shortfall under the historical showcase, immediately beside the cash-only shortfall.
4. Historical tail shortfall and expected end-of-period cash with short definitions.
5. A compact comparison chart.
6. “See all comparisons” disclosure containing the 21 policies and detailed methodology.

Research budget/results use explicit illustrative USD labels. Include “Research calculations use illustrative USD amounts. Devnet holdings use PLAY; no conversion rate is assumed.” Do not submit the recommended USD allocation as a token amount.

For the inspected default bundle, keep 100 gallons/month, budget 200, recommended Fuel allocation 40, modelled showcase shortfall approximately 199.55, and cash-only shortfall approximately 528.33. Read exact inputs and outputs from the validated artifact/calculation, not copied constants in JSX. Updated published bundles may change those results; their IDs and tests must change together.

## Calculation integrity

- Preserve the existing 21-policy algorithm and tie-break order: smaller historical tail shortfall, then lower allocation, then the established product order with cash first.
- Keep research floats isolated from exact on-chain math.
- Inputs must be finite; gallons are nonnegative and budget positive. Invalid inputs suspend the result with a readable error.
- Zero exposure may favor cash. Do not force a cover recommendation or a chart that suggests a purchase.
- Do not present zero sample tail loss as guaranteed protection. The 318 historical windows overlap and are not independent future trials.
- Show payout-cap limitations and basis mismatch in concise explanatory copy. Retain expected cash so lower tail shortfall is not the sole visible trade-off.
- Reference session A uses test caps; p90 research scores and quotes cannot be displayed as that session's results.

## Comparison chart

Use allocation on the x-axis and historical TailLoss95 on the y-axis. Label both and retain the cash baseline. It is not a monthly forecast: no invented dates or simulated time series.

Use frozen chart props with exact research labels and a textual summary. Where two products are shown, identify them with labels and/or line style as well as color. Keep chart secondary to the recommendation and residual shortfall.

## Verification

Preserve existing Python/TypeScript agreement on all 21 rows to its established tolerance. Test default recommendation, tie-breaks, cash best, zero exposure, invalid/nonfinite inputs, very small and larger budgets, bundle-specific results, research labels, and missing/closed/unavailable offers.

Verify the detailed comparisons can be opened by keyboard, recommendation updates are announced without disruptive focus changes, inputs are usable on mobile, and chart axes are truthful. Capture 375/768/1440 px screenshots, including Fuel recommended and cash recommended states.

## Handoff

Deliver Products/Planner modules, unchanged-or-justified planner calculation changes, tests, screenshots, bundle assumptions, query/component requests, base SHA, and branch/commit reference. Leave old Forecast/Planner files intact until Agent 15 captures/migrates the original baseline.
