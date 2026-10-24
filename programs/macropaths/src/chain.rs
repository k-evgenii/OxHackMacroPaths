//! Commitment chain over the replay rows. The keeper (prepare.ts), the vectors
//! (make_vectors.py) and `observe` must produce these exact bytes.
//!
//! All integers little-endian; tags are raw ASCII with no length prefix or terminator.
//!   C_N = SHA-256("PATH-END-v1" || dataset_id[32] || N: u32)
//!   C_i = SHA-256("PATH-OBS-v1" || dataset_id[32] || i: u32 || period_id: u32 || value: i64 || C_(i+1)[32])
//! i runs 0..N-1. A Session starts with commitment = C_0 and terminal = C_N; each
//! observe supplies row i and C_(i+1), recomputes C_i, compares, then advances.

use solana_sha256_hasher::hashv;

pub const OBS_TAG: &[u8] = b"PATH-OBS-v1";
pub const END_TAG: &[u8] = b"PATH-END-v1";

pub fn chain_end(dataset_id: &[u8; 32], n: u32) -> [u8; 32] {
    hashv(&[END_TAG, dataset_id, &n.to_le_bytes()]).to_bytes()
}

pub fn chain_link(
    dataset_id: &[u8; 32],
    index: u32,
    period_id: u32,
    value: i64,
    next: &[u8; 32],
) -> [u8; 32] {
    hashv(&[
        OBS_TAG,
        dataset_id,
        &index.to_le_bytes(),
        &period_id.to_le_bytes(),
        &value.to_le_bytes(),
        next,
    ])
    .to_bytes()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn hex(bytes: &[u8; 32]) -> String {
        bytes.iter().map(|b| format!("{b:02x}")).collect()
    }

    /// Known answers computed independently with Python hashlib + struct.pack('<I'/'<q').
    /// The keeper's TypeScript must reproduce these before anything goes on-chain.
    #[test]
    fn known_answer_three_rows() {
        let mut dataset_id = [0u8; 32];
        for (k, b) in dataset_id.iter_mut().enumerate() {
            *b = k as u8 + 1; // 0x01..0x20
        }
        let rows: [(u32, u32, i64); 3] = [(0, 202101, 13997), (1, 202102, 16762), (2, 202103, -333334)];

        let end = chain_end(&dataset_id, 3);
        assert_eq!(hex(&end), "6255085f84fdc256d957d845a268f782ab3211688007f8431bfa4947d552edd8");

        let mut c = end;
        let mut links = Vec::new();
        for &(i, p, v) in rows.iter().rev() {
            c = chain_link(&dataset_id, i, p, v, &c);
            links.push(hex(&c));
        }
        assert_eq!(links[0], "d2114863f27f43869beed41a9607a61c86546d8a609464956c8bc9fd1684d110"); // C_2
        assert_eq!(links[1], "62c69c91c34fa17c02c9d70f73bee70b3d040b85c1b84b5f5e947e0ea481b74e"); // C_1
        assert_eq!(links[2], "493cd13fefc66e3e94c1d1b9d9019d5dfc513118842236ecbd75562aafa69347"); // C_0
    }
}
