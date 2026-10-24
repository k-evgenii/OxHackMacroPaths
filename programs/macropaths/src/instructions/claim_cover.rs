use anchor_lang::prelude::*;
use anchor_lang::solana_program::account_info::AccountInfo;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

use crate::constants::{SEED_COVER, SEED_SESSION};
use crate::error::MacroError;
use crate::math::cover_claim;
use crate::state::{Cover, Session, SessionState};

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

pub fn handler(ctx: Context<ClaimCover>) -> Result<()> {
    require!(
        ctx.accounts.token_program.key() == token::ID,
        MacroError::InvalidParams
    );
    require!(
        ctx.accounts.vault_0.key() != ctx.accounts.vault_1.key(),
        MacroError::InvalidParams
    );

    let session_key = ctx.accounts.session.key();
    let owner_key = ctx.accounts.owner.key();
    let play_mint = ctx.accounts.session.play_mint;
    require!(
        ctx.accounts.owner_ta.mint == play_mint,
        MacroError::WrongMint
    );
    require!(
        ctx.accounts.owner_ta.owner == owner_key,
        MacroError::WrongOwner
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

    let refund = match ctx.accounts.session.state {
        SessionState::Settled => false,
        SessionState::Refunding => true,
        _ => return err!(MacroError::WrongState),
    };
    require!(!ctx.accounts.cover.claimed, MacroError::AlreadyClaimed);

    let units = ctx.accounts.cover.units;
    let premium_paid = ctx.accounts.cover.premium_paid;
    let scores = ctx.accounts.session.scores;
    let (pay_0, pay_1) = if refund {
        (premium_paid[0], premium_paid[1])
    } else {
        (
            cover_claim(scores[0], units[0]).ok_or(MacroError::MathOverflow)?,
            cover_claim(scores[1], units[1]).ok_or(MacroError::MathOverflow)?,
        )
    };

    {
        let seeds = ctx.accounts.session.signer_seeds();
        let signer = [&seeds[..]];
        transfer_from_pda(
            ctx.accounts.vault_0.to_account_info(),
            ctx.accounts.owner_ta.to_account_info(),
            ctx.accounts.session.to_account_info(),
            &signer,
            pay_0,
        )?;
        transfer_from_pda(
            ctx.accounts.vault_1.to_account_info(),
            ctx.accounts.owner_ta.to_account_info(),
            ctx.accounts.session.to_account_info(),
            &signer,
            pay_1,
        )?;
    }

    ctx.accounts.cover.claimed = true;
    ctx.accounts.session.cover_claimed_count = ctx
        .accounts
        .session
        .cover_claimed_count
        .checked_add(1)
        .ok_or(MacroError::MathOverflow)?;
    Ok(())
}

fn require_session_pda(ctx: &Context<ClaimCover>, session_key: Pubkey) -> Result<()> {
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

fn transfer_from_pda<'info>(
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
