use anchor_lang::prelude::*;
use anchor_spl::token::{Token, TokenAccount};

use crate::constants::{SEED_COVER, SEED_QUOTE, SEED_SELLER, SEED_SELLER_TA};
use crate::state::{Cover, EntryQuote, Seller, Session};

#[derive(Accounts)]
#[instruction(product: u8)]
pub struct BuyCover<'info> {
    #[account(mut)]
    pub buyer: Signer<'info>,
    #[account(mut)]
    pub session: Box<Account<'info, Session>>,
    #[account(
        mut,
        seeds = [SEED_QUOTE, session.key().as_ref()],
        bump = quote.bump,
    )]
    pub quote: Account<'info, EntryQuote>,
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
    pub seller_ta: Box<Account<'info, TokenAccount>>,
    #[account(
        init_if_needed,
        payer = buyer,
        space = 8 + Cover::INIT_SPACE,
        seeds = [SEED_COVER, session.key().as_ref(), buyer.key().as_ref()],
        bump,
    )]
    pub cover: Account<'info, Cover>,
    #[account(mut)]
    pub buyer_ta: Box<Account<'info, TokenAccount>>,
    #[account(
        mut,
        constraint = session.vaults.get(usize::from(product)).copied() == Some(vault.key()),
    )]
    pub vault: Box<Account<'info, TokenAccount>>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[allow(unused_variables)]
pub fn handler(ctx: Context<BuyCover>, product: u8, units: u64) -> Result<()> {
    Ok(())
}
