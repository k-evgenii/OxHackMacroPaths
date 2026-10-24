use anchor_lang::prelude::*;

// Array sizes are written as literals so the IDL builder reads them directly:
// 2 = products, 4 = sides, 48 = MAX_OBS.
// Side order everywhere: [product 0 side 0, product 0 side 1, product 1 side 0, product 1 side 1].
// In the demo, product 0 = Cooling, product 1 = Excess; side 0 = "More", side 1 = "Less".

/// Open -> Running -> Settled, or Open / Running -> Refunding.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace)]
pub enum SessionState {
    Open,
    Running,
    Settled,
    Refunding,
}

/// Which path statistic a product settles on. The maths works on y = direction * x.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace)]
pub enum StatKind {
    /// Largest move from the running extreme: max_t (max_{s<=t} y_s - y_t).
    /// direction +1 = decline from peak (Cooling); -1 = rise from trough.
    MaxMove,
    /// Accumulation past a threshold: sum_t max(y_t - direction * threshold, 0).
    /// direction +1 = excess above (Excess); -1 = shortfall below.
    Accumulate,
}

/// One product's term sheet, fixed at create_session.
/// Demo values: product 0 = { MaxMove, +1, 0, 80_000 }, product 1 = { Accumulate, +1, 40_000, 800_000 }.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace)]
pub struct ProductParams {
    pub kind: StatKind,
    /// +1 or -1.
    pub direction: i8,
    /// In x units (40_000 = 4.00%). Ignored for MaxMove.
    pub threshold: i64,
    /// The statistic value that scores 1.0 (80_000 = 8 pp; 800_000 = 80 pp-months).
    pub cap: u64,
}

/// One product's running statistic.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Default, PartialEq, Eq, InitSpace)]
pub struct ProductStats {
    /// Running maximum of y (MaxMove only).
    pub extreme: i64,
    /// The statistic so far, in x units (D for MaxMove, A for Accumulate).
    pub stat: u64,
}

#[account]
#[derive(InitSpace)]
pub struct Session {
    pub creator: Pubkey,
    /// Signs lock_and_start, observe and sweep_dust (the keeper).
    pub controller: Pubkey,
    pub mint: Pubkey,
    pub nonce: u64,
    pub bump: u8,
    pub vault_bumps: [u8; 2],
    pub state: SessionState,
    pub deposit_deadline: i64,
    pub replay_deadline: i64,

    // Term sheet, committed before anyone deposits.
    pub term_sheet_hash: [u8; 32],
    pub dataset_id: [u8; 32],
    pub source_digest: [u8; 32],
    /// FRED id, zero-padded, e.g. b"CPIAUCNS".
    pub series_code: [u8; 16],
    /// First observation month as YYYYMM, e.g. 202101.
    pub start_period: u32,
    pub expected_count: u8,
    pub products: [ProductParams; 2],

    // Replay.
    /// C_i: the commitment the next observation must open.
    pub commitment: [u8; 32],
    /// C_N: must equal `commitment` once the last row is posted.
    pub terminal: [u8; 32],
    pub next_index: u8,
    /// Month the next observation must carry, YYYYMM (December rolls to January).
    pub next_period: u32,
    pub values: [i64; 48],
    pub stats: [ProductStats; 2],

    // Money.
    pub side_totals: [u64; 4],
    /// M = min(S_0, S_1) per product, recorded at lock.
    pub matched: [u64; 2],
    /// P_j per side, set at settle.
    pub payout_budget: [u64; 4],
    /// R_j = S_j - M per side, set at settle.
    pub refund_budget: [u64; 4],
    /// Scores in millionths, set at settle.
    pub scores: [u64; 2],
    pub position_count: u32,
    pub claimed_count: u32,

    /// Room for late fields without changing the layout.
    pub _reserved: [u8; 64],
}

#[account]
#[derive(InitSpace)]
pub struct Position {
    pub owner: Pubkey,
    pub session: Pubkey,
    /// Deposits per side, same order as `Session::side_totals`.
    pub deposited: [u64; 4],
    pub claimed: bool,
    pub bump: u8,
    pub _reserved: [u8; 16],
}

/// Arguments of create_session.
#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct SessionParams {
    pub controller: Pubkey,
    pub deposit_deadline: i64,
    pub replay_deadline: i64,
    pub term_sheet_hash: [u8; 32],
    pub dataset_id: [u8; 32],
    pub source_digest: [u8; 32],
    pub series_code: [u8; 16],
    pub start_period: u32,
    pub expected_count: u8,
    pub products: [ProductParams; 2],
    /// C_0.
    pub initial_commitment: [u8; 32],
    /// C_N.
    pub terminal_commitment: [u8; 32],
}
