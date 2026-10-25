# Frontend v2 foundation report

## SHAs

| What | SHA |
| --- | --- |
| Original frontend (origin/evgenii/frontend) | `d2f3aa8` |
| Pack commit (docs + skills) | `ca7980c` |
| origin/dev/web-config-congruence (daveck11, 2 commits on d2f3aa8) | `f42704f` |
| Merge of f42704f into integration | `6d2865b` |
| Foundation commit 1 (schemas, helpers, fixtures, ports) | `5422649` |
| Foundation commit 2 (deps, UI wiring, harness) = CHECKPOINT 1 | `85a62e8` |
| Foundation report | `1356a6d` |
| DOM test env (jsdom, @testing-library/react) = CHECKPOINT 1.1 | see git log |

Branch `frontend-v2/integration`, worktree `D:/Oxhack/fe2/integration`. Nothing pushed.

## Environment

- Windows Git Bash has no node. All npm/node commands ran in WSL Ubuntu through Pixi:
  `wsl -d Ubuntu -- bash /mnt/d/Oxhack/fe2/tools/w.sh <pkg> '<cmd>'`, where `w.sh` does
  `cd /mnt/d/Oxhack/fe2/integration/<pkg> && pixi run --manifest-path .../pixi.toml bash -c "<cmd>"`.
  Pixi installed its env into the worktree's ignored `.pixi/`. Node v20.20.2, npm 10.8.2.
- git ran on the Windows side (core.autocrlf=true).

## Baseline (merged 6d2865b, before foundation changes)

| Command (cwd) | Result |
| --- | --- |
| `npm ci` (packages/client, web) | ok |
| `npx vitest run` (packages/client) | 1 file, 14/14 passed |
| `npx tsc --noEmit` (packages/client) | 0 errors |
| `npx vitest run` (web) | 12 passed + 1 skipped files; 87 passed, 1 skipped (live.test, needs RPC) |
| `npx tsc --noEmit` (web) | 0 errors |

## After foundation (85a62e8)

| Command (cwd) | Result |
| --- | --- |
| `npx vitest run` (packages/client) | 2 files, 61/61 passed (14 old + 47 fixture/helper contract tests) |
| `npx tsc --noEmit` (packages/client) | 0 errors |
| `npx vitest run` (web) | 14 files; 92 passed, 1 skipped. In one full run `test/lib/identifiers.test.ts` timed out at 5 s (it walks web/src on the slow /mnt/d mount while other files run); run alone it passes 4/4. Not a logic failure, but it can flake on /mnt/d. |
| `npx tsc --noEmit` (web) | 0 errors |
| `npx eslint` (web) | 0 problems |
| `npx next build` (web, prebuild skipped) | compiled, typechecked, generated 7/7 static pages, then failed in "Collecting build traces" with `ENOENT .next/server/app/_not-found/page.js.nft.json` (likely a /mnt/d drvfs filesystem race). Not reproduced on a native FS. Worker 15 should rerun on a Linux-native path or on Windows node. |

## Artifact overwrite during builds

`web/package.json` `predev`/`prebuild` run `scripts/copy-artifacts.mjs`, which copies `../forecast/{manifest,table,planner}.json` over `web/public/data/` **when `forecast/` exists**. It exists in this worktree, so `npm run build` / `npm run dev` would rewrite the committed artifacts. Worker 07 owns removing that. Until then, bootstrap and workers must run:

- `npx next build` (not `npm run build`) and `npx next dev` (not `npm run dev`).

The research bundle fixture hashes the committed git blobs (`git show HEAD:web/public/data/*.json`), so a rewritten working copy is detected by the client contract test.

## Dependencies (web/package.json, lock committed)

