//! Commitment chain v1. Byte layout is `docs/commitment-chain.md`.
//!
//! `dataset_id` is SHA-256 of the length-prefixed term sheet. `C_N` and `C_i`
//! are `solana_sha256_hasher::hashv(...).to_bytes()` over the raw tags and
//! little-endian integers. The `sha2` feature is host-only; on Solana the
//! crate calls the SHA-256 syscall.

use solana_sha256_hasher::hashv;

/// `str(s)`: `u32` byte-length, then UTF-8 bytes.
fn push_str(buf: &mut Vec<u8>, s: &str) {
    let bytes = s.as_bytes();
    let len = u32::try_from(bytes.len()).expect("string longer than u32");
    buf.extend_from_slice(&len.to_le_bytes());
    buf.extend_from_slice(bytes);
}

/// Preimage of `dataset_id`, in the order fixed by `docs/commitment-chain.md`.
pub fn dataset_preimage(
    series_id: &str,
    source_url: &str,
    window_start: &str,
    window_end: &str,
    transform_id: &str,
    levels: &[&str],
    n: u32,
    first_period_id: u32,
    k: i64,
    d_cap: u64,
    a_cap: u64,
) -> Vec<u8> {
    let n_levels = u32::try_from(levels.len()).expect("level count");
    let mut buf = Vec::new();
    push_str(&mut buf, "PATH-DATASET-v1");
    push_str(&mut buf, series_id);
    push_str(&mut buf, source_url);
    push_str(&mut buf, window_start);
    push_str(&mut buf, window_end);
    push_str(&mut buf, transform_id);
    buf.extend_from_slice(&n_levels.to_le_bytes());
    for level in levels {
        push_str(&mut buf, level);
    }
    buf.extend_from_slice(&n.to_le_bytes());
    buf.extend_from_slice(&first_period_id.to_le_bytes());
    buf.extend_from_slice(&k.to_le_bytes());
    buf.extend_from_slice(&d_cap.to_le_bytes());
    buf.extend_from_slice(&a_cap.to_le_bytes());
    buf
}

/// SHA-256 of [`dataset_preimage`].
pub fn dataset_id(
    series_id: &str,
    source_url: &str,
    window_start: &str,
    window_end: &str,
    transform_id: &str,
    levels: &[&str],
    n: u32,
    first_period_id: u32,
    k: i64,
    d_cap: u64,
    a_cap: u64,
) -> [u8; 32] {
    let pre = dataset_preimage(
        series_id,
        source_url,
        window_start,
        window_end,
        transform_id,
        levels,
        n,
        first_period_id,
        k,
        d_cap,
        a_cap,
    );
    hashv(&[&pre]).to_bytes()
}

/// `C_N = SHA256("PATH-END-v1" ‖ dataset_id ‖ u32(n))`.
pub fn end_hash(dataset_id: &[u8; 32], n: u32) -> [u8; 32] {
    hashv(&[b"PATH-END-v1", dataset_id, &n.to_le_bytes()]).to_bytes()
}

/// `C_i = SHA256("PATH-OBS-v1" ‖ dataset_id ‖ u32(i) ‖ u32(period_id) ‖ i64(value) ‖ next)`.
pub fn obs_hash(
    dataset_id: &[u8; 32],
    i: u32,
    period_id: u32,
    value: i64,
    next: &[u8; 32],
) -> [u8; 32] {
    hashv(&[
        b"PATH-OBS-v1",
        dataset_id,
        &i.to_le_bytes(),
        &period_id.to_le_bytes(),
        &value.to_le_bytes(),
        next,
    ])
    .to_bytes()
}
