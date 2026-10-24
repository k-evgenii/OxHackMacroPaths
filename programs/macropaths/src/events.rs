use anchor_lang::prelude::*;

use crate::state::ProductStats;

/// Emitted by observe. Explorer shows events as base64 `Program data:` lines,
/// so observe also prints a plain msg! line for the demo.
#[event]
pub struct Observed {
    pub session: Pubkey,
    pub index: u32,
    pub period_id: u32,
    pub value: i64,
    pub stats: [ProductStats; 2],
}

#[event]
pub struct Settled {
    pub session: Pubkey,
    pub scores: [u64; 2],
}

#[event]
pub struct Claimed {
    pub session: Pubkey,
    pub owner: Pubkey,
    /// Paid from vault 0 and vault 1.
    pub amounts: [u64; 2],
}
