# Agent 12 — Unified Session page

## Mission

Replace the client-facing session database view with one readable historical story: recorded inflation path, two product results, the connected wallet's holdings, and truthful vault information. Preserve exact contract semantics while removing technical clutter.

## Read before editing

Read applicable repository instructions, `../README.md`, `../product-and-content.md`, `../interfaces.md`, `../api-and-architecture.md`, `../design-system.md`, `../parallel-execution.md`, and `../acceptance.md`. Read delivery/UI/exact-data skills when available.

## Exclusive ownership

- `web/src/app/session/[addr]/page.tsx`.
- `web/src/app/session/[addr]/layout.tsx`.
- `web/src/features/session/**`, including private adapters, CSS modules, and tests.

Do not modify `path`, `results`, `seller`, or legacy session activity route files. Agent 15 captures the original versions from the pre-bootstrap baseline and migrates them into `/dev`. You must not move/delete those routes, modify root wiring, edit queries, or change shared CSS/components.

## Parallel start

Implement against frozen `useSessionOverview(addr)` and `useWalletOverview(owner)` hooks, UI props, and fixture scenarios. Use `useWalletConnection()` for the owner and shared `summarizeHolding` for exact amounts. The actual service implementation is an integration dependency, not a reason to wait before building.

## Layout and hierarchy

- One page, without client Summary/Path/Results/Seller tabs.
- Header: registered human-readable title, historical date range, state pill, devnet/test PLAY context.
- Desktop top row: chart around two-thirds width with a result summary beside it. Mobile: chart and summary in reading order.
- Three headline figures: last replay reading with month, Cooling score, Excess score. Put Settled/Running in the state pill rather than a fourth equivalent metric.
- Below: connected wallet's covers first, pool position separately; current vault balances and total historical pool contributions; calculation explanation in a disclosure.

The layout wrapper should supply page-local structure only. Do not insert a second application shell, wallet provider, or competing navigation.

## Path and result semantics

- Use the exact path rows and shared formatters. Do not rebuild the 48 observations from rounded values pasted in a brief.
- Pass display-only scaled numbers and exact formatted strings to `GlowLineChart`.
- Show threshold from `session.terms.k`, not an unconditional hardcoded 4%.
- Derive the visible period range from verified registry metadata/path. Before observations, do not turn `lastPeriodId=0` into a date.
- A range/year selector crops the display, not the contract's scoring window.
- Cooling describes largest decline from an earlier peak; Excess describes accumulated monthly excess. Show percentage-point and point-month units correctly.
- Score is a normalized statistic/payout factor for covers, not a probability or return.
- Incomplete replay is normal. Do not interpret `integrityOk=false` during Open/Running as a verification failure. Show successful replay verification only when completion conditions hold; a completed mismatch is a separate error state.
- Refunding prioritizes the refund status and does not present a final score as an amount owed.

## Holdings and vaults

Filter holdings by this session and active owner. Use shared state-sensitive summaries; do not calculate payouts from stale stored budgets or turn null payouts into zero. Running calculations are labelled illustrations. Claimed holdings do not inflate available amounts.

Show “Total deposited” from exact `sideTotals` aggregation and “Currently held in vaults” from the overview's token-account reads. If vault data is unavailable, keep deposited totals visible and mark current balances unavailable. Do not label the deposit composition as current vault composition.

The four More/Less segments describe pool contributions only. Do not silently include cover escrow in those segments. Explain mechanisms through a concise disclosure where necessary.

## Reference-session check

For session A, preserve its test terms `k=40000`, `dCap=80000`, `aCap=800000` and scores `827387`, `863980`. Display approximately 9.06% peak in Jun 2022, 6.62 points maximum decline, 69.1 point-months excess, 82.7%/86.4% scores, and 380 PLAY total deposited. Exact underlying values come from fixtures.

Do not replace these with p90 research caps/scores. Research overlays require an explicit verified association and are absent for unmatched bundles.

## Verification and handoff

Test invalid/missing session, Open without observations, partially recorded Running, Settled, Refunding, completed integrity mismatch, unavailable vault/seller, disconnected wallet, unrelated owner, claimed holding, long labels, and range selection. Ensure no client technical hashes/raw-unit tooltips remain.

Provide 375/768/1440 px screenshots and interaction checks for chart, disclosure, focus order, and loading/error states. Handoff includes route modules, private adapters, tests, integration requests, base SHA, and branch/commit reference. Agent 15 owns compatibility redirects and cleanup.
