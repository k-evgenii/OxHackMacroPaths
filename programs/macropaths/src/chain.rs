//! Commitment chain. Byte layout is `docs/commitment-chain.md` (spec §1.6).
//!
//! Digests are `solana_sha256_hasher::hashv(...).to_bytes()`: SHA-256 over the
//! concatenation of the slices. The `sha2` feature is host-only; on Solana the
//! crate calls the SHA-256 syscall.

use solana_sha256_hasher::hashv;

/// SHA-256(`source_url` ‖ 0x0A ‖ `retrieved_at` ‖ 0x0A ‖ `sha_hex`).
pub fn dataset_id(source_url: &str, retrieved_at: &str, sha_hex: &str) -> [u8; 32] {
    hashv(&[
        source_url.as_bytes(),
        b"\n",
        retrieved_at.as_bytes(),
        b"\n",
        sha_hex.as_bytes(),
    ])
    .to_bytes()
}

/// `C_n = SHA-256("PATH-END-v1" ‖ dataset_id ‖ u32_le(n))`. For this series `n` is 48.
pub fn end_hash(dataset_id: &[u8; 32], n: u32) -> [u8; 32] {
    hashv(&[b"PATH-END-v1", dataset_id, &n.to_le_bytes()]).to_bytes()
}

/// `C_i = SHA-256("PATH-OBS-v1" ‖ dataset_id ‖ u32_le(i) ‖ u32_le(period_id) ‖ i64_le(value) ‖ next)`.
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
