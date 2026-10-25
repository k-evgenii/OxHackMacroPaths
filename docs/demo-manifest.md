# Demo manifest: caps, prices, and what is executable

Decided 24 October 2026 (Evgenii, after the research review). Branch `evgenii/macro-research`; nothing here changes the program.

## The rule for caps

Caps are **declared quantiles, not fitted risk limits**: for each product, the nearest-rank 90th percentile of its statistic over every 48-month window of the integer row that starts on or after January 1960 or the series start (gasoline: August 1990) and ends on or before December 2020. Integer by construction. Computed by `forecast/manifest.py`, frozen in `forecast/manifest.json`.

| Product | Row | Statistic | K | Cap | Windows | 2021–24 statistic | Score |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Inflation Cooling (product 0) | CPI-U YoY, 1e-4 pp | max decline from running peak | – | 76 973 (7.70 pp) | 685 | 66 191 | 0.8599 |
| Excess Inflation (product 1) | CPI-U YoY, 1e-4 pp | accumulated excess | 40 000 | 1 883 141 (188.31 pp-months) | 685 | 691 184 | 0.3670 |
| Fuel Pass-through (research) | gasoline month-mean, 1e-4 usd | accumulated excess | 35 000 | 36 411 (3.64 usd-months) | 318 | 72 833 | 1.0000 |

The agents' tests keep the original cap of 80 pp-months and `tests/vectors.json` v1; those are test constants. The demo session is created with the manifest's caps, which gives it its own commitment chain (`tests/vectors-demo.json`, `data/cpi-yoy-replay-demo.json`) because the dataset ID binds `K, D_cap, A_cap`.

## The price convention

The demo does **not** use the matched pool's implicit price of 0.5. With the p90 cap the Excess score of 2021–24 is 0.367, so a hedger paying 0.5 per unit would have lost money in the worst inflation episode in forty years. The entry price is the seller's posted quote, `p = clamp(V₀ + 0.5·σ₀, 0.05, 0.95)` from the AR(1) baseline in `forecast/table.json`:

| Product | V₀ | σ₀ | Quote p | Realised score | Payout per unit staked at p |
| --- | --- | --- | --- | --- | --- |
| Cooling | 0.318 | 0.133 | 0.3849 | 0.860 | 2.23 |
| Excess | 0.024 | 0.066 | 0.0572 | 0.367 | 6.42 |
| Fuel (research) | 0.032 | 0.152 | 0.1085 | 1.000 | 9.22 |

The baseline forecast was wrong about 2021–24 on every product; that is what the buyer was paying to be protected from, and the seller loses most of its escrow. Say both on stage. The model is advisory; settlement uses the realised path only.

## The planner

`research/planner.py` answers: given a monthly gasoline exposure, a budget price of 3.50 per gallon and a protection budget, which of 21 policies (cash; Excess cover at ten stakes; Fuel cover at ten stakes) has the lowest **TailLoss95**, the mean of the worst 5 % of historical funding shortfalls over 318 overlapping 48-month windows from August 1990. Shortfall is `max(overrun − cash left − payout, 0)`; ties go to the lower stake, then cash. The objective is blind to premium wasted in calm years, so the screen shows expected end-of-period cash beside it.

Default inputs (100 gal/month, budget 200): recommended **Fuel cover, stake 40**, tail loss 0 in history; on the 2021–24 showcase that policy leaves 199.6 uncovered against 528.3 with cash alone. Excess Inflation cover is worse than cash for a fuel bill at any stake. Fuel is labelled a research product: it is not settled on chain this weekend.

## Regenerate (in order)

```
pixi run fetch --all                  # snapshots, gitignored
pixi run manifest                     # forecast/manifest.json
pixi run forecast                     # forecast/table.json (49 rows x 3 products, quotes)
pixi run planner-artifact             # forecast/planner.json for the web screen
pixi run test-planner
pixi run vectors -- --manifest forecast/manifest.json --out tests/vectors-demo.json
pixi run -- npx tsx keeper/src/prepare.ts --manifest forecast/manifest.json --out data/cpi-yoy-replay-demo.json --check tests/vectors-demo.json
```

`pixi run vectors` with no flags is unchanged and must still print `D=66191 A=691184 827387 863980`.


## Walk-forward (descriptive)

Generated from `forecast/walkforward.json` (Excess, K = 40000, cap 1883141, 10000 paths). With n = 11 origins this cannot validate a 10 % tail: a count of 4 or more exceedances is needed to question the 90th percentile at all. The table is descriptive, not a backtest of a trading strategy.

Cap look-ahead: the declared cap is the p90 over windows ending 2020-12, so it uses information after every origin. The file's `cap_rederived_variant` re-derives it from windows ending before each origin. Fuel is excluded because its series starts in August 1990.

Mean error 0.086, RMSE 0.184, share inside the band 0.73; random-walk benchmark mean error 0.041, RMSE 0.167.

| Origin | V0 | Quote | Realised | Seller result |
| --- | --- | --- | --- | --- |
| 1975-01 | 1.000 | 0.950 | 0.832 | +0.118 |
| 1979-01 | 0.975 | 0.950 | 1.000 | -0.050 |
| 1983-01 | 0.210 | 0.320 | 0.020 | +0.301 |
| 1987-01 | 0.024 | 0.057 | 0.160 | -0.103 |
| 1991-01 | 0.565 | 0.701 | 0.036 | +0.665 |
| 1995-01 | 0.075 | 0.138 | 0.000 | +0.138 |
| 1999-01 | 0.026 | 0.059 | 0.000 | +0.059 |
| 2003-01 | 0.048 | 0.096 | 0.009 | +0.087 |
| 2007-01 | 0.059 | 0.113 | 0.031 | +0.082 |
| 2011-01 | 0.032 | 0.071 | 0.000 | +0.071 |
| 2015-01 | 0.017 | 0.050 | 0.000 | +0.050 |
