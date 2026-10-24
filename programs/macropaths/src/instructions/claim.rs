use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

use crate::constants::{POSITION_SEED, VAULT_0, VAULT_1, VAULT_SEED};
use crate::error::MacroPathsError;
use crate::state::{Position, Session};

#[derive(Accounts)]
pub struct Claim<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(mut, has_one = mint @ MacroPathsError::WrongMint)]
    pub session: Box<Account<'info, Session>>,

    #[account(
        mut,
        seeds = [POSITION_SEED, session.key().as_ref(), owner.key().as_ref()],
        bump = position.bump,
        has_one = owner,
        has_one = session,
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
}

/// Owner: Dev.
/// TODO:
/// - require !position.claimed (AlreadyClaimed)
/// - Settled: per side j, pay math::claim_side(deposited[j], side_totals[j],
///   refund_budget[j], payout_budget[j]); sides 0-1 from vault_0, sides 2-3 from vault_1
/// - Refunding: pay back deposited[] exactly
/// - any other state: WrongState
/// - transfer_checked with the Session PDA as authority:
///   CpiContext::new_with_signer(token_program.key(), accounts,
///   &[&[SESSION_SEED, creator.as_ref(), &nonce.to_le_bytes(), &[bump]]])
/// - claimed = true; claimed_count += 1 (a zero claim still counts); emit!(Claimed { .. })
pub fn handler(_ctx: Context<Claim>) -> Result<()> {
    Ok(())
}