- `next` 15.5.4 → 15.5.28, `eslint-config-next` 15.5.28, `react`/`react-dom` 19.1.0 → 19.1.10 (patched 15.5 / 19.1 lines; 15.5.4 had the CVE-2025-66478 warning).
- `@solana/wallet-adapter-base` ^0.9.28, `-phantom` ^0.9.30, `-solflare` ^0.6.34 (peer `@solana/web3.js ^1.99.0`; `npm ls` shows a single deduped web3.js 1.99.0). No `wallet-adapter-react` ConnectionProvider, so no browser RPC is implied.
- `@upstash/redis` ^1.39.0: HTTP/REST client, no persistent TCP connection, which suits Vercel serverless cold starts and the Vercel Marketplace Upstash integration; supports `SET NX PX` and `EVAL` for the lease/cooldown operations. ioredis needs a long-lived socket per instance.
- `server-only` 0.0.1.
- dev: `msw` ^2.15.0, `@playwright/test` ^1.64.1, `playwright` ^1.64.1. Browsers are **not** downloaded (`npx playwright install chromium` is worker 15's step).
- `@macropaths/ui` `file:../packages/ui` (already in `transpilePackages`).
- `@anchor-lang/core` 1.0.2 and `@solana/web3.js` 1.99.0 unchanged.
- `packages/client/package.json` exports gained `./types`, `./format`, `./presentation`.
- `web/vitest.config.ts` include widened to `*.test.tsx`. Default is still `environment: "node"`. Checkpoint 1.1 adds dev `jsdom` ^26, `@testing-library/react` ^16, `@testing-library/dom` ^10. Opt in per file with `// @vitest-environment jsdom` (see `web/test/support/dom-environment.test.tsx`).

## What the foundation provides

- `packages/client/src/types.ts`: ReadMeta, ReadSection(schema factory)+type, SessionPresentationMetadata, ProductKey, CatalogResponse, CoverOfferStatus, SessionOverviewResponse, WalletOverviewResponse, HistoryPageMeta, EventsResponse (now HistoryPageMeta + events), WalletActivityKind/Item/Response, `walletActivityId()`, ManifestProduct, Manifest, Fit, Forecast, Scenario, PlannerArtifact, Sha256Hex, ResearchTerm, ResearchBundle. EventView branches gained `session` and `eventIndex`.
- `packages/client/src/decode.ts`: `parseEvents` sets `session` from the event data and `eventIndex` = position among all parsed MacroPaths events of the transaction.
- `packages/client/src/presentation.ts`: `sumAmounts`, `calculateAccruedScores`, `summarizeHolding`, `AmountSummary`, `HoldingSummary`, re-exports `fmtPpDifference`, `fmtPointMonths`, `fmtQuotePlay` (implemented in `format.ts`). All bigint-exact; worker 01 hardens.
- `packages/client/fixtures/frontend-v2/`: generated by `_generate.py` (deterministic), indexed by `index.ts` (`frontendV2Fixtures` with schemas, `scenarios` typed accessors), parsed by `packages/client/test/frontend-v2-fixtures.test.ts`. Scenarios: catalog (reference, synthetic multi), disconnected (`scenarios.disconnected`, no wallet query), sessions open/running/refunding/settled/settled-mint-b/research-match, overviews session-a/open/open-unfunded/open-missing-seller-quote/running/refunding/settled/section-unavailable, wallets empty-owner/a-owned/open/running/settled-unclaimed/settled-claimed/refunding/two-mints/section-unavailable, activity full/empty/partial/throttled/refund, events session-a-page/partial/throttled/two-sessions-one-tx (raw + session-A view), research bundle + terms-match/terms-mismatch-session-a. Synthetic files carry `_synthetic`.
- `web/src/server/contracts.ts`, `web/src/lib/presentation/contracts.ts`, `web/src/features/wallet-connect/contracts.ts` (also `SelectedSession`/`UseSelectedSession`), `web/src/lib/queries/keys.ts` (`queryKeys`, `HistoryPageParam`), `packages/ui/src/glow-chart/types.ts`, `packages/ui/src/primitives-types.ts`. Types only; nothing bound to pages.
- `web/test/support/frontend-v2/handlers.ts`: `handleFixtureRequest`, `createFixtureFetch(opts)`, `fixtureMswHandlers(opts)` for catalog, overview, events, wallet, activity, bundle; options choose scenarios and forced failures. `harness.test.ts` smoke-tests it and asserts no file under `web/src` imports `test/support` or `fixtures/frontend-v2`. No production path or `NEXT_PUBLIC_USE_FIXTURES` wiring was added (worker 10 owns api-client).

## Interface decisions

1. `ReadSection` is exported as a zod schema factory `ReadSection(dataSchema)` plus a generic TS type of the same name.
2. `HistoryPageMeta` fields are plain strings, not signature-validated; route input validation of `before` is the route worker's job. `WalletActivityItem.signature` is also a plain string.
3. `WalletActivityItem.amount` uses `I64` (signed). `CatalogResponse.defaultSession`, session addresses, owner, mint, `associatedSession` use `Pubkey`.
4. `ResearchTerm.threshold` is `I64 | null`, `cap`/`quoteMillionths` are `U64`.
5. `eventIndex` counts every event the Anchor `EventParser` yields for the transaction (including event names the view does not map), in log order.
6. The legacy `/api/sessions/[addr]/events` route (`chain.ts getSessionEvents`) now returns `pending` (signatures where `getTransaction` returned null; previously silently dropped) and `retryCursor: null`, and filters with `parseEvents(all logs).filter(e => e.session === session)` instead of Dave's pre-parse `logsForSession` (still exported, now unused), so `eventIndex` is not shifted by the filter.
7. `summarizeHolding` status rules: Open → undetermined; Running before the first observation → undetermined; Running with observations → `illustration` with `amount` from accrued scores (temporary budgets for positions, `coverPayout` for covers) and **`unclaimed: null`** (not claimable yet), so `unclaimedTotal` is null while any Running/Open holding exists; Settled → `payout` from view payouts; Refunding → `refund` from deposits/premiums; claimed → `claimed`, amount kept, unclaimed `'0'`. If a Settled view lacks payout the status is `undetermined`. Worker 01 may revise this rule only through the coordinator.
8. `calculateAccruedScores`: Settled → recorded scores; Running with `nextIndex > 0` → `score(maxDecline, dCap)`, `score(excessAcc, aCap)`; otherwise null.
9. Formatters: `fmtPpDifference("14000") = "+1.40 pp"`, zero is `"0.00 pp"` (no sign); `fmtPointMonths("691184") = "69.1 point-months"`; `fmtQuotePlay("57153") = "0.057153 PLAY"`.
10. Research schemas were moved verbatim (no extra finite/safe-integer checks yet; JSON can't carry NaN/Infinity). Worker 07/01 may add `.finite()` and safe-integer checks.
11. Research bundle id = `research-` + first 16 hex chars of sha256(manifestHash+forecastHash+plannerHash) = `research-74f8198078d806de`; hashes are SHA-256 of committed git blob bytes; `generatedAt: null`; `associatedSession: null`. Terms come from the manifest products and forecast quotes: cooling cap 76973 (1e-4-pp, threshold null, quote 384852), excess k 40000 cap 1883141 (1e-4-pp-months, quote 57153), fuel k 35000 cap 36411 (1e-4-usd-months, quote 108466, researchOnly). The committed Fuel cap is **36411**, not the 72833/72844 mentioned in api-and-architecture.md.
12. `web/src/server/contracts.ts` does not import `server-only` (type-only file; keeps vitest/type imports safe). Concrete server modules should import it.
13. Browser-safe subpaths: `@macropaths/client/types` and `/format` import only zod. `/presentation` imports `math.ts`, which imports `ONE` from `constants.ts`, which loads the IDL JSON and `@solana/web3.js`. Worker 01 should move `ONE` (or the math) so `/presentation` doesn't pull web3.js.
14. Fixture `overview/session-a.json` deliberately marks `vault` unavailable and has no seller/quote (status `closed`): the foundation doesn't know A's real vault balances or seller accounts, and the 380 PLAY contribution total is not a vault balance.
15. Offer status for Running sessions is `closed` in fixtures (deposits are closed once replay runs).
16. Web imports the fixture index by relative path (`../../../../packages/client/fixtures/frontend-v2`): the `./fixtures/*` export maps to extensionless files, which web's tsconfig can't resolve to `index.ts`.

## Baseline vs v2 gaps (Dave's f42704f vs the v2 spec; the v2 spec wins)

- **Session source (04, 10).** f42704f's single source is `DEFAULT_SESSION = NEXT_PUBLIC_DEFAULT_SESSION || sessionFixture.address` in `web/src/lib/api-client.ts`, plus an optional `SESSION_ALLOWLIST` env in `api/sessions/route.ts`. The v2 spec makes `web/config/sessions.json` the only allowlist and `/api/catalog` the source of `defaultSession`, with no competing env session list. Worker 04 replaces `SESSION_ALLOWLIST`; worker 10 replaces `DEFAULT_SESSION` with `catalog.defaultSession` / `useSelectedSession()`.
- **Sessions list (04).** `/api/sessions` still discovers via `getProgramAccounts` (discriminator + `dataSize = BorshAccountsCoder(IDL).size("Session")`) and skips undecodable accounts with a warning. v2: read registered accounts directly, report absent ones, fail on layout mismatch; discovery only for `/dev`. The size filter computed from the IDL is consistent with the spec's v1 `dataSize: 913` (worker 04 should assert the value).
- **Program id (01, 04, 10).** Dave made `PROGRAM_ID` from `@macropaths/client` the single source. This matches v2; keep it. The fixture health response in api-client uses it.
- **Events filtering (03).** Dave filters event logs by session before parsing (`logsForSession`). The foundation switched to parse-then-filter on `EventView.session` (decision 6). Worker 03's new history repository must keep parse-then-filter and the stable `eventIndex`.
- **Research vs session caps (07, 14).** `components/shell/ResearchCaps.tsx`, `app/forecast/product-card.tsx`, `forecast`/`planner` pages read the legacy `/api/artifacts/{manifest,forecast,planner}` artifacts. v2 wants the versioned `/api/artifacts/bundle` and explicit units. Session A caps 80000/800000 vs research p90 caps 76973/1883141 stay separate.
- **Shell Overview / Provenance (10, 11).** These use legacy hooks and `DEFAULT_SESSION`; v2 Dashboard/shell replace them.
- **Fixture mode (10).** `NEXT_PUBLIC_USE_FIXTURES=1` in `api-client.ts` answers only the v1 routes from the real A fixtures. The v2 routes have no fixture-mode wiring. Worker 10 decides whether to route them to `packages/client/fixtures/frontend-v2` (never as a live fallback).
- **`.env.example`** documents `NEXT_PUBLIC_DEFAULT_SESSION` and `SESSION_ALLOWLIST`; worker 15 should remove them once the registry lands.

## Files touched outside post-launch ownership (shared, foundation only)

`packages/client/**` (01), `web/src/server/chain.ts` (04: event pending/filter), `web/src/lib/artifacts.ts` (07: re-exports), `web/test/ui/activity-feed.test.ts` (new event fields), `web/src/lib/queries/keys.ts` and `web/src/features/wallet-connect/contracts.ts` (10), `packages/ui/src/glow-chart/types.ts` (09), `packages/ui/src/primitives-types.ts` (08), plus manifests/locks/configs owned by 15.

## Known risks / unfinished

- The `identifiers.test.ts` timeout flake on /mnt/d (above).
- Playwright browsers are not installed.
- `presentation.ts` is a first implementation; Running `unclaimed: null` (decision 7) is a judgement call.
- The docs mention a Fuel cap of 72833/72844, but the committed artifacts use 36411. The docs were not edited.
