pub mod chain;
pub mod constants;
pub mod error;
pub mod events;
pub mod instructions;
pub mod math;
pub mod state;

use anchor_lang::prelude::*;

pub use constants::*;
pub use error::*;
pub use events::*;
pub use instructions::*;
pub use state::*;

// `#[program]` looks up each `#[derive(Accounts)]` client module at the crate root.
pub(crate) use instructions::buy_cover::__client_accounts_buy_cover;
#[cfg(feature = "cpi")]
pub(crate) use instructions::buy_cover::__cpi_client_accounts_buy_cover;
pub(crate) use instructions::claim::__client_accounts_claim;
#[cfg(feature = "cpi")]
pub(crate) use instructions::claim::__cpi_client_accounts_claim;
pub(crate) use instructions::claim_cover::__client_accounts_claim_cover;
#[cfg(feature = "cpi")]
pub(crate) use instructions::claim_cover::__cpi_client_accounts_claim_cover;
pub(crate) use instructions::create_session::__client_accounts_create_session;
#[cfg(feature = "cpi")]
pub(crate) use instructions::create_session::__cpi_client_accounts_create_session;
pub(crate) use instructions::deposit::__client_accounts_deposit;
#[cfg(feature = "cpi")]
pub(crate) use instructions::deposit::__cpi_client_accounts_deposit;
pub(crate) use instructions::expire_incomplete::__client_accounts_expire_incomplete;
#[cfg(feature = "cpi")]
pub(crate) use instructions::expire_incomplete::__cpi_client_accounts_expire_incomplete;
pub(crate) use instructions::lock_and_start::__client_accounts_lock_and_start;
#[cfg(feature = "cpi")]
pub(crate) use instructions::lock_and_start::__cpi_client_accounts_lock_and_start;
pub(crate) use instructions::observe::__client_accounts_observe;
#[cfg(feature = "cpi")]
pub(crate) use instructions::observe::__cpi_client_accounts_observe;
pub(crate) use instructions::seller_fund::__client_accounts_seller_fund;
#[cfg(feature = "cpi")]
pub(crate) use instructions::seller_fund::__cpi_client_accounts_seller_fund;
pub(crate) use instructions::seller_settle::__client_accounts_seller_settle;
#[cfg(feature = "cpi")]
pub(crate) use instructions::seller_settle::__cpi_client_accounts_seller_settle;
pub(crate) use instructions::seller_withdraw::__client_accounts_seller_withdraw;
#[cfg(feature = "cpi")]
pub(crate) use instructions::seller_withdraw::__cpi_client_accounts_seller_withdraw;
pub(crate) use instructions::set_entry_quote::__client_accounts_set_entry_quote;
#[cfg(feature = "cpi")]
pub(crate) use instructions::set_entry_quote::__cpi_client_accounts_set_entry_quote;
pub(crate) use instructions::settle::__client_accounts_settle;
#[cfg(feature = "cpi")]
pub(crate) use instructions::settle::__cpi_client_accounts_settle;
pub(crate) use instructions::sweep_dust::__client_accounts_sweep_dust;
#[cfg(feature = "cpi")]
pub(crate) use instructions::sweep_dust::__cpi_client_accounts_sweep_dust;

declare_id!("FvT786RtMTtbdXWemA9zgA9rfwhvxFsKY1ypiMMNwMbS");

#[program]
pub mod macropaths {
    use super::*;

    pub fn create_session(
        ctx: Context<CreateSession>,
        session_id: u64,
        k: i64,
        d_cap: i64,
        a_cap: i64,
        deposit_deadline: i64,
        replay_deadline: i64,
        dataset_id: [u8; 32],
        c0: [u8; 32],
        terminal: [u8; 32],
    ) -> Result<()> {
        instructions::create_session::handler(
            ctx,
            session_id,
            k,
            d_cap,
            a_cap,
            deposit_deadline,
            replay_deadline,
            dataset_id,
            c0,
            terminal,
        )
    }

    pub fn deposit(ctx: Context<Deposit>, amounts: [u64; 4]) -> Result<()> {
        instructions::deposit::handler(ctx, amounts)
    }

    pub fn lock_and_start(ctx: Context<LockAndStart>) -> Result<()> {
        instructions::lock_and_start::handler(ctx)
    }

    pub fn observe(
        ctx: Context<Observe>,
        index: u8,
        period_id: u32,
        value: i64,
        next_commitment: [u8; 32],
    ) -> Result<()> {
        instructions::observe::handler(ctx, index, period_id, value, next_commitment)
    }

    pub fn settle(ctx: Context<Settle>) -> Result<()> {
        instructions::settle::handler(ctx)
    }

    pub fn claim(ctx: Context<Claim>) -> Result<()> {
        instructions::claim::handler(ctx)
    }

    pub fn expire_incomplete(ctx: Context<ExpireIncomplete>) -> Result<()> {
        instructions::expire_incomplete::handler(ctx)
    }

    pub fn sweep_dust(ctx: Context<SweepDust>) -> Result<()> {
        instructions::sweep_dust::handler(ctx)
    }

    pub fn seller_fund(ctx: Context<SellerFund>, amount: u64) -> Result<()> {
        instructions::seller_fund::handler(ctx, amount)
    }

    pub fn set_entry_quote(ctx: Context<SetEntryQuote>, p: [u64; 2]) -> Result<()> {
        instructions::set_entry_quote::handler(ctx, p)
    }

    pub fn buy_cover(ctx: Context<BuyCover>, product: u8, units: u64) -> Result<()> {
        instructions::buy_cover::handler(ctx, product, units)
    }

    pub fn claim_cover(ctx: Context<ClaimCover>) -> Result<()> {
        instructions::claim_cover::handler(ctx)
    }

    pub fn seller_settle(ctx: Context<SellerSettle>, product: u8) -> Result<()> {
        instructions::seller_settle::handler(ctx, product)
    }

    pub fn seller_withdraw(ctx: Context<SellerWithdraw>, amount: u64) -> Result<()> {
        instructions::seller_withdraw::handler(ctx, amount)
    }
}
