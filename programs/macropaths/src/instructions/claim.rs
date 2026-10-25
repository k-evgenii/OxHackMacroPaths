use anchor_lang::prelude::*;
use anchor_lang::solana_program::account_info::AccountInfo;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

use crate::constants::{PRODUCTS, SEED_POSITION, SEED_SESSION};
use crate::error::MacroError;
use crate::events::Claimed;
use crate::math::claim_amount;
use crate::state::{Position, Session, SessionState};

#[derive(Accounts)]
pub struct Claim<'info> {
    pub owner: Signer<'info>,
    #[account(mut)]
    pub session: Box<Account<'info, Session>>,
    #[account(
        mut,
        seeds = [SEED_POSITION, session.key().as_ref(), owner.key().as_ref()],
        bump = position.bump,
        has_one = owner,
        has_one = session,
    )]
    pub position: Account<'info, Position>,
    #[account(mut)]
    pub owner_ta: Account<'info, TokenAccount>,
    #[account(mut, constraint = vault_0.key() == session.vaults[0])]
    pub vault_0: Account<'info, TokenAccount>,
    #[account(mut, constraint = vault_1.key() == session.vaults[1])]
    pub vault_1: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

pub fn handler(ctx: Context<Claim>) -> Result<()> {
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
    let state = ctx.accounts.session.state;
    let deposited = ctx.accounts.position.deposited;
    let r_budget = ctx.accounts.session.r_budget;
    let p_budget = ctx.accounts.session.p_budget;
    let side_totals = ctx.accounts.session.side_totals;

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

    let refund = match state {
        SessionState::Settled => false,
        SessionState::Refunding => true,
        _ => return err!(MacroError::WrongState),
    };
    require!(!ctx.accounts.position.claimed, MacroError::AlreadyClaimed);

    let (pay_0, pay_1) = if refund {
        (
            deposited[0]
                .checked_add(deposited[1])
                .ok_or_else(|| error!(MacroError::MathOverflow))?,
            deposited[2]
                .checked_add(deposited[3])
                .ok_or_else(|| error!(MacroError::MathOverflow))?,
        )
    } else {
        let mut pay = [0u64; PRODUCTS];
        for product in 0..PRODUCTS {
            let mut sum = 0u64;
            for side in 0..2 {
                let j = product * 2 + side;
                let part = claim_amount(deposited[j], r_budget[j], p_budget[j], side_totals[j])
                    .ok_or_else(|| error!(MacroError::MathOverflow))?;
                sum = sum
                    .checked_add(part)
                    .ok_or_else(|| error!(MacroError::MathOverflow))?;
            }
            pay[product] = sum;
        }
        (pay[0], pay[1])
    };

    {
        let seeds = ctx.accounts.session.signer_seeds();
        let signer = [&seeds[..]];
        transfer_from_vault(
            ctx.accounts.vault_0.to_account_info(),
            ctx.accounts.owner_ta.to_account_info(),
            ctx.accounts.session.to_account_info(),
            &signer,
            pay_0,
        )?;
        transfer_from_vault(
            ctx.accounts.vault_1.to_account_info(),
            ctx.accounts.owner_ta.to_account_info(),
            ctx.accounts.session.to_account_info(),
            &signer,
            pay_1,
        )?;
    }

    ctx.accounts.position.claimed = true;
    ctx.accounts.session.claimed_count = ctx
        .accounts
        .session
        .claimed_count
        .checked_add(1)
        .ok_or_else(|| error!(MacroError::MathOverflow))?;

    emit!(Claimed {
        session: session_key,
        owner: owner_key,
        amounts: [pay_0, pay_1],
        refund,
    });
    Ok(())
}

fn require_session_pda(ctx: &Context<Claim>, session_key: Pubkey) -> Result<()> {
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
