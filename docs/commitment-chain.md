# Commitment chain

Byte-exact definition shared by `programs/macropaths/src/chain.rs`, `tests/make_vectors.py` and `keeper/src/prepare.ts`. A worked byte dump of `C_48` and `C_47` for the frozen CPIAUCNS series is below.

Byte encoding, identical in Rust, Python and TypeScript:

```
dataset_id = SHA256( utf8(source_url) ‖ 0x0A ‖ utf8(retrieved_at) ‖ 0x0A ‖ utf8(sha256_of_raw hex, lowercase) )
             (the three fields of data/snapshots/CPIAUCNS.json)
period_id  = year*100 + month   as u32           (202101 for Jan 2021)
C_48       = SHA256( "PATH-END-v1" ‖ dataset_id[32] ‖ u32_le(48) )
C_i        = SHA256( "PATH-OBS-v1" ‖ dataset_id[32] ‖ u32_le(i) ‖ u32_le(period_id_i) ‖ i64_le(x_i) ‖ C_{i+1}[32] )   for i = 47 down to 0
```

Session stores `commitment = C_0` at creation and `terminal = C_48`. `observe(i, period, x, next)` recomputes `C_i` from its arguments and `next`, requires it equals the stored commitment, then stores `next`. After 48 accepted observations the stored commitment equals `terminal`; `settle` requires that. Rust: `anchor_lang::solana_program::hash::hashv(&[b"PATH-OBS-v1", &dataset_id, &i.to_le_bytes(), &period.to_le_bytes(), &x.to_le_bytes(), &next]).to_bytes()` with `i: u32`.

## Worked byte dump, CPIAUCNS

The three identity strings are the frozen snapshot fields in `tests/vectors.json` `provenance`. `x_47 = 28880` is `rows[47].x` (Dec 2024). Integers are little-endian. Each digest is SHA-256 of the raw concatenation, with no length prefix.

### dataset_id

```
utf8("https://fred.stlouisfed.org/graph/fredgraph.csv?id=CPIAUCNS")
‖ 0a
‖ utf8("2026-10-24T15:14:23Z")
‖ 0a
‖ utf8("cfab9b9be4a5d4f06253c4dcc3f7e0b28b1d58837e710dd7cb1fd54a49e7ad7c")
```

Preimage, 145 bytes:

```
68747470733a2f2f667265642e73746c6f7569736665642e6f72672f67726170682f6672656467726170682e6373763f69643d4350494155434e530a323032362d31302d32345431353a31343a32335a0a63666162396239626534613564346630363235336334646363336637653062323862316435383833376537313064643763623166643534613439653761643763
```

`dataset_id = 486e92b7d925dde8fd458fb8465e0aae5185d45a6b6d6fb9489b1c528adb686d`

### C_48

| field | hex |
| --- | --- |
| `PATH-END-v1` | `504154482d454e442d7631` |
| `dataset_id` | `486e92b7d925dde8fd458fb8465e0aae5185d45a6b6d6fb9489b1c528adb686d` |
| `u32_le(48)` | `30000000` |

Preimage, 47 bytes:

```
504154482d454e442d7631486e92b7d925dde8fd458fb8465e0aae5185d45a6b6d6fb9489b1c528adb686d30000000
```

`C_48 = 568aedd9fa2594aab98f9520c5c27c5e2d2ff978eec9194fd547dbbe3bd3bcbf`

### C_47

`period_id_47 = 202412`, `x_47 = 28880`.

| field | hex |
| --- | --- |
| `PATH-OBS-v1` | `504154482d4f42532d7631` |
| `dataset_id` | `486e92b7d925dde8fd458fb8465e0aae5185d45a6b6d6fb9489b1c528adb686d` |
| `u32_le(47)` | `2f000000` |
| `u32_le(202412)` | `ac160300` |
| `i64_le(28880)` | `d070000000000000` |
| `C_48` | `568aedd9fa2594aab98f9520c5c27c5e2d2ff978eec9194fd547dbbe3bd3bcbf` |

Preimage, 91 bytes:

```
504154482d4f42532d7631486e92b7d925dde8fd458fb8465e0aae5185d45a6b6d6fb9489b1c528adb686d2f000000ac160300d070000000000000568aedd9fa2594aab98f9520c5c27c5e2d2ff978eec9194fd547dbbe3bd3bcbf
```

`C_47 = aa72917a464710461b02b5aad116268ff966c83bd8fdc904be2a760896d8245d`
