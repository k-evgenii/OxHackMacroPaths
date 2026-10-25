# Data contract and real numbers

All API responses are validated by zod schemas in `packages/client/src/types.ts`. Every u64 and i64 arrives as a **decimal string**.

**Units:**
- values, `k`, peak, decline and `dCap` are 1e-4 percentage points (`13997` = 1.3997%).
- excess and `aCap` are 1e-4 point-months.
- scores and prices are millionths (`827387` = 82.7387%).
- token amounts are PLAY base units with 6 decimals (`90000000` = 90 PLAY).

**Sides:** side index `j = product*2 + side`. Product 0 is Inflation Cooling, product 1 is Excess Inflation. Side 0 is "more", side 1 is "less" (labels still being confirmed).

**Formatters** in `@macropaths/client`: `fmtPp`, `fmtPpMonths`, `fmtMillionthsPct`, `fmtPlay`, `fmtPeriod(202101)` → "Jan 2021".

## Endpoints, all GET
| Route | Returns |
|---|---|
| `/api/health` | `{ cluster, slot, programId, executable }` |
| `/api/sessions` | `{ sessions: SessionSummary[] }` |
| `/api/sessions/[addr]` | `SessionView` |
| `/api/sessions/[addr]/positions` | `{ positions: PositionView[], covers: CoverView[] }` |
| `/api/sessions/[addr]/seller` | `{ seller: SellerView \| null, quote: EntryQuoteView \| null }` |
| `/api/sessions/[addr]/events?before=&limit=` | `{ events: EventView[], nextBefore }`. Currently flaky (429 → 502), see the handover §4.1. |
| `/api/artifacts/{manifest,forecast,planner}` | Research JSON for Forecast and Planner |

Errors come back as `{ error, code: "bad_request" | "not_found" | "rpc_error" | "internal" }`.

## Types (abridged)
```ts
type S = string; // decimal integer string
type SessionState = "Open" | "Running" | "Settled" | "Refunding";
interface SessionView {
  address: S; sessionId: S; authority: S; playMint: S; vaults: [S, S];
  state: SessionState; datasetId: S; commitment: S; terminal: S; integrityOk: boolean;
  nObs: number; nextIndex: number; lastPeriodId: number;          // YYYYMM
  terms: { k: S; dCap: S; aCap: S };
  depositDeadline: number; replayDeadline: number;                 // unix seconds
  sideTotals: [S, S, S, S]; matched: [S, S];
  stats: { peak: S | null; maxDecline: S; excessAcc: S };
  scores: [S, S];
  pBudget: [S, S, S, S]; rBudget: [S, S, S, S];
  counts: { positions: number; claimed: number; covers: number; coversClaimed: number; sellerProductsOpen: number };
  path: { i: number; periodId: number; value: S; peak: S; decline: S; excess: S }[]; // length = nextIndex
}
interface PositionView { address: S; owner: S; deposited: [S, S, S, S]; claimed: boolean; payout: [S, S, S, S] | null }
interface CoverView    { address: S; owner: S; units: [S, S]; premiumPaid: [S, S]; claimed: boolean; payout: [S, S] | null }
type EventView = { signature: S; slot: number; blockTime: number | null } & (
  | { type: "Observed";    data: { index: number; periodId: number; value: S; peak: S; maxDecline: S; excessAcc: S; commitment: S } }
  | { type: "Settled";     data: { scores: [S, S]; matched: [S, S]; pBudget: [S, S, S, S]; rBudget: [S, S, S, S] } }
  | { type: "Claimed";     data: { owner: S; amounts: [S, S]; refund: boolean } }
  | { type: "CoverBought"; data: { owner: S; product: number; units: S; buyerPaid: S; sellerPaid: S } }
);
```

## Reference session A (settled), for mock data
- **Session:** address `B89zLLRMtmwAKP5idiUt6ffzfetNo6xRZBbXpDVaBVju`, state `Settled`, 48 of 48 months, Jan 2021 → Dec 2024.
- **Terms:** k `40000` (4.00%), dCap `80000`, aCap `800000`.
- **Results:**
  - peak `90597`, which is 9.06% in Jun 2022.
  - maxDecline `66191`, a fall of 6.62 points.
  - excessAcc `691184`, which is 69.1 point-months.
  - scores `["827387", "863980"]`, which is 82.7% and 86.4%.
- **Vault:** sideTotals `["90000000", "100000000", "90000000", "100000000"]`, 380 PLAY locked.
- **One position:** deposited 90 / 100 / 90 / 100 PLAY, with payout 148.93 / 41.07 / 155.52 / 34.48 PLAY.
- **All 48 monthly year-on-year readings, in %:**
  - **2021:** 1.40 1.68 2.62 4.16 4.99 5.39 5.37 5.25 5.39 6.22 6.81 7.04
  - **2022:** 7.48 7.87 8.54 8.26 8.58 9.06 8.52 8.26 8.20 7.75 7.11 6.45
  - **2023:** 6.41 6.04 4.98 4.93 4.05 2.97 3.18 3.67 3.70 3.24 3.14 3.35
  - **2024:** 3.09 3.15 3.48 3.36 3.27 2.97 2.89 2.53 2.44 2.60 2.75 2.89
- **Offline mode.** Run with `NEXT_PUBLIC_USE_FIXTURES=1` and the pages get exactly this data with no network.
