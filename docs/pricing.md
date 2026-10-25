# What the prices mean (matched pool, seller quote, rounding)

Response to findings 3, 5 and 6–7 of the external review (25 Oct). Every formula here is the one in `docs/program-spec.md` and `programs/macropaths/src/math.rs`; nothing on chain changed.

## The matched pool has an implied price of 0.5

For each product the program matches `M = min(S0, S1)` from the two sides. At settlement with score `s` (millionths), side 0 ("more") gets `P0 = floor(2·M·s/ONE)` and side 1 ("less") gets `P1 = 2M − P0`. Unmatched stake `R_j = S_j − M` is returned.

So one matched unit on side 0 pays `2s`, and on side 1 it pays `2(1 − s)`. Both sides pay 1 for a claim worth twice the score, or twice one minus the score. That is an **implied price of 0.5 for the score**. Neither side expects to gain only if the expected score is exactly 0.5. Below 0.5 the "less" side is favoured on expectation; above it, the "more" side is.

Which case applies depends on the model and caps, so we don't claim one. At the 2021-01 origin:

| AR(1) specification | Cooling V0 | Excess V0 | Source |
|---|---|---|---|
| fit from 1914, caps 8 / 80 | 0.663 | 0.249 | PR #32 `backtest.md` |
| fit 1997–2020, caps 8 / 80 | 0.319 | 0.008 | PR #32 `backtest.md` |
| fit 1960–2020, pre-2021 p90 caps 76973 / 1883141 | 0.318 | 0.024 | `web/public/data/forecast.json` |

The matched pool is therefore a **two-view instrument**: two people who disagree about the path take opposite sides at 0.5. It is not a protection price. **Protection is bought at the seller's quote**, which is how the demo buys cover.

## The seller's quote is a declared policy

- **What the program enforces:** the program checks the quote only against `QUOTE_MIN ≤ p ≤ QUOTE_MAX`, i.e. 0.05 to 0.95. `set_entry_quote` runs only while the session is Open and before `deposit_deadline`, and the first `buy_cover` freezes the quote.
- **Cash flows for `U` units of cover:**
  - the buyer pays `ceil(p·U/ONE)`;
  - the seller escrows `U − premium`;
  - at settlement the buyer receives `floor(s·U/ONE)` and the seller keeps the rest.
- **The demo's policy:** `p = clamp(floor((V0 + κ·σ0)·10^6), 50000, 950000)` with `κ = 0.5`.
  - `V0` and `σ0` are the AR(1) forecast's mean and standard deviation of the score at the origin.
  - The policy is the one recorded in `web/public/data/manifest.json` (`price_convention`) and `forecast.json` (`quotes.formula`) on `evgenii/frontend`.
  - Those files give quotes of `p = [384852, 57153]` (Cooling, Excess) with pre-2021 p90 caps.
  - The script that writes those numbers is `forecast/ar1.py`: `pixi run forecast` regenerates `forecast/table.json` byte-identical, including the fuel research quote 108466 (0.108466).
- **What the quote is and isn't:** it is a policy the seller declares. It is not a forecast, and it is not a validated price. The forecast is advisory; settlement uses only the realised path.

## What the history does and does not show

The rolling-origin backtest (PR #32, `forecast/backtest.md`) asked what a seller following this policy would have earned, using pre-origin caps and κ = 0.5.

- **The result:** a mean result per unit of +0.301 (Cooling) and +0.205 (Excess).
- **Why that is not evidence the policy works:** the result mostly reflects quotes set from a forecast that runs high. The primary AR(1) is poorly calibrated: 57% of Cooling PITs fall in the lowest decile, against 10% if it were calibrated.
- **Limits that apply to any historical result here:**
  - **Small sample:** the 673 monthly origins overlap heavily. They hold about 14 independent 48-month blocks.
  - **No carry:** a position locks capital for four years. At a 4% annual rate, that forgoes 1.04⁴ − 1 ≈ 17% of the stake (undiscounted, simple compounding), and none of the results above charge for it.
  - **No tail model:** a Gaussian AR(1) on overlapping year-on-year rows has thin tails. Option-implied inflation densities can be fatter-tailed than a Gaussian; we have not measured that here, so treat it as a caution, not a finding.
- **Next model:** simulate monthly price changes and rebuild year-on-year inflation by summation. That respects the lag-12 overlap.

## Rounding (declared bounds, verified)

All divisions floor. The bounds below were checked with exact integer arithmetic, both on random inputs (up to `10^15` base units) and by residue analysis.

| Where | Rule | Bound | Who it favours |
|---|---|---|---|
| Side budgets | `P1 = 2M − floor(2·M·s/ONE)` is the ceiling of `2M(ONE − s)/ONE` | `P1` exceeds its exact share by less than 1 base unit | side 1, by under 1 unit per product |
| Pool claims | `floor(a·R_j/S_j) + floor(a·P_j/S_j)` | each position is short by less than 2 base units; the shortfall stays in the vault as dust and `sweep_dust` empties it | nobody (dust) |
| Cover premium | `ceil(p·U/ONE)` | over by less than 1 base unit | the seller |
| Cover payout | `floor(s·U/ONE)` | short by less than 1 base unit | the seller |
| Fuel row (research, not executable; v2 proposal, not on chain) | monthly mean of the weekly prices dated in that calendar month (by the Monday date), in 1e-4 $, floored | GASREGW prices have 3 decimals, so the loss per month is at most 2/3 × 1e-4 $ with 3 weekly rows, 1/2 × 1e-4 $ with 4 and 0 with 5. This is within the review's stated 0.75e-4 $. | the seller (a lower row lowers an accumulated-excess score) |

Score rounding: `score = floor(ONE·min(stat, cap)/cap)` is short of the exact ratio by less than one millionth.
