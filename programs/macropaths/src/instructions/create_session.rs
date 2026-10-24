use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

use crate::constants::{SESSION_SEED, VAULT_0, VAULT_1, VAULT_SEED};
use crate::state::{Session, SessionParams};

#[derive(Accounts)]
#[instruction(nonce: u64)]
pub struct CreateSession<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,

    #[account(
        init,
        payer = creator,
        space = Session::DISCRIMINATOR.len() + Session::INIT_SPACE,
        seeds = [SESSION_SEED, creator.key().as_ref(), &nonce.to_le_bytes()],
        bump,
    )]
    pub session: Box<Account<'info, Session>>,

    pub mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(
        init,
        payer = creator,
        seeds = [VAULT_SEED, session.key().as_ref(), VAULT_0],
        bump,
        token::mint = mint,
        token::authority = session,
        token::token_program = token_program,
    )]
    pub vault_0: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        init,
        payer = creator,
        seeds = [VAULT_SEED, session.key().as_ref(), VAULT_1],
        bump,
        token::mint = mint,
        token::authority = session,
        token::token_program = token_program,
    )]
    pub vault_1: Box<InterfaceAccount<'info, TokenAccount>>,

    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

/// Owner: Dev.
/// TODO:
/// - check params: each direction is +1 or -1, each cap > 0, 0 < expected_count <= MAX_OBS,
///   deposit_deadline < replay_deadline, start_period is a valid YYYYMM (else BadParams)
/// - copy params into the Session; creator, mint, nonce; state = Open;
///   next_index = 0; next_period = start_period;
///   commitment = initial_commitment; terminal = terminal_commitment
/// - store ctx.bumps.session, ctx.bumps.vault_0, ctx.bumps.vault_1
pub fn handler(_ctx: Context<CreateSession>, _nonce: u64, _params: SessionParams) -> Result<()> {
    Ok(())
}
