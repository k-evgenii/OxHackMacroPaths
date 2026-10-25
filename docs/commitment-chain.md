# Commitment chain encoding (v1, agreed)

Agreed by Dev and Phill on 2026-10-24. The off-chain keeper (`keeper/src/prepare.ts`), the reference vectors (`tests/make_vectors.py` → `tests/vectors.json`) and the on-chain `observe` must all produce these bytes exactly.

## Primitives

All integers are little-endian.

| Notation | Bytes |
|---|---|
| `u32(x)` | 4 bytes, unsigned |
| `i64(x)` | 8 bytes, two's complement |
| `u64(x)` | 8 bytes, unsigned |
| `str(s)` | `u32(len)` followed by the `len` UTF-8 bytes of `s` |
| `"TAG"` | raw ASCII bytes, with no length prefix and no NUL |
| `‖` | concatenation |
| `SHA256` | SHA-256, giving 32 bytes |

## Fields

| Field | Type | Value for the CPI demo |
|---|---|---|
| `i` | u32 | row index, 0..47 |
| `N` | u32 | 48, stored in `Session` |
| `period_id` | u32 | YYYYMM of row `i` (row 0 = `202101`, row 47 = `202412`) |
| `value` | i64 | `x_i` (eq. 1 of the maths doc) |
| `dataset_id` | [u8; 32] | defined below |
| `K` | i64 | 40000 |
| `D_cap` | u64 | 80000 |
| `A_cap` | u64 | 800000 |

## dataset_id

`dataset_id` binds the source data and the term-sheet parameters. It is SHA-256 over the following bytes, in this order:

```
str("PATH-DATASET-v1")
str(series_id)            "CPIAUCNS"
str(source_url)           "https://fred.stlouisfed.org/graph/fredgraph.csv?id=CPIAUCNS"
str(window_start)         "2020-01-01"
str(window_end)           "2024-12-01"
str(transform_id)         "yoy-1e6-floor-v1"
u32(L)                    L = 60, the number of levels
str(level_k)  × L         the 60 level strings exactly as published by FRED, in date order
                          (P_-12 .. P_47, e.g. "257.971"), with no reformatting
u32(N)                    48
u32(first_period_id)      202101
i64(K)                    40000
u64(D_cap)                80000
u64(A_cap)                800000
```

The raw-file SHA-256 ("source digest") is recorded in the JSON outputs but is **not** part of `dataset_id`. FRED's full-history file changes every month even when the 60 window values do not.

## Chain

```
C_N = SHA256( "PATH-END-v1" ‖ dataset_id ‖ u32(N) )                                    47-byte preimage
C_i = SHA256( "PATH-OBS-v1" ‖ dataset_id ‖ u32(i) ‖ u32(period_id_i) ‖ i64(value_i) ‖ C_{i+1} )   91-byte preimage
```

These are computed for i = N−1 down to 0. `create_session` stores `dataset_id`, `N`, `C_0` (the current commitment) and `C_N` (the terminal one). `observe(i, period_id, value)` recomputes `C_i` from the stored `C_{i+1}`, which is the commitment it carries forward. Concretely, the keeper supplies `C_{i+1}`, the program checks `SHA256(...) == current`, and then sets `current = C_{i+1}`. After 48 observations, `current == C_N`. On chain the hash is one `hashv(&[b"PATH-OBS-v1", &dataset_id, &i.to_le_bytes(), &period_id.to_le_bytes(), &value.to_le_bytes(), &next])`.

## Data rules and v1 limitations (added 25 Oct, after the external review)

The encoding above is unchanged. This section states what `dataset_id` v1 does and does not bind, and the data rules a v2 must bind.

- **v1 binds a FRED snapshot's 60 level strings**, plus the window, transform, N, first period, K and caps. It does not name:
  - the BLS series: FRED `CPIAUCNS` is the CPI-U, US city average, all items, not seasonally adjusted;
  - the vintage (FRED retrieval date);
  - the units;
  - the revision rule;
  - the missing-value rule.

  Anyone can still re-derive the 60 levels from FRED or BLS and compare. A v2 `dataset_id` should add those five fields as `str()` entries. That is a new tag (`PATH-DATASET-v2`) and a new vector file; v1 and `tests/vectors.json` stay as merged.
- **Revision rule:**
  - Use the first-published value.
  - BLS states that NSA CPI-U indexes "are final when issued", except for rare error corrections. Seasonally adjusted CPI is revised for up to five years and must not be used as a settlement row.
- **Precision:** BLS publishes CPI levels to three decimals only from January 2007, and to one decimal before that. So the 1e-4 pp precision of a pre-2007 row, and of caps estimated from pre-2007 history, is nominal: the declared rule is the object, not the digits.
- **Missing values:**
  - BLS collected no October 2025 CPI because of the 2025 lapse in appropriations. It will not publish it, nor the 12-month changes for October 2026 that need it as a base.
  - FRED's CSV has an empty value for 2025-10.
  - `data/fetch.py` fails on any empty value that `data/series.toml` does not declare in `known_missing`, and on any empty value inside a session window.
  - No v1 window (2020-01..2024-12) touches it.
- **Fallback (declared for v2, not applied anywhere yet):**
  - For a month BLS does not report by the end of the following month, use the U.S. Treasury's TIPS contingency index: 31 CFR 356 Appendix B, "an index number based on the last available twelve-month change in the CPI".
  - For October 2025 Treasury announced **325.604** on 26 Nov 2025 and "will not replace this index number even if BLS subsequently reports actual CPI". We follow the same never-replace rule.
  - The value is declared with its source in `data/series.toml` (`fallback`).
  - `tests/fallback_vector.py` reproduces it from the September 2025 and 2024 levels, and records x(2025-10) = 31489 with it.
  - Other markets use other fallbacks (inflation swaps follow ISDA's), so a session must name the rule it uses.
