use anchor_lang::prelude::*;
use anchor_spl::token::{Token, TokenAccount};

use crate::constants::SEED_POSITION;
use crate::state::{Position, Session};

#[derive(Accounts)]
pub struct Deposit<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(mut)]
    pub session: Box<Account<'info, Session>>,
    #[account(
        init_if_needed,
        payer = owner,
        space = 8 + Position::INIT_SPACE,
        seeds = [SEED_POSITION, session.key().as_ref(), owner.key().as_ref()],
        bump,
    )]
    pub position: Account<'info, Position>,
    #[account(mut)]
    pub owner_ta: Account<'info, TokenAccount>,
    #[account(mut, constraint = vault_0.key() == session.vaults[0])]
    pub vault_0: Account<'info, TokenAccount>,
    #[account(mut, constraint = vault_1.key() == session.vaults[1])]
    pub vault_1: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[allow(unused_variables)]
pub fn handler(ctx: Context<Deposit>, amounts: [u64; 4]) -> Result<()> {
    Ok(())
}
