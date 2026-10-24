use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

use crate::constants::{VAULT_0, VAULT_1, VAULT_SEED};
use crate::error::MacroPathsError;
use crate::state::Session;

#[derive(Accounts)]
pub struct SweepDust<'info> {
    pub controller: Signer<'info>,

    #[account(
        mut,
        has_one = controller @ MacroPathsError::NotController,
        has_one = mint @ MacroPathsError::WrongMint,
    )]
    pub session: Box<Account<'info, Session>>,

    pub mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(mut, seeds = [VAULT_SEED, session.key().as_ref(), VAULT_0], bump = session.vault_bumps[0])]
    pub vault_0: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(mut, seeds = [VAULT_SEED, session.key().as_ref(), VAULT_1], bump = session.vault_bumps[1])]
    pub vault_1: Box<InterfaceAccount<'info, TokenAccount>>,

    /// Disclosed demo treasury that receives rounding residue.
    #[account(mut, token::mint = mint, token::token_program = token_program)]
    pub treasury: Box<InterfaceAccount<'info, TokenAccount>>,

    pub token_program: Interface<'info, TokenInterface>,
}

/// Owner: Dev (cuttable).
/// TODO:
/// - require state == Settled or Refunding, and claimed_count == position_count (NotAllClaimed)
/// - move each vault's remaining balance to treasury, signed by the Session PDA
pub fn handler(_ctx: Context<SweepDust>) -> Result<()> {
    Ok(())
}
