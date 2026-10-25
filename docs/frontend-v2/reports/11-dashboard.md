# Worker 11 handoff

## Identity

- Worker ID and assignment: 11 — Dashboard
- Foundation/checkpoint SHA: 6d2865bf526f0bf980293d9cdcfec547acbfd9f8 (foundation checkpoint not yet merged; `frontend-v2/integration` still at this SHA when work was committed)
- Branch and commit SHA(s): `frontend-v2/11-dashboard`, see commit "Dashboard: disconnected intro, connected home, holdings and activity adapters"
- Status: incomplete — code and tests written against interfaces.md; not compiled or run because the shared exports do not yet exist

## Delivered

- `web/src/app/page.tsx` — home route renders `<Dashboard/>` inside `Suspense` (URL-driven session selection). The old Overview component is left in place for Agent 15.
- `web/src/features/dashboard/index.ts`, `Dashboard.tsx`, `model.ts`, `dashboard.module.css`, `model.test.ts`.

Behaviour:
- Disconnected: heading "Explore contracts on the path of inflation.", context chips (Historical replay / Solana devnet / Test PLAY), Connect wallet + Explore session link, Excess Inflation then Inflation Cooling cards (approved one-sentence copy, no prices), selected-session preview (label, historical range, replay state, last replay reading with month, CPI sparkline, per-product accrued score sparklines derived from the recorded `decline`/`excess` statistics ÷ session caps).
- Connected: shortened, copyable address + network chips; PLAY balance per mint (never summed, failed read shows "Balance unavailable", no fiat); "Available to claim" per mint, built with `sumAmounts` over `summarizeHolding().unclaimed` (null → "Not determined yet"; Running illustrations excluded); Your covers (product, premium paid, maximum payout, state label) then separately labelled Your pool positions (total deposited, state amount, More/Less allocation in a `<details>` disclosure); session preview; bounded (5) recent activity with signed amounts, "Amount unavailable", Explorer links and an "All activity" link.
- Labels: Final payout / Refund available / Accrued payout illustration + "Illustration until settlement" / Not determined yet / Claimed or Refunded.
- Owner safety: wallet overview is ignored unless `response.owner === connected owner`; accounts whose `owner` differs are dropped in `buildHoldings`.
- States: skeletons, ErrorState with retry, PartialDataNotice for stale refetch failure, per-session holding read failure and pending activity signatures; invalid `?session=` shows an explicit return-to-default link.
- No transaction controls; a text explanation states deposits/purchases/claims/faucet are unavailable.

## Evidence

- Not run: `vitest`, `tsc`, browser screenshots (375/768/1440). Blocked by integration dependency — foundation exports listed below are absent at 6d2865b, and `web/node_modules` is not installed in this worktree.
- `model.test.ts` covers: multi-mint balances with partial failure, mixed cover/pool Settled, unrelated owner, holdings read failure, claimed, Refunding, Running, Open undetermined, multi-mint claimable, preview text, score paths, activity signing/bounding/Explorer URL. Note: `vitest.config.ts` includes `src/**/*.test.ts`, node environment; no component-render tests (no DOM test library in the current lock).

## Integration dependencies

Code imports (per interfaces.md, not yet present):
- `@macropaths/client`: `summarizeHolding`, `sumAmounts`, types `AmountSummary`, `CatalogResponse`, `WalletOverviewResponse`, `WalletActivityItem`.
- `@macropaths/ui`: `Skeleton`, `EmptyState`, `ErrorState`, `PartialDataNotice`, `GlowSparkline`, `GlowPoint` type; web must depend on `@macropaths/ui` (Agent 15).
- `@/lib/hooks`: `useCatalog`, `useSessionOverview`, `useWalletOverview`, `useWalletActivity`; `@/lib/queries`: `sessionOverviewQuery` (used with `useQueries` to obtain SessionView for each holding session).
- `@/features/wallet-connect`: `useWalletConnection`; `@/features/shell`: `useSelectedSession`.
- Request (Agent 10/08): a shared wallet address/copy component, if one is planned, would replace the private copy button. Connect currently calls `connect("phantom")`; a shared wallet picker would be preferable.

No production stubs or fixture fallbacks are bound.

## Remaining issues

After the checkpoint: merge `frontend-v2/integration`, fix compile errors, run `npx vitest run src/features/dashboard` and `tsc --noEmit`, and capture 375/768/1440 screenshots for disconnected and connected states.
