---
name: macropaths-exact-data
description: Work with MacroPaths session, pool, cover, wallet and research values without mixing units, session caps, payout mechanisms or data availability. Use when implementing schemas, financial read models or amount presentation.
---

# MacroPaths exact data

Read [wire/interfaces](../../../docs/frontend-v2/interfaces.md) and the [economic meanings](../../../docs/frontend-v2/product-and-content.md). Shared schemas and pure calculations belong to worker 01, not individual screens.

## Units

| Quantity | Wire scale |
| --- | --- |
| CPI readings, threshold, peak, decline and decline cap | 1e-4 percentage points |
| CPI accumulated excess and excess cap | 1e-4 point-months |
| Scores and quote prices | Millionths, ONE=1000000 |
| PLAY amounts | Base units with six decimals |

All chain i64/u64 values are decimal strings. Parse them with BigInt for calculations and use shared exact formatters. A score of 827387 is about 82.7% of the normalized statistic, not a probability or investment return. A quote of 57153 represents 0.057153 PLAY per one PLAY maximum cover payout; it is not a live offer unless read from the selected session's quote.

## Mechanisms and state

- Side index is product*2+side; v1 product 0=Cooling, product1=Excess; side0=More, side1=Less.
- Pool payouts use side budgets and claimAmount. Cover payouts use score*units/ONE with program flooring. Premium paid is not units or seller escrow.
- Running illustrations derive scores and temporary pool budgets from the recorded path. Existing unsettled P/R budgets are not an expectation model.
- Settled uses recorded payouts; Refunding returns deposits/premiums; Open without observations is undetermined. Claimed items keep historical payouts but contribute zero to unclaimed totals.
- sideTotals records historical contributions. Only actual token-account reads establish current vault holdings. Deposited-minus-payout is not protocol dust.
- Distinct PLAY mints remain separate. Illustrative research USD is not convertible into wallet PLAY.
- Missing accounts after successful reads can be empty/zero. Failed reads are explicitly unavailable, never an invented empty result.

## Session and research identity

Reference A uses caps 80000/800000 and scores 827387/863980. The p90 research bundle uses different caps. Never borrow its scores or quotes for A. A replay period is not a transaction date. Incomplete integrityOk is not an alarming verification failure during normal replay.

Research floats are allowed only inside model calculations and bounded display conversion. Shared normalized scaled fields stay lossless; unsafe integer conversion fails. Keep manifest/forecast/planner revisions together and verify an association before overlaying research on a session.

## Evidence

Use the existing math vectors and real fixtures for chain accounting. Add labelled synthetic scenarios for unavailable reads, large values, empty, Running, Refunding and claimed states. Report exact helpers used; do not add screen-local financial formula copies.
