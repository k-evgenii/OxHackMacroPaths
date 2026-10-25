use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

use crate::constants::SEED_POSITION;
use crate::error::MacroError;
use crate::state::{Position, Session, SessionState};

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

pub fn handler(ctx: Context<Deposit>, amounts: [u64; 4]) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    require!(
        ctx.accounts.session.state == SessionState::Open,
        MacroError::WrongState
    );
    require!(
        now <= ctx.accounts.session.deposit_deadline,
        MacroError::PastDeadline
    );

    let mut total = 0u64;
    for amount in amounts {
        total = total.checked_add(amount).ok_or(MacroError::MathOverflow)?;
    }
    require!(total > 0, MacroError::ZeroAmount);

    let play_mint = ctx.accounts.session.play_mint;
    let session_key = ctx.accounts.session.key();
    let owner_key = ctx.accounts.owner.key();
    require!(
        ctx.accounts.owner_ta.mint == play_mint,
        MacroError::WrongMint
    );
    require!(
        ctx.accounts.owner_ta.owner == owner_key,
        MacroError::WrongOwner
    );
    require_keys_eq!(
        ctx.accounts.token_program.key(),
        token::ID,
        MacroError::InvalidParams
    );
    require_keys_neq!(
        ctx.accounts.vault_0.key(),
        ctx.accounts.vault_1.key(),
        MacroError::InvalidParams
    );
    require!(
        ctx.accounts.vault_0.mint == play_mint,
        MacroError::WrongMint
    );
    require!(
        ctx.accounts.vault_1.mint == play_mint,
        MacroError::WrongMint
    );
    require!(
        ctx.accounts.vault_0.owner == session_key,
        MacroError::WrongOwner
    );
    require!(
        ctx.accounts.vault_1.owner == session_key,
        MacroError::WrongOwner
    );

    let bump = ctx.bumps.position;
    if ctx.accounts.position.owner == Pubkey::default() {
        ctx.accounts.position.session = session_key;
        ctx.accounts.position.owner = owner_key;
        ctx.accounts.position.bump = bump;
        ctx.accounts.session.position_count = ctx
            .accounts
            .session
            .position_count
            .checked_add(1)
            .ok_or(MacroError::MathOverflow)?;
    }

    for (index, amount) in amounts.into_iter().enumerate() {
        ctx.accounts.position.deposited[index] = ctx.accounts.position.deposited[index]
            .checked_add(amount)
            .ok_or(MacroError::MathOverflow)?;
        ctx.accounts.session.side_totals[index] = ctx.accounts.session.side_totals[index]
            .checked_add(amount)
            .ok_or(MacroError::MathOverflow)?;
    }

    let to_vault_0 = amounts[0]
        .checked_add(amounts[1])
        .ok_or(MacroError::MathOverflow)?;
    let to_vault_1 = amounts[2]
        .checked_add(amounts[3])
        .ok_or(MacroError::MathOverflow)?;
    transfer_play(
        &ctx.accounts.owner_ta,
        &ctx.accounts.vault_0,
        &ctx.accounts.owner,
        to_vault_0,
    )?;
    transfer_play(
        &ctx.accounts.owner_ta,
        &ctx.accounts.vault_1,
        &ctx.accounts.owner,
        to_vault_1,
    )?;
    Ok(())
}

/// Moves `amount` of PLAY from the owner token account into a vault.
/// A zero product total is not sent.
fn transfer_play<'info>(
    from: &Account<'info, TokenAccount>,
    to: &Account<'info, TokenAccount>,
    authority: &Signer<'info>,
    amount: u64,
) -> Result<()> {
    if amount == 0 {
        return Ok(());
    }
    let cpi_accounts = Transfer {
        from: from.to_account_info(),
        to: to.to_account_info(),
        authority: authority.to_account_info(),
    };
    let cpi_ctx = CpiContext::new(token::ID, cpi_accounts);
    token::transfer(cpi_ctx, amount)
}
