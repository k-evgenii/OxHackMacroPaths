# MacroPaths frontend: handover to Codex

## 1. What this is and who it's for
- **The product.** MacroPaths is a path-dependent contract on US CPI inflation (2021–24, 48 months), settled on Solana devnet.
- **Program and reference data.** The program is `FvT786RtMTtbdXWemA9zgA9rfwhvxFsKY1ypiMMNwMbS`. Reference session A is `B89zLLRMtmwAKP5idiUt6ffzfetNo6xRZBbXpDVaBVju`, settled with scores 0.827 and 0.864.
- **Two products:**
  - **Inflation Cooling** scores the largest drop from a running peak.
  - **Excess Inflation** scores the accumulated inflation above 4%.
- **Who the client is.** A person who wants to see their wallet, their positions, the vault, beautiful charts and their transaction history. Everything technical belongs in a separate developer console.
- **Copy rule.** Never write "bet", "option", "insurance" or "fair value". Projected numbers carry "illustration until settlement".

## 2. Repo map
| Path | What it is |
|---|---|
| `packages/client/` | Typed client: IDL, PDAs, decoding, exact bigint math, view models. The zod API contract is in `src/types.ts`, and real devnet fixtures are in `fixtures/`. Tested and solid. |
| `packages/ui/` | `@macropaths/ui`, a presentational kit built from the reference screenshots: PathChart, StatCard, Meter, CompositionBar, SessionCard, ActivityFeed, Sidebar, TopBar and others. See its README. **Not used by any page yet.** |
| `web/src/app/api/**`, `web/src/server/**` | Read API as Next route handlers: health, sessions, session, positions, seller, events and artifacts. |
| `web/src/app/**` (pages) | Overview, session Summary, Path, Results, Activity, Seller, Forecast and Planner. |
| `web/src/components/{ui,shell,charts}` | The agents' components. |
| `web/public/data/` | Forecast and planner artifacts. |

**Run it:**
```bash
pixi install --locked
cd packages/client && pixi run npm ci
cd ../../web && pixi run npm ci
cp .env.example .env.local      # RPC_URL, or NEXT_PUBLIC_USE_FIXTURES=1 to run offline
pixi run npx next dev
```

## 3. What works (keep it)
- **Client library.** Decoding of the live 913-byte Session account, PDAs, `budgets` and `claimAmount` math reproduced exactly from `tests/vectors.json`, and view models. 14 tests.
- **Contract and fixtures.** Zod schemas for every API response. Fixtures come from devnet and were cross-checked by an independent Python decoder.
- **Read API.** Health, sessions, session, positions, seller and artifacts all return correct data from live devnet. Invalid input returns 400, a missing account 404, an RPC failure 502. 30 tests.
- **Fixture mode.** `NEXT_PUBLIC_USE_FIXTURES=1` runs the whole UI offline.
- **Planner port.** It matches `research/planner.py` to 1e-6 on all 21 rows.
- **Pages and build.** All 8 pages render with 200, typecheck is clean and the build passes.

## 4. What is broken or wrong

### 4.1 The events endpoint fails under rate limits (high priority)
The symptom: `GET /api/sessions/<addr>/events?limit=25` returns 502 after 3–4 s with `getTransaction 429 Too Many Requests`.

Root causes, in `web/src/server/chain.ts` and `web/src/server/rpc.ts`:
1. **One page costs 26 RPC calls.** A page of 25 events needs one `getSignaturesForAddress` call plus 25 `getTransaction` calls. The public devnet endpoint rate-limits `getTransaction` per method.
2. **All or nothing.** `mapLimit` with concurrency 4 and 4 retries (backoff 0.4, 0.8 and 1.6 s) gives up, and one failed transaction fails the whole page with a 502. The transactions that did succeed are cached but never returned.
3. **Retries multiply.** React Query retries twice (`web/src/lib/providers.tsx`), so one page view can trigger about 75 `getTransaction` calls.
4. **Market activity comes from the wrong source.** The 48 observations are already in the Session account (`values`, `next_index`). The "market" part of the activity feed doesn't need transactions at all.
5. **No persistent cache.** The cache is in-memory only, so every dev restart or serverless cold start refetches everything.

