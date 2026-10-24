# Commitment chain

Byte-exact definition shared by `programs/macropaths/src/chain.rs`, `tests/make_vectors.py` and `keeper/src/prepare.ts`. Agent 03 appends a worked byte dump of `C_48` and `C_47` for the real data below.

Byte encoding, identical in Rust, Python and TypeScript:

```
dataset_id = SHA256( utf8(source_url) ‖ 0x0A ‖ utf8(retrieved_at) ‖ 0x0A ‖ utf8(sha256_of_raw hex, lowercase) )
             (the three fields of data/snapshots/CPIAUCNS.json)
period_id  = year*100 + month   as u32           (202101 for Jan 2021)
C_48       = SHA256( "PATH-END-v1" ‖ dataset_id[32] ‖ u32_le(48) )
C_i        = SHA256( "PATH-OBS-v1" ‖ dataset_id[32] ‖ u32_le(i) ‖ u32_le(period_id_i) ‖ i64_le(x_i) ‖ C_{i+1}[32] )   for i = 47 down to 0
```

Session stores `commitment = C_0` at creation and `terminal = C_48`. `observe(i, period, x, next)` recomputes `C_i` from its arguments and `next`, requires it equals the stored commitment, then stores `next`. After 48 accepted observations the stored commitment equals `terminal`; `settle` requires that. Rust: `anchor_lang::solana_program::hash::hashv(&[b"PATH-OBS-v1", &dataset_id, &i.to_le_bytes(), &period.to_le_bytes(), &x.to_le_bytes(), &next]).to_bytes()` with `i: u32`.
