# Worker 11 handoff

## Identity

- Worker ID and assignment: 11 — Dashboard
- Foundation/checkpoint SHA: 6d2865bf526f0bf980293d9cdcfec547acbfd9f8 (foundation checkpoint not yet merged; `frontend-v2/integration` still at this SHA when work was committed)
- Branch and commit SHA(s): `frontend-v2/11-dashboard`, see commit "Dashboard: disconnected intro, connected home, holdings and activity adapters"
- Status: complete except connected-state screenshots (see Remaining issues)

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

Checkpoints 2 (6a06725) and 3 (aecb709) merged. `npm ci` ok. `tsc --noEmit`: 0 errors in owned files. `vitest run src/features/dashboard`: 12/12 passed.
Private copy button and connect button replaced with worker 10's `CopyableAddress` and `WalletPicker`; recent activity reads the first page of the infinite `useWalletActivity` query.
Screenshots (NEXT_PUBLIC_USE_FIXTURES=1, next dev, Playwright chromium): `docs/frontend-v2/reports/screens-11/dashboard-disconnected-{375,768,1440}.png`; no horizontal overflow at any width.
Visual finding: the global theme is still dark (old globals.css), so the heading, which used --mp-text, was unreadable. It now inherits the text color (`color: inherit`), a change made after the screenshots were taken. Global theme is worker 08/15.

Superseded notes from checkpoint 1:

Checkpoint 1 (85a62e8) merged. `npm ci` (WSL) ok. `npx vitest run src/features/dashboard`: 12/12 passed.
`npx tsc --noEmit` remaining errors in owned files, all from missing producer exports:
- `@macropaths/ui`: Skeleton, EmptyState, ErrorState, PartialDataNotice, GlowSparkline, GlowPoint (worker 08/09).
- `@/lib/hooks` useCatalog/useSessionOverview/useWalletOverview/useWalletActivity; `@/lib/queries`; `@/features/wallet-connect`; `@/features/shell` (worker 10).
- Cascading implicit-any errors (useQueries results) and a Button prop error at the Connect button; recheck once the above land.
Curator rewording applied: heading "Cover that pays when inflation runs hot — or cools.", connected heading "Your covers and positions", sparkline labels use fmtPeriod months, claim card has a one-line note with the full transactions-unavailable note shown once on the page.
Screenshots not taken: the page cannot build until worker 10's hooks/wallet/shell merge.

Earlier notes:

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

- Connected-state screenshots not captured: a wallet address cannot be injected under the fixture harness without a test hook; request a fixture-owner override from worker 10/15. Connected behaviour is covered by model tests only.
- `/` still renders inside a dark global shell until the light theme lands.

After the checkpoint: merge `frontend-v2/integration`, fix compile errors, run `npx vitest run src/features/dashboard` and `tsc --noEmit`, and capture 375/768/1440 screenshots for disconnected and connected states.
