use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};

use crate::constants::{SEED_SELLER, SEED_SELLER_TA};
use crate::error::MacroError;
use crate::state::{Seller, Session, SessionState};

#[derive(Accounts)]
pub struct SellerFund<'info> {
    #[account(mut)]
    pub seller_wallet: Signer<'info>,
    pub session: Box<Account<'info, Session>>,
    #[account(
        init_if_needed,
        payer = seller_wallet,
        space = 8 + Seller::INIT_SPACE,
        seeds = [SEED_SELLER, session.key().as_ref()],
        bump,
    )]
    pub seller: Account<'info, Seller>,
    #[account(
        init_if_needed,
        payer = seller_wallet,
        token::mint = play_mint,
        token::authority = session,
        seeds = [SEED_SELLER_TA, session.key().as_ref()],
        bump,
    )]
    pub seller_ta: Account<'info, TokenAccount>,
    #[account(mut)]
    pub seller_wallet_ta: Account<'info, TokenAccount>,
    #[account(
        constraint = play_mint.key() == session.play_mint @ MacroError::WrongMint
    )]
    pub play_mint: Account<'info, Mint>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<SellerFund>, amount: u64) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    require!(
        ctx.accounts.session.state == SessionState::Open,
        MacroError::WrongState
    );
    require!(
        now <= ctx.accounts.session.deposit_deadline,
        MacroError::PastDeadline
    );
    require!(amount > 0, MacroError::ZeroAmount);

    let play_mint = ctx.accounts.session.play_mint;
    let session_key = ctx.accounts.session.key();
    let seller_wallet = ctx.accounts.seller_wallet.key();
    require!(
        ctx.accounts.seller_wallet_ta.mint == play_mint,
        MacroError::WrongMint
    );
    require!(
        ctx.accounts.seller_wallet_ta.owner == seller_wallet,
        MacroError::WrongOwner
    );
    require_keys_eq!(
        ctx.accounts.token_program.key(),
        token::ID,
        MacroError::InvalidParams
    );

    if ctx.accounts.seller.seller == Pubkey::default() {
        ctx.accounts.seller.session = session_key;
        ctx.accounts.seller.seller = seller_wallet;
        // Later instructions re-derive these PDAs with the stored canonical bumps.
        ctx.accounts.seller.bump = ctx.bumps.seller;
        ctx.accounts.seller.ta_bump = ctx.bumps.seller_ta;
    } else {
        require!(
            ctx.accounts.seller.seller == seller_wallet,
            MacroError::WrongSeller
        );
    }

    let cpi_accounts = Transfer {
        from: ctx.accounts.seller_wallet_ta.to_account_info(),
        to: ctx.accounts.seller_ta.to_account_info(),
        authority: ctx.accounts.seller_wallet.to_account_info(),
    };
    let cpi_ctx = CpiContext::new(token::ID, cpi_accounts);
    token::transfer(cpi_ctx, amount)?;

    ctx.accounts.seller.free_cash = ctx
        .accounts
        .seller
        .free_cash
        .checked_add(amount)
        .ok_or(MacroError::MathOverflow)?;
    Ok(())
}
