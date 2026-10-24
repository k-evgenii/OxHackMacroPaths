use anchor_lang::prelude::*;
use anchor_spl::token::{Token, TokenAccount};

use crate::constants::{SEED_SELLER, SEED_SELLER_TA};
use crate::state::{Seller, Session};

#[derive(Accounts)]
#[instruction(product: u8)]
pub struct SellerSettle<'info> {
    #[account(mut)]
    pub session: Box<Account<'info, Session>>,
    #[account(
        mut,
        seeds = [SEED_SELLER, session.key().as_ref()],
        bump = seller.bump,
    )]
    pub seller: Account<'info, Seller>,
    #[account(
        mut,
        seeds = [SEED_SELLER_TA, session.key().as_ref()],
        bump = seller.ta_bump,
    )]
    pub seller_ta: Account<'info, TokenAccount>,
    #[account(
        mut,
        constraint = session.vaults.get(usize::from(product)).copied() == Some(vault.key()),
    )]
    pub vault: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

#[allow(unused_variables)]
pub fn handler(ctx: Context<SellerSettle>, product: u8) -> Result<()> {
    Ok(())
}
