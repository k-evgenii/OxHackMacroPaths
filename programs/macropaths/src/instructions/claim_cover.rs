use anchor_lang::prelude::*;
use anchor_spl::token::{Token, TokenAccount};

use crate::constants::SEED_COVER;
use crate::state::{Cover, Session};

#[derive(Accounts)]
pub struct ClaimCover<'info> {
    pub owner: Signer<'info>,
    #[account(mut)]
    pub session: Box<Account<'info, Session>>,
    #[account(
        mut,
        seeds = [SEED_COVER, session.key().as_ref(), owner.key().as_ref()],
        bump = cover.bump,
        has_one = owner,
        has_one = session,
    )]
    pub cover: Account<'info, Cover>,
    #[account(mut)]
    pub owner_ta: Account<'info, TokenAccount>,
    #[account(mut, constraint = vault_0.key() == session.vaults[0])]
    pub vault_0: Account<'info, TokenAccount>,
    #[account(mut, constraint = vault_1.key() == session.vaults[1])]
    pub vault_1: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

#[allow(unused_variables)]
pub fn handler(ctx: Context<ClaimCover>) -> Result<()> {
    Ok(())
}