The fix, in order:
- **Partial pages.** Return a partial page instead of a 502, adding `pending: string[]` for transactions that couldn't load yet. This needs a contract change to `EventsResponse`. The client then shows "loading older activity…" and retries later.
- **Market feed from the account.** Build market activity (month N recorded, settled) from the session account plus the timestamps of one `getSignaturesForAddress` call. Use `getTransaction` only for the user's own history.
- **Gentler calling.** Concurrency 2, jittered backoff, honour `Retry-After`, page size 10, and React Query `retry: 0` for events.
- **Persistent cache.** Store parsed events by signature in a small file or KV store. Transactions are immutable.
- **Keyed RPC.** Require a Helius or QuickNode devnet URL in `RPC_URL` for anything except fixture mode, and say so in `.env.example`.

### 4.2 Other API problems
- **Unfiltered session list.** `/api/sessions` returns every Session account the program has, including test sessions. Devnet already shows a second one, `3SPTye…`. It needs an allowlist, such as `NEXT_PUBLIC_SESSIONS` or a `data/sessions.json`, or at least a "demo" flag.
- **Unbounded scan.** `getProgramAccounts` without a data-size filter scans everything. Add `dataSize: 913` beside the discriminator filter.
- **No wallet endpoints.** There is nothing for wallet balance, the wallet's positions across sessions, or per-wallet history.
- **Server code isn't guarded.** `server-only` isn't installed, so a client component could accidentally import RPC code and leak the RPC URL.
- **Artifacts may vanish in production.** `/api/artifacts` reads `public/data` from disk, which may be missing in a serverless deploy. Add `outputFileTracingIncludes`, or simply serve `/data/*.json` statically.
- **Known security vulnerability.** Next.js 15.5.4 has CVE-2025-66478. Upgrade to the patched 15.5.x.
- **Multiple lockfiles.** Next warns because there are lockfiles at the root and in `web`. Set `outputFileTracingRoot`, or make the root an npm workspace.

### 4.3 UI critique (be harsh, everything is negotiable)
- **It is a database viewer, not a product.** Every field of every account is on screen: dataset ID, commitment and terminal hashes, vault, mint and authority pubkeys, P and R budgets, `matched`, raw side totals, account counts, slot numbers and raw-integer tooltips. A client understands none of it.
- **No hierarchy.** Pages are grids of equal-weight Stat tiles. Nothing says "this is the one number that matters".
- **Units leak.** Numbers like "691184" and "1e-4 pp-months" appear, or barely formatted percentages. Every number needs plain words: "Inflation spent 69 point-months above 4%".
- **Ugly charts.** Default Recharts styling, thick lines, gridlines and legends. The target is a single 1.5 px line with a soft glow and a faint gradient fill.
- **Too many tabs.** Summary, Path, Results, Activity and Seller split one story across five pages. A client needs one session page.
- **Three component systems.** `web/src/components/ui`, `components/charts/_fallback/ui.tsx`, `app/planner/_fallback`, and the unused `packages/ui` kit all exist. There are also three format implementations (`packages/client/src/format.ts`, `web/src/lib/hooks/format.ts`, `components/charts/_fallback/format.ts`). Pick one of each.
- **Generic typography.** System UI font, no type scale, cramped spacing. It looks like an admin template.
- **No wallet.** The "Connect wallet" button is a disabled placeholder. Without a wallet the client view has nothing personal to show.
- **The Seller page is empty** for every current session.
- **The Forecast page exposes model internals.** It shows AR(1) parameters, half-lives and residual standard deviation. That belongs in the developer console.
- **The Planner leads with a 21-row table** instead of the answer.
- **Never seen in a browser.** No hydration check, no 375 px check and no accessibility pass have been done. Every check so far was curl and build.
- **Wrong side labels.** The kit's labels "Protection" and "Counterparty" contradict the program spec, which names side 0 "more" and side 1 "less". Confirm the wording with the program owner, Evgenii, before using it.

### 4.4 Process and debt
- No agent ran a code review. The integration fixes are in commit c4a5424.
- `Prefetch.tsx` runs only in fixture mode, as a workaround. Rethink it once the real server-side data path exists.
- The live devnet test (`web/test/api/live.test.ts`) fails on the public RPC because of 429s.
- Reference session A uses the test caps (80 000 and 800 000), not the demo-manifest p90 caps, so the live demo session will show different scores.

