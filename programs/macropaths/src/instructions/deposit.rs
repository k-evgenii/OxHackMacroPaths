use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

use crate::constants::{POSITION_SEED, VAULT_0, VAULT_1, VAULT_SEED};
use crate::error::MacroPathsError;
use crate::state::{Position, Session};

#[derive(Accounts)]
pub struct Deposit<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(mut, has_one = mint @ MacroPathsError::WrongMint)]
    pub session: Box<Account<'info, Session>>,

    #[account(
        init_if_needed,
        payer = owner,
        space = Position::DISCRIMINATOR.len() + Position::INIT_SPACE,
        seeds = [POSITION_SEED, session.key().as_ref(), owner.key().as_ref()],
        bump,
    )]
    pub position: Box<Account<'info, Position>>,

    pub mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(
        mut,
        token::mint = mint,
        token::authority = owner,
        token::token_program = token_program,
    )]
    pub owner_token: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(mut, seeds = [VAULT_SEED, session.key().as_ref(), VAULT_0], bump = session.vault_bumps[0])]
    pub vault_0: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(mut, seeds = [VAULT_SEED, session.key().as_ref(), VAULT_1], bump = session.vault_bumps[1])]
    pub vault_1: Box<InterfaceAccount<'info, TokenAccount>>,

    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

/// Owner: Dev.
/// TODO:
/// - require state == Open (WrongState) and now < deposit_deadline (DepositClosed)
/// - require at least one amount > 0 (ZeroAmount)
/// - if the Position is new (owner == default): set owner, session, bump; position_count += 1
/// - add amounts to position.deposited and session.side_totals (checked_add, Overflow)
/// - transfer_checked owner_token -> vault_0 for amounts[0] + amounts[1],
///   owner_token -> vault_1 for amounts[2] + amounts[3]; skip a zero transfer.
///   Anchor 1.0: CpiContext::new(token_program.key(), TransferChecked { from, mint, to, authority })
pub fn handler(_ctx: Context<Deposit>, _amounts: [u64; 4]) -> Result<()> {
    Ok(())
}
