use anchor_lang::prelude::*;

use crate::constants::SEED_SESSION;

const _: () = assert!(cfg!(target_endian = "little"));

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace)]
#[borsh(use_discriminant = true)]
#[repr(u8)]
pub enum SessionState {
    Open = 0,
    Running = 1,
    Settled = 2,
    Refunding = 3,
}

#[account]
#[derive(InitSpace)]
pub struct Session {
    pub authority: Pubkey, // creator; signs lock_and_start, set_entry_quote, sweep_dust
    pub session_id: u64,   // seed component
    pub play_mint: Pubkey,
    pub vaults: [Pubkey; 2], // token accounts, one per product, authority = this PDA
    pub dataset_id: [u8; 32],
    pub commitment: [u8; 32], // current C_i; starts at C_0; after 48 observes equals terminal
    pub terminal: [u8; 32],   // C_48
    pub n_obs: u8,            // always N_OBS; stored for the explorer
    pub next_index: u8,       // 0..=48
    pub last_period_id: u32,  // YYYYMM of the last accepted observation, 0 before any
    pub state: SessionState,
    pub k: i64,
    pub d_cap: i64,
    pub a_cap: i64,
    pub deposit_deadline: i64, // unix seconds
    pub replay_deadline: i64,
    pub side_totals: [u64; 4], // S_j
    pub matched: [u64; 2],     // M_i, set at lock
    pub peak: i64,             // M_t; i64::MIN before the first observation
    pub max_decline: i64,      // D_t
    pub excess_acc: i64,       // A_t
    pub values: [i64; 48],     // x_t
    pub scores: [u64; 2],      // s_i millionths, set at settle
    pub p_budget: [u64; 4],    // P_j
    pub r_budget: [u64; 4],    // R_j
    pub position_count: u32,
    pub claimed_count: u32,
    pub cover_count: u32, // extension; 0 in base
    pub cover_claimed_count: u32,
    pub seller_products_open: u8, // products with n_sold>0 not yet seller_settled; 0 in base
    pub bump: u8,
    pub vault_bumps: [u8; 2],
}

#[account]
#[derive(InitSpace)]
pub struct Position {
    pub session: Pubkey,
    pub owner: Pubkey,
    pub deposited: [u64; 4],
    pub claimed: bool,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct Seller {
    pub session: Pubkey,
    pub seller: Pubkey,
    pub free_cash: u64,   // F
    pub escrow: [u64; 2], // E_i
    pub n_sold: [u64; 2],
    pub premium: [u64; 2],
    pub settled: [bool; 2],
    pub bump: u8,
    pub ta_bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct EntryQuote {
    pub session: Pubkey,
    pub p: [u64; 2],
    pub is_set: bool,
    pub frozen: bool,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct Cover {
    pub session: Pubkey,
    pub owner: Pubkey,
    pub units: [u64; 2],
    pub premium_paid: [u64; 2],
    pub claimed: bool,
    pub bump: u8,
}

impl Session {
    /// Signing seeds: `session`, authority, `session_id` little-endian bytes, bump.
    ///
    /// `session_id` is read in place. The program only builds for little-endian
    /// targets, so those bytes are `to_le_bytes()`.
    pub fn signer_seeds(&self) -> [&[u8]; 4] {
        [
            SEED_SESSION,
            self.authority.as_ref(),
            unsafe {
                core::slice::from_raw_parts(
                    core::ptr::from_ref(&self.session_id).cast::<u8>(),
                    core::mem::size_of::<u64>(),
                )
            },
            core::slice::from_ref(&self.bump),
        ]
    }
}
