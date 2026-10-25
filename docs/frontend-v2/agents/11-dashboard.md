# Agent 11 — Dashboard

## Mission

Build the client home page so a disconnected user understands the historical demonstration and a connected cover buyer can read their balance, holdings, available payout, and recent activity. Covers are primary; pool positions are displayed as a separate mechanism.

## Read before editing

Read applicable repository instructions, `../README.md`, `../product-and-content.md`, `../interfaces.md`, `../api-and-architecture.md`, `../design-system.md`, `../parallel-execution.md`, and `../acceptance.md`. Read the delivery/UI/exact-data skills when present.

## Exclusive ownership

- `web/src/app/page.tsx`.
- `web/src/features/dashboard/**`, including private adapters, CSS modules, and tests.

Do not edit global styles, shared components, query hooks, wallet connection, root providers/layout, package manifests/exports, fixtures, or another page. Ask Agent 10 for query/hook changes and Agent 15 for root/dependency wiring.

## Start immediately

The foundation publishes endpoint schemas, hook signatures, UI props, and scenario fixtures. Use them to implement adapters, layouts, tests, and stories while backend agents work. Import `useCatalog`, `useSessionOverview`, `useWalletOverview`, and `useWalletActivity` from `@/lib/hooks`, and `useWalletConnection` from `@/features/wallet-connect`, as frozen in `../interfaces.md`. Mocks are test/preview bindings only; live mode must never silently use them.

## Disconnected screen

- Heading: “Explore contracts on the path of inflation.”
- Visible context: Historical replay, Solana devnet, test PLAY.
- A clear connect action and an “Explore session” link.
- Two CPI product cards: Excess Inflation first, Inflation Cooling second. Explain the path statistic in one sentence; do not display model prices as available offers.
- A compact selected-session preview with human-readable name, historical range, replay state, and chart.
- Avoid a giant zero-valued balance or empty portfolio visualization before connection.

## Connected screen

Order content by user importance:

1. PLAY balance, shortened/copyable owner address via shared wallet UI, and network context.
2. Available final payout/refund, distinct from wallet balance and from Running illustrations.
3. Owned covers, then separately labelled pool positions.
4. Selected historical session preview with the last replay reading/month.
5. Recent personal activity and a link to the full Activity page.

For multiple PLAY mints, show separate balances. Never sum them or invent a fiat value. Keep disconnected, empty, unavailable, refreshing, and partially available states distinct.

## Holdings presentation

Use `summarizeHolding(session, position, cover)` from the shared client contract. Use shared exact formatters. Do not calculate financial totals with `Number`, `parseFloat`, ad hoc reductions, or chart data.

- Cover: product, premium paid, maximum payout, final payout/refund or accrued illustration, and claimed state.
- Pool position: total deposited, final payout/refund or accrued illustration, with More/Less allocations behind a disclosure.
- Final Settled values say “Final payout”; Refunding values say “Refund.”
- Running illustrations say “Accrued payout illustration” and “illustration until settlement.”
- Open sessions without observations say “Not determined yet.”
- Claimed holdings remain visible historically but contribute zero to available-to-claim figures.
- All transaction-execution controls are unavailable in this release with an explanatory message. Do not offer a faucet, deposit, purchase, or claim flow.

The inspected reference owner has pool deposits on all four sides. The aggregate position payout equals the aggregate deposited amount for that sole position; individual side results differ. Do not present side-level gains as whole-wallet gains.

## Recent activity and charts

Use the approved wallet-activity query. Render a small bounded list with correct signed amounts and Explorer links; unknown amounts say “Amount unavailable.” Reuse shared transaction presentation where available or keep a private adapter; do not reimplement history pagination here.

The selected session chart is historical. Say “Last replay reading,” not live/latest inflation without a date. Product sparklines must be derived from the relevant product's accrued statistic/score through the frozen presentation model, not invented price histories or a reused CPI curve labelled as a product price.

## Verification

Test disconnected, connecting, connected-empty, fixture-owner holdings, unrelated owner, partial balance failure, holdings failure, stale refresh, mixed cover/pool, claimed, Refunding, Running, and multi-mint cases. Verify owner switches do not show the previous user's data.

Inspect at 375, 768, and 1440 px, including long amounts and names. Ensure one principal figure per card, no horizontal page overflow, visible focus, readable notices, and no raw account fields in tooltips.

## Handoff

Deliver the route and private feature modules, tests, screenshots, query/component integration requests, base SHA, and branch/commit reference. Do not remove the old Overview component or legacy routes; Agent 15 preserves and migrates them into `/dev` first.
