# Report — Agent 13: Activity page

Base: foundation `6d2865b` (the foundation checkpoint with shared hooks/types was not yet merged when this was written).
Branch: `frontend-v2/13-activity-page`.

## Delivered (owned files only)

- `web/src/app/activity/page.tsx` — route, wrapped in Suspense for URL-driven session selection.
- `web/src/features/activity/model.ts` — pure model: stable-id feed merge across pages (dedupe, pending count,
  continuation cursor independent of row count, empty-page-with-continuation flag), browser-time-zone day grouping
  (Today / Yesterday / date; null times last under "Date unavailable" in API order), exact signed PLAY amounts
  (6 decimals via `fmtPlay`; null => "Amount unavailable"; zero shown as zero), product labels, Market rows from
  `SessionView.path` (newest index first, "Mar 2023 recorded: 4.98 %", never padded), terminal-state summary,
  cursor-error classification (400 => expired, offer refresh).
- `web/src/features/activity/ActivityPage.tsx` — labelled My activity/Market radiogroup; disconnected state with
  Connect and Show market actions; owner feed keyed by owner (owner switch discards state); partial-data notice
  with manual "Retry now"; refresh-failure banner keeping old rows; load-more with failure state; Explorer links
  with descriptive accessible names; Market uses only `useSessionOverview` (no history requests) and works
  disconnected. Dates render only after mount (no SSR/browser time-zone mismatch).
- `web/src/features/activity/activity.module.css` — narrow layout: amount wraps under the row at <=420px, `overflow-wrap:anywhere`.
- `web/src/features/activity/model.test.ts` — vitest: multi-action signatures, dedupe of recovered rows, pending
  preservation, empty page with continuation, signed/zero/null/huge amounts, DST day (America/New_York 2024-03-10/11),
  zone dependence, year boundary, Market ordering/no padding, terminal summaries, error classification.

## Not done / blockers

- (Superseded by checkpoints 2/3 below.)

## Checkpoints 2 and 3 (6a06725, aecb709) merged

- Adapted to worker 10's real hooks: the pending notice uses `useWalletActivity(...).recovery`. Automatic recovery
  stays in the shared helper. The page shows "Retrying…" while it retries and "Retry now" (`recovery.retry()`)
  once it reports `exhausted`. When `needsRefresh` is set (a pending page has no cursor), it shows "Reload" (`refetch`).
  `useSessionOverview(selected.address)` now passes null while loading. Expired-cursor detection uses `error.status === 400`.
- CSS now uses shell theme tokens (`--surface/--text/--muted/--primary/--up/...`). Before this, the cards had light text on a light background inside the dark shell.
- Tests: `vitest run src/features/activity` → 12/12 pass (10 model + 2 jsdom component tests: disconnected → Market
  with zero `useWalletActivity` calls and no Explorer links; partial page with two actions under one signature, "Amount
  unavailable", "Date unavailable", Explorer link names, manual Retry calling `recovery.retry`, and Load more). The
  component test mocks the CSS module because vite cannot load the shared tailwind PostCSS config in tests. Worker 15 should look at this.
- `tsc --noEmit`: 0 errors in activity files. 3 remaining errors are outside my ownership:
  `test/api/resilience.test.ts` (×2, `RPC_URL` not exported from `@/server/rpc`), `test/planner/planner.test.ts:35`.
- Playwright chromium, `NEXT_PUBLIC_USE_FIXTURES=1 next dev`, `/activity` at 375/768/1440: horizontal overflow 0,
  48 Market rows (settled fixture), **zero** `/api/.../activity` or `/events` requests in Market mode while disconnected.
  Screenshots: `docs/frontend-v2/reports/screenshots/13/{mine-disconnected,market}-{375,768,1440}.png`.
- Not verified in a browser: the connected personal feed. The fixture wallet can't be connected headlessly. The jsdom tests cover that path instead.
- Shell note (not mine): the fixed bottom nav overlaps content in full-page screenshots, and the disconnected
  state shows a second "Connect wallet" next to the shell's.
- Market-mode "zero history requests" and 375px overflow are by construction, not verified in a browser.

## Checkpoint 1 (85a62e8) merged

- `npm ci` (client, web), `vitest run src/features/activity`: 10/10 pass.
- `tsc --noEmit`: 4 errors total, all in ActivityPage.tsx imports of not-yet-merged worker 10 modules:
  `useWalletActivity`, `useSessionOverview` (`@/lib/hooks`), `@/features/wallet-connect`, `@/features/shell`. No stubs added.
- Curator copy applied: "No older activity."; expired cursor => "This list is out of date. Reload to see the latest." with Reload action.

## Integration requests (to orchestrator / Agent 10)

1. `useWalletActivity(owner)` is assumed to return a TanStack `useInfiniteQuery` result with `data.pages:
   WalletActivityResponse[]` (recovered pages replaced in place), and `refetch()` to be the manual retry that
   re-requests pending pages via their `retryCursor` (no page-local timer). Please confirm or expose an explicit
   `retryPending()`.
2. `useSessionOverview` is called with `""` while selection loads; please accept `null` (disabled) per the
   wallet-hook convention, and I will switch.
3. Expired-cursor detection relies on the thrown error carrying `status: 400` (as `ApiRequestError` does).
