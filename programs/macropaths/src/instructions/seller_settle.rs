use anchor_lang::prelude::*;
use anchor_lang::solana_program::account_info::AccountInfo;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

use crate::constants::{SEED_SELLER, SEED_SELLER_TA, SEED_SESSION};
use crate::error::MacroError;
use crate::math::cover_claim;
use crate::state::{Seller, Session, SessionState};

#[derive(Accounts)]
#[instruction(product: u8)]
pub struct SellerSettle<'info> {
    #[account(mut)]
    pub session: Box<Account<'info, Session>>,
    #[account(
        mut,
        seeds = [SEED_SELLER, session.key().as_ref()],
        bump = seller.bump,
    )]
    pub seller: Account<'info, Seller>,
    #[account(
        mut,
        seeds = [SEED_SELLER_TA, session.key().as_ref()],
        bump = seller.ta_bump,
    )]
    pub seller_ta: Account<'info, TokenAccount>,
    #[account(
        mut,
        constraint = session.vaults.get(usize::from(product)).copied() == Some(vault.key()),
    )]
    pub vault: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

pub fn handler(ctx: Context<SellerSettle>, product: u8) -> Result<()> {
    require!(
        ctx.accounts.token_program.key() == token::ID,
        MacroError::InvalidParams
    );
    require!(product < 2, MacroError::InvalidProduct);

    let session_key = ctx.accounts.session.key();
    let play_mint = ctx.accounts.session.play_mint;
    require!(
        ctx.accounts.seller_ta.mint == play_mint,
        MacroError::WrongMint
    );
    require!(
        ctx.accounts.seller_ta.owner == session_key,
        MacroError::WrongOwner
    );
    require!(ctx.accounts.vault.mint == play_mint, MacroError::WrongMint);
    require!(
        ctx.accounts.vault.owner == session_key,
        MacroError::WrongOwner
    );
    require_session_pda(&ctx, session_key)?;

    let refund = match ctx.accounts.session.state {
        SessionState::Settled => false,
        SessionState::Refunding => true,
        _ => return err!(MacroError::WrongState),
    };
    let product_index = usize::from(product);
    require!(
        !ctx.accounts.seller.settled[product_index],
        MacroError::AlreadySettled
    );

    let n_sold = ctx.accounts.seller.n_sold[product_index];
    let pay = if refund {
        ctx.accounts.seller.escrow[product_index]
    } else {
        let owed = cover_claim(ctx.accounts.session.scores[product_index], n_sold)
            .ok_or(MacroError::MathOverflow)?;
        n_sold.checked_sub(owed).ok_or(MacroError::MathOverflow)?
    };

    {
        let seeds = ctx.accounts.session.signer_seeds();
        let signer = [&seeds[..]];
        transfer_from_pda(
            ctx.accounts.vault.to_account_info(),
            ctx.accounts.seller_ta.to_account_info(),
            ctx.accounts.session.to_account_info(),
            &signer,
            pay,
        )?;
    }

    ctx.accounts.seller.free_cash = ctx
        .accounts
        .seller
        .free_cash
        .checked_add(pay)
        .ok_or(MacroError::MathOverflow)?;
    ctx.accounts.seller.escrow[product_index] = 0;
    ctx.accounts.seller.settled[product_index] = true;
    if n_sold > 0 {
        ctx.accounts.session.seller_products_open = ctx
            .accounts
            .session
            .seller_products_open
            .checked_sub(1)
            .ok_or(MacroError::MathOverflow)?;
    }
    Ok(())
}

fn require_session_pda(ctx: &Context<SellerSettle>, session_key: Pubkey) -> Result<()> {
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
