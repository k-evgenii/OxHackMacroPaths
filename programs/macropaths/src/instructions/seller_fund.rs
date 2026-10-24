use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, Token, TokenAccount};

use crate::constants::{SEED_SELLER, SEED_SELLER_TA};
use crate::state::{Seller, Session};

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
    pub play_mint: Account<'info, Mint>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[allow(unused_variables)]
pub fn handler(ctx: Context<SellerFund>, amount: u64) -> Result<()> {
    Ok(())
}