## 5. Target design
**Look:** dark warm background, one orange accent, and green or red only for direction. The reference screenshots are the ones in `packages/ui/README.md`: Capsule dashboard, Bitcoin glow line, banking app, AERIS.
- **Typography:** big numbers with small muted labels and generous space.
- **No tables on client screens** except the transaction list.

**Charts everywhere:**
- One thin 1.5 px line with an SVG Gaussian-blur glow and a 0→8% opacity gradient fill.
- No gridlines. A few muted ticks.
- A dashed threshold line, and one highlighted point with a value bubble.
- Smooth tooltip, animated draw-in, and responsive from 375 px up.

**Client app:**
1. **Dashboard** (home once a wallet is connected).
   - A wallet card: PLAY balance, address with copy, devnet "Get test PLAY".
   - Your positions: stake, expected payout and a status pill per session.
   - A glowing sparkline tile per product.
2. **Session** (one page).
   - Hero glowing path chart with a 4% threshold line.
   - Three key numbers: latest inflation, each product's score so far, months left or "Settled".
   - Vault status: total locked, the more/less split per product as a composition bar, and replay progress out of 48.
   - Your position card with a Claim button.
3. **Activity.**
   - A transaction-history list grouped by Today, Yesterday and date: deposits, covers, claims and refunds, with amount and an Explorer link.
   - A "Market" toggle with plain-word events built from the account, for example "Month 37 recorded: 7.1%".
4. **Products and Planner.**
   - Two product cards showing price, maximum payout and a button.
   - The planner shows one recommendation sentence, with the full table behind "See all options".

**Developer console at `/dev`**, hidden and enabled by `NEXT_PUBLIC_DEV_CONSOLE=1` or `?dev=1`:
- The current pages move here nearly as they are: hashes, PDAs, budgets, raw integers, the event log, forecast fit parameters and the full planner table.
- Add an API explorer that calls each `/api` route and shows the JSON.

## 6. Work order for Codex
1. **Fix the events endpoint** as in 4.1, with tests for partial pages and 429 handling. Upgrade Next to the patched version. Add `server-only` and the `dataSize` filter.
2. **Move today's pages under `/dev`** behind the flag. This is mostly moving files and fixing links.
3. **One design system.** Adopt `packages/ui`, extended where needed. Delete `components/charts/_fallback`, `app/planner/_fallback` and the duplicate format helpers, and use `@macropaths/client` format functions only. Write an adapter from `SessionView` to the kit's props, because the kit's `session.ts` expects a raw Anchor account.
4. **Glowing chart component**, used by the session hero, the sparklines and the forecast.
5. **Client Session page** and **Products/Planner**, read-only.
6. **Wallet.**
   - Wallet adapter (Phantom, Solflare) and the wallet card.
   - New routes: `/api/wallet/[owner]` for balance and positions across sessions, and `/api/wallet/[owner]/activity`.
   - Then the deposit, `buy_cover`, `claim` and `claim_cover` transaction builders. Reuse `keeper/src/program.ts` `instruction()` and the client PDAs.
7. **Test PLAY faucet** (decision pending: a server route holding the keeper key, or a keeper command).
8. **Polish.** Browser check at 1440 px and 375 px, an accessibility pass, empty and loading states, and a copy pass for the rule in section 1.

## 7. Constraints
- **Stack is fixed:** `@anchor-lang/core` 1.0.2 and `@solana/web3.js` 1.x. No `@solana/kit` and no Codama (AGENTS.md).
- **Chain math stays bigint.** Never use floats on chain values. Floats are fine in the planner, which is research only.
- **The contract changes in one place.** Keep `packages/client/src/types.ts` as the single contract. Change it deliberately and update the fixtures and contract test with it.
- **Keep tests green.** `npx vitest run` and `npx tsc --noEmit` in `packages/client` and `web`, and `npx next build`.

## 8. Open decisions for the team
- Who is the client: a cover buyer only, or both sides of the pool?
- Does test PLAY come from a server faucet or a keeper command?
- Should the developer console ship in the demo build behind a flag?
- Side labels: "more" and "less", or "Protection" and "Counterparty"?
- The live demo session's address, created with the demo-manifest caps.
