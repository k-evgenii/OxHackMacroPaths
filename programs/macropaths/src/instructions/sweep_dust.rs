use anchor_lang::prelude::*;
use anchor_spl::token::{Token, TokenAccount};

use crate::state::Session;

#[derive(Accounts)]
pub struct SweepDust<'info> {
    pub authority: Signer<'info>,
    #[account(mut, has_one = authority)]
    pub session: Box<Account<'info, Session>>,
    #[account(mut)]
    pub treasury_ta: Account<'info, TokenAccount>,
    #[account(mut, constraint = vault_0.key() == session.vaults[0])]
    pub vault_0: Account<'info, TokenAccount>,
    #[account(mut, constraint = vault_1.key() == session.vaults[1])]
    pub vault_1: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

#[allow(unused_variables)]
pub fn handler(ctx: Context<SweepDust>) -> Result<()> {
    Ok(())
}
