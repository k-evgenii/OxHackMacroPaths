use anchor_lang::prelude::*;
use anchor_lang::solana_program::account_info::AccountInfo;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

use crate::constants::{SEED_SELLER, SEED_SELLER_TA, SEED_SESSION};
use crate::error::MacroError;
use crate::state::{Seller, Session};

#[derive(Accounts)]
pub struct SellerWithdraw<'info> {
    pub seller_wallet: Signer<'info>,
    pub session: Box<Account<'info, Session>>,
    #[account(
        mut,
        seeds = [SEED_SELLER, session.key().as_ref()],
        bump = seller.bump,
        constraint = seller.seller == seller_wallet.key(),
    )]
    pub seller: Account<'info, Seller>,
    #[account(
        mut,
        seeds = [SEED_SELLER_TA, session.key().as_ref()],
        bump = seller.ta_bump,
    )]
    pub seller_ta: Account<'info, TokenAccount>,
    #[account(mut)]
    pub seller_wallet_ta: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

pub fn handler(ctx: Context<SellerWithdraw>, amount: u64) -> Result<()> {
    require!(
        ctx.accounts.token_program.key() == token::ID,
        MacroError::InvalidParams
    );

    let session_key = ctx.accounts.session.key();
    let wallet_key = ctx.accounts.seller_wallet.key();
    let play_mint = ctx.accounts.session.play_mint;
    require!(
        ctx.accounts.seller_ta.mint == play_mint,
        MacroError::WrongMint
    );
    require!(
        ctx.accounts.seller_ta.owner == session_key,
        MacroError::WrongOwner
    );
    require!(
        ctx.accounts.seller_wallet_ta.mint == play_mint,
        MacroError::WrongMint
    );
    require!(
        ctx.accounts.seller_wallet_ta.owner == wallet_key,
        MacroError::WrongOwner
    );
    require_session_pda(&ctx, session_key)?;

    require!(
        ctx.accounts.seller.escrow == [0, 0],
        MacroError::SellerEscrowOutstanding
    );
    require!(amount > 0, MacroError::ZeroAmount);
    require!(
        amount <= ctx.accounts.seller.free_cash,
        MacroError::InsufficientSellerFunds
    );

    {
        let seeds = ctx.accounts.session.signer_seeds();
        let signer = [&seeds[..]];
        transfer_from_pda(
            ctx.accounts.seller_ta.to_account_info(),
            ctx.accounts.seller_wallet_ta.to_account_info(),
            ctx.accounts.session.to_account_info(),
            &signer,
            amount,
        )?;
    }

    ctx.accounts.seller.free_cash = ctx
        .accounts
        .seller
        .free_cash
        .checked_sub(amount)
        .ok_or(MacroError::MathOverflow)?;
    Ok(())
}

fn require_session_pda(ctx: &Context<SellerWithdraw>, session_key: Pubkey) -> Result<()> {
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
