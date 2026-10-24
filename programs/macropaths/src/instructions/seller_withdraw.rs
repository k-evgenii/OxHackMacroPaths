use anchor_lang::prelude::*;
use anchor_spl::token::{Token, TokenAccount};

use crate::constants::{SEED_SELLER, SEED_SELLER_TA};
use crate::state::{Seller, Session};

#[derive(Accounts)]
pub struct SellerWithdraw<'info> {
    pub seller_wallet: Signer<'info>,
    pub session: Box<Account<'info, Session>>,
    #[account(
        mut,
        seeds = [SEED_SELLER, session.key().as_ref()],
        bump = seller.bump,
        constraint = seller.seller == seller_wallet.key(),
    )]
    pub seller: Account<'info, Seller>,
    #[account(
        mut,
        seeds = [SEED_SELLER_TA, session.key().as_ref()],
        bump = seller.ta_bump,
    )]
    pub seller_ta: Account<'info, TokenAccount>,
    #[account(mut)]
    pub seller_wallet_ta: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

#[allow(unused_variables)]
pub fn handler(ctx: Context<SellerWithdraw>, amount: u64) -> Result<()> {
    Ok(())
}
