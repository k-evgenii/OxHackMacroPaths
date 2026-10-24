use anchor_lang::prelude::*;
use anchor_lang::solana_program::account_info::AccountInfo;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

use crate::constants::SEED_SESSION;
use crate::error::MacroError;
use crate::state::{Session, SessionState};

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

pub fn handler(ctx: Context<SweepDust>) -> Result<()> {
    require!(
        ctx.accounts.token_program.key() == token::ID,
        MacroError::InvalidParams
    );
    require!(
        ctx.accounts.vault_0.key() != ctx.accounts.vault_1.key(),
        MacroError::InvalidParams
    );

    let session_key = ctx.accounts.session.key();
    let play_mint = ctx.accounts.session.play_mint;
    let state = ctx.accounts.session.state;
    let claimed_count = ctx.accounts.session.claimed_count;
    let position_count = ctx.accounts.session.position_count;
    let cover_claimed_count = ctx.accounts.session.cover_claimed_count;
    let cover_count = ctx.accounts.session.cover_count;
    let seller_products_open = ctx.accounts.session.seller_products_open;

    require!(
        ctx.accounts.treasury_ta.mint == play_mint,
        MacroError::WrongMint
    );
    require!(
        ctx.accounts.vault_0.mint == play_mint && ctx.accounts.vault_1.mint == play_mint,
        MacroError::WrongMint
    );
    require!(
        ctx.accounts.vault_0.owner == session_key && ctx.accounts.vault_1.owner == session_key,
        MacroError::WrongOwner
    );
    require_session_pda(&ctx, session_key)?;

    require!(
        state == SessionState::Settled || state == SessionState::Refunding,
        MacroError::WrongState
    );
    require!(
        claimed_count == position_count
            && cover_claimed_count == cover_count
            && seller_products_open == 0,
        MacroError::NotAllClaimed
    );

    let amount_0 = ctx.accounts.vault_0.amount;
    let amount_1 = ctx.accounts.vault_1.amount;
    {
        let seeds = ctx.accounts.session.signer_seeds();
        let signer = [&seeds[..]];
        transfer_from_vault(
            ctx.accounts.vault_0.to_account_info(),
            ctx.accounts.treasury_ta.to_account_info(),
            ctx.accounts.session.to_account_info(),
            &signer,
            amount_0,
        )?;
        transfer_from_vault(
            ctx.accounts.vault_1.to_account_info(),
            ctx.accounts.treasury_ta.to_account_info(),
            ctx.accounts.session.to_account_info(),
            &signer,
            amount_1,
        )?;
    }
    Ok(())
}

fn require_session_pda(ctx: &Context<SweepDust>, session_key: Pubkey) -> Result<()> {
    let session_id = ctx.accounts.session.session_id.to_le_bytes();
    let bump = [ctx.accounts.session.bump];
    let derived = Pubkey::create_program_address(
        &[
            SEED_SESSION,
            ctx.accounts.session.authority.as_ref(),
            &session_id,
            &bump,
        ],
        ctx.program_id,
    )
    .map_err(|_| error!(MacroError::InvalidParams))?;
    require!(derived == session_key, MacroError::InvalidParams);
    Ok(())
}

fn transfer_from_vault<'info>(
    from: AccountInfo<'info>,
    to: AccountInfo<'info>,
    authority: AccountInfo<'info>,
    signer_seeds: &[&[&[u8]]],
    amount: u64,
) -> Result<()> {
    if amount == 0 {
        return Ok(());
    }
    token::transfer(
        CpiContext::new_with_signer(
            token::ID,
            Transfer {
                from,
                to,
                authority,
            },
            signer_seeds,
        ),
        amount,
    )
}
