# Agent 13 — Personal and Market Activity

## Mission

Create the banking-style Activity page with complete pagination semantics and a clearly separate market timeline derived from recorded observations. Personal transaction time and historical CPI month are different dimensions and must remain distinct.

## Read before editing

Read applicable repository instructions, `../README.md`, `../product-and-content.md`, `../interfaces.md`, `../api-and-architecture.md`, `../design-system.md`, `../parallel-execution.md`, and `../acceptance.md`. Read the delivery/UI/exact-data/history skills when available.

## Exclusive ownership

- `web/src/app/activity/**`.
- `web/src/features/activity/**`, including private adapters, CSS modules, and tests.

Agent 10 owns shared queries and pending-page fetching infrastructure. Agent 06 owns wallet activity data/attribution, subject to the shared roster. Request their changes through the orchestrator. Do not edit old session activity routes, API handlers, schema files, global CSS, root wiring, or package manifests.

## Parallel start

Use the frozen `useWalletActivity(owner, limit=10)` and `useSessionOverview(addr)` hooks and `useWalletConnection()`. Implement adapters and all states from foundation fixtures immediately. Simulate partial recovery and new-head arrivals in tests. Do not create a feature-private wire protocol or history query cache.

## My activity

- Group valid timestamps by Today, Yesterday, then calendar date using the browser timezone. Avoid server/browser timezone hydration disagreement by using the agreed client rendering approach.
- Group null timestamps under “Date unavailable”; preserve stable slot/action ordering within the group.
- Use one row per API action identity, not one row per signature. Several actions can share a signature.
- Row: semantic icon, plain title, human-readable session/product context, date/time, signed amount, accessible Explorer link.
- Use “Cover purchased,” “Pool deposit,” “Cover payout,” “Pool payout,” and “Refund.”
- Amount strings are signed PLAY base units. Format exactly with shared helpers; outgoing/incoming color follows sign. A null amount is “Amount unavailable,” not zero.
- Multiple mints remain identifiable and are not added together. Unknown transaction timestamps do not acquire made-up dates.
- Do not show failed transactions as successful payments. The API feed's successful-action scope is part of this release.

## Partial page behavior

The server scans signature pages, which may contain no recognized wallet actions. `nextBefore` therefore indicates the next page independently of the number of rows.

- Render successful items immediately when `pending` is nonempty.
- Keep a visible partial-data notice; do not replace the feed with an error screen.
- Preserve pending pages independently from older loaded pages.
- Use the frozen retry cursor to recover the exact original page, then replace/merge it by stable item identity.
- Honor the shared bounded retry schedule. After automatic attempts stop, show a manual retry action.
- Loading older pages must not discard pending signatures or duplicate recovered rows.
- A cursor expiration offers refresh; an unrelated owner/session cursor is an error, not a request to broaden scope.
- A page with zero actions and non-null `nextBefore` shows “No matching activity on this page” with Load more, not an end-of-history claim.
- Retain valid old data during a refresh failure and label the refresh problem.

The query layer owns network retry scheduling; your page owns accessible state presentation. Coordinate rather than implement two timers.

## Market activity

- Derive monthly rows from `SessionView.path` and terminal replay state.
- Order observations newest first by actual recorded period/index. Label the observation month, e.g. “Mar 2023 recorded: 4.98%.”
- Show a separate completion/settlement summary when applicable.
- Do not invent block times or Explorer transaction links for synthetic account-derived rows.
- Do not use Today/Yesterday grouping for historical measurement months.
- A partial replay contains only accepted observations. Do not fill the remaining months from reference data.
- Market mode must work while disconnected and must make zero transaction-history requests.

## Filters and navigation

Use a labelled My activity/Market segmented control. Respect the session-context URL contract used by redirects and the shell. My activity is wallet-dependent; Market is not. Empty/disconnected states should explain that distinction and offer a clear switch/connect action.

Where the frozen design supports filters, filtering is over loaded data and must not imply the full server history has been searched. Do not invent a backend search parameter.

## Verification

Test date boundaries including browser timezone and daylight-saving changes, null times, multiple actions per signature, signed/zero/unavailable amounts, fixture-owner versus unrelated owner, partial page recovery, page expiration, new head arrivals, empty matching page with continuation, load-more failure, owner switching, and disconnected Market mode.

Check keyboard operation, row/link accessible names, focus preservation when rows recover, mobile amount wrapping, long descriptions, and no horizontal overflow at 375 px.

## Handoff

Provide route/features, tests, screenshots, exact query-layer integration requests, base SHA, and branch/commit reference. Keep old session activity code intact for Agent 15's original-baseline migration.
