use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, Token, TokenAccount};

use crate::constants::{N_OBS, PRODUCTS, SEED_SESSION, SEED_VAULT, SIDES};
use crate::error::MacroError;
use crate::state::{Session, SessionState};

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
    let now = Clock::get()?.unix_timestamp;
    require!(d_cap > 0, MacroError::InvalidParams);
    require!(a_cap > 0, MacroError::InvalidParams);
    require!(now < deposit_deadline, MacroError::InvalidParams);
    require!(
        deposit_deadline < replay_deadline,
        MacroError::InvalidParams
    );

    let vaults = [ctx.accounts.vault_0.key(), ctx.accounts.vault_1.key()];
    let vault_bumps = [ctx.bumps.vault_0, ctx.bumps.vault_1];
    let bump = ctx.bumps.session;
    let authority = ctx.accounts.authority.key();
    let play_mint = ctx.accounts.play_mint.key();

    let session = &mut ctx.accounts.session;
    session.authority = authority;
    session.session_id = session_id;
    session.play_mint = play_mint;
    session.vaults = vaults;
    session.dataset_id = dataset_id;
    session.commitment = c0;
    session.terminal = terminal;
    session.n_obs = N_OBS;
    session.next_index = 0;
    session.last_period_id = 0;
    session.state = SessionState::Open;
    session.k = k;
    session.d_cap = d_cap;
    session.a_cap = a_cap;
    session.deposit_deadline = deposit_deadline;
    session.replay_deadline = replay_deadline;
    session.side_totals = [0; SIDES];
    session.matched = [0; PRODUCTS];
    session.peak = i64::MIN;
    session.max_decline = 0;
    session.excess_acc = 0;
    session.values = [0; N_OBS as usize];
    session.scores = [0; PRODUCTS];
    session.p_budget = [0; SIDES];
    session.r_budget = [0; SIDES];
    session.position_count = 0;
    session.claimed_count = 0;
    session.cover_count = 0;
    session.cover_claimed_count = 0;
    session.seller_products_open = 0;
    session.bump = bump;
    session.vault_bumps = vault_bumps;
    Ok(())
}
