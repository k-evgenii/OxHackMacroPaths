# Research: which macro paths are worth a contract

Exploratory, off-chain, floats allowed. Nothing here is executed against on-chain; it decides *which* products, thresholds and caps the program should carry.

| File | What |
| --- | --- |
| `macro_paths.ipynb` | The executed notebook: coverage, product rows, OU/AR(1) fits, historical 48-month window statistics with cap candidates, correlation and clustering of products, the sub-pool menu, start-of-replay forecasts, a joint simulation, and implications for the contract. |
| `products.py` | The fifteen candidate product rows: row transform, statistic family, threshold, cap rule, the economic event, who hedges (MORE side) and the natural counterparty (LESS side). Mortgage Lock-in (MORTGAGE30US) and Volatility Regime (VIXCLS) are copyrighted third-party data on FRED, so they are research rows only and stay off the sub-pool menu (`not_offerable`). |
| `macrolib.py` | Loading of `data/snapshots/*.json`, monthly alignment (daily and weekly are month-averaged, a declared rule), the exact mirrors of the on-chain recursions, rolling windows, AR(1)/OU fit and simulation. |
| `build_notebook.py` | Generates and executes the notebook. Edit this, not the `.ipynb`. |

## Run

```bash
pixi run fetch --all                        # snapshots (gitignored); needs network
pixi install --locked --environment notebook
pixi run --environment notebook research    # rebuilds and executes macro_paths.ipynb
```

Run through `pixi run`, not by calling `python.exe` directly: numpy's BLAS needs the environment's `Library/bin` on `PATH` on Windows, otherwise any matrix product aborts with `0xc06d007f`.

## Headline results (2021–2024 against 48-month windows from 1960 or the series start)

Top-decile events: real-rate shock, fuel pass-through, hiring freeze, curve inversion, mortgage lock-in. Headline excess inflation was the 80th percentile because the 1970s are in the comparison set. The stagflation composite never fired at +1 sd: unemployment stayed low, so 2022 was an inflation-and-rates shock, not a stagflation.

Two robust risk factors in the data: the inflation/rates family and the labour-break family (Sahm trigger, hiring freeze). Fuel and housing are the most separate rows (largest absolute correlation with any other product about 0.54 and 0.57); volatility correlates about 0.84 with the short-history dollar row.

## Data limitations

- `BAMLH0A0HYM2` (high-yield spread): FRED's CSV endpoint returns it only from October 2023; excluded.
- Real-rate shock, dollar surge and hiring freeze have under 200 historical windows; their correlations rest on two cycles.
- All caps labelled "p90" are the 90th percentile of post-1960 (or series-start) windows ending by December 2020, a declared rule, not a fitted risk limit.
