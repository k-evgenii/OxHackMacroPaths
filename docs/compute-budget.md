# Compute budget

Measured 2026-10-24 on `origin/cursor_main` at `d1d9e25` (`docs: record 01c-seller-fixtures merge`). That commit adds LiteSVM seller fixtures only; program sources are unchanged since `6d4b08f`. LiteSVM loaded `target/deploy/macropaths.so` from `anchor build --ignore-keys`. Compute units are `TransactionMetadata.compute_units_consumed` on that binary. The observe mean is the integer floor of the sum of the 48 observes divided by 48.

## Compute units

Both lifecycle tests replay the same 48 rows, so observe and settle match. The claim figure is the buyer's `claim`.

| Instruction | `lifecycle_full` (G2) | `lifecycle_one_product` (G1) |
| --- | ---: | ---: |
| `observe` max | 8535 | 8535 |
| `observe` mean (floor) | 8533 | 8533 |
| `observe` sum (48 rows) | 409622 | 409622 |
| `settle` | 9148 | 9148 |
| `claim` (buyer) | 33500 | 27180 |

## Replay wall-clock

Keeper replay of the same 48 rows on a local Surfnet, `--interval-ms 2000`.

| Measurement | Value |
| --- | --- |
| Wall-clock | 96378 ms (96.378 s) |
| Interval | 2000 ms |
| 0 ms spacing | The keeper rejects an interval below 2000 ms, so this run has no 0 ms figure. |

Recovery drill on a second session: `--limit 20` posted 20 rows (0 through 19) and stopped at row 20; the next `replay` resumed at row 20 and posted the remaining 28 rows (20 through 47).
