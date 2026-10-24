use anchor_lang::prelude::*;
use anchor_spl::token::{Token, TokenAccount};

use crate::constants::SEED_POSITION;
use crate::state::{Position, Session};

#[derive(Accounts)]
pub struct Claim<'info> {
    pub owner: Signer<'info>,
    #[account(mut)]
    pub session: Box<Account<'info, Session>>,
    #[account(
        mut,
        seeds = [SEED_POSITION, session.key().as_ref(), owner.key().as_ref()],
        bump = position.bump,
        has_one = owner,
        has_one = session,
    )]
    pub position: Account<'info, Position>,
    #[account(mut)]
    pub owner_ta: Account<'info, TokenAccount>,
    #[account(mut, constraint = vault_0.key() == session.vaults[0])]
    pub vault_0: Account<'info, TokenAccount>,
    #[account(mut, constraint = vault_1.key() == session.vaults[1])]
    pub vault_1: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

#[allow(unused_variables)]
pub fn handler(ctx: Context<Claim>) -> Result<()> {
    Ok(())
}
