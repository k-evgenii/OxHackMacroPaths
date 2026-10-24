use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, Token, TokenAccount};

use crate::constants::{SEED_SESSION, SEED_VAULT};
use crate::state::Session;

#[derive(Accounts)]
#[instruction(session_id: u64)]
pub struct CreateSession<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(
        init,
        payer = authority,
        space = 8 + Session::INIT_SPACE,
        seeds = [SEED_SESSION, authority.key().as_ref(), &session_id.to_le_bytes()],
        bump,
    )]
    pub session: Box<Account<'info, Session>>,
    pub play_mint: Account<'info, Mint>,
    #[account(
        init,
        payer = authority,
        token::mint = play_mint,
        token::authority = session,
        seeds = [SEED_VAULT, session.key().as_ref(), &[0]],
        bump,
    )]
    pub vault_0: Account<'info, TokenAccount>,
    #[account(
        init,
        payer = authority,
        token::mint = play_mint,
        token::authority = session,
        seeds = [SEED_VAULT, session.key().as_ref(), &[1]],
        bump,
    )]
    pub vault_1: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

#[allow(unused_variables)]
pub fn handler(
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
    Ok(())
}
