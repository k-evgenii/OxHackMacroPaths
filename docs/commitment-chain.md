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
