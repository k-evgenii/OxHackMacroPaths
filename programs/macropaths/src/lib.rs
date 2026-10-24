pub mod chain;
pub mod constants;
pub mod error;
pub mod events;
pub mod instructions;
pub mod state;

use anchor_lang::prelude::*;

pub use constants::*;
pub use events::*;
pub use instructions::*;
pub use state::*;

declare_id!("FvT786RtMTtbdXWemA9zgA9rfwhvxFsKY1ypiMMNwMbS");

#[program]
pub mod macropaths {
    use super::*;

    /// Template smoke instruction. Remove once the create_session tests replace
    /// tests/integration/initialize.test.ts and programs/macropaths/tests/test_initialize.rs.
    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        initialize::handler(ctx)
    }

    pub fn create_session(ctx: Context<CreateSession>, nonce: u64, params: SessionParams) -> Result<()> {
        create_session::handler(ctx, nonce, params)
    }

    pub fn deposit(ctx: Context<Deposit>, amounts: [u64; 4]) -> Result<()> {
        deposit::handler(ctx, amounts)
    }

    pub fn lock_and_start(ctx: Context<LockAndStart>) -> Result<()> {
        lock_and_start::handler(ctx)
    }

    pub fn observe(
        ctx: Context<Observe>,
        index: u32,
        period_id: u32,
        value: i64,
        next_commitment: [u8; 32],
    ) -> Result<()> {
        observe::handler(ctx, index, period_id, value, next_commitment)
    }

    pub fn settle(ctx: Context<Settle>) -> Result<()> {
        settle::handler(ctx)
    }

    pub fn claim(ctx: Context<Claim>) -> Result<()> {
        claim::handler(ctx)
    }

    pub fn expire_incomplete(ctx: Context<ExpireIncomplete>) -> Result<()> {
        expire_incomplete::handler(ctx)
    }

    pub fn sweep_dust(ctx: Context<SweepDust>) -> Result<()> {
        sweep_dust::handler(ctx)
    }
}
