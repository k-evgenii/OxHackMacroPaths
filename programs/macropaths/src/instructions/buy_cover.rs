use anchor_lang::prelude::*;
use anchor_lang::solana_program::account_info::AccountInfo;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

use crate::constants::{SEED_COVER, SEED_QUOTE, SEED_SELLER, SEED_SELLER_TA, SEED_SESSION};
use crate::error::MacroError;
use crate::events::CoverBought;
use crate::math::cover_split;
use crate::state::{Cover, EntryQuote, Seller, Session, SessionState};

#[derive(Accounts)]
#[instruction(product: u8)]
pub struct BuyCover<'info> {
    #[account(mut)]
    pub buyer: Signer<'info>,
    #[account(mut)]
    pub session: Box<Account<'info, Session>>,
    #[account(
        mut,
        seeds = [SEED_QUOTE, session.key().as_ref()],
        bump = quote.bump,
    )]
    pub quote: Account<'info, EntryQuote>,
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
    pub seller_ta: Box<Account<'info, TokenAccount>>,
    #[account(
        init_if_needed,
        payer = buyer,
        space = 8 + Cover::INIT_SPACE,
        seeds = [SEED_COVER, session.key().as_ref(), buyer.key().as_ref()],
        bump,
    )]
    pub cover: Account<'info, Cover>,
    #[account(mut)]
    pub buyer_ta: Box<Account<'info, TokenAccount>>,
    #[account(
        mut,
        constraint = session.vaults.get(usize::from(product)).copied() == Some(vault.key()),
    )]
    pub vault: Box<Account<'info, TokenAccount>>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<BuyCover>, product: u8, units: u64) -> Result<()> {
    require!(
        ctx.accounts.token_program.key() == token::ID,
        MacroError::InvalidParams
    );
    require!(product < 2, MacroError::InvalidProduct);

    let now = Clock::get()?.unix_timestamp;
    require!(
        ctx.accounts.session.state == SessionState::Open,
        MacroError::WrongState
    );
    require!(
        now <= ctx.accounts.session.deposit_deadline,
        MacroError::PastDeadline
    );
    require!(ctx.accounts.quote.is_set, MacroError::QuoteNotSet);
    require!(units > 0, MacroError::ZeroAmount);

    let session_key = ctx.accounts.session.key();
    let buyer_key = ctx.accounts.buyer.key();
    let play_mint = ctx.accounts.session.play_mint;
    require!(
        ctx.accounts.buyer_ta.mint == play_mint,
        MacroError::WrongMint
    );
    require!(
        ctx.accounts.buyer_ta.owner == buyer_key,
        MacroError::WrongOwner
    );
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

    let product_index = usize::from(product);
    let (buyer_pays, seller_pays) =
        cover_split(ctx.accounts.quote.p[product_index], units).ok_or(MacroError::MathOverflow)?;
    require!(
        seller_pays <= ctx.accounts.seller.free_cash,
        MacroError::InsufficientSellerFunds
    );

    transfer_from_signer(
        &ctx.accounts.buyer_ta,
        &ctx.accounts.vault,
        &ctx.accounts.buyer,
        buyer_pays,
    )?;
    {
        let seeds = ctx.accounts.session.signer_seeds();
        let signer = [&seeds[..]];
        transfer_from_pda(
            ctx.accounts.seller_ta.to_account_info(),
            ctx.accounts.vault.to_account_info(),
            ctx.accounts.session.to_account_info(),
            &signer,
            seller_pays,
        )?;
    }

    ctx.accounts.seller.free_cash = ctx
        .accounts
        .seller
        .free_cash
        .checked_sub(seller_pays)
        .ok_or(MacroError::MathOverflow)?;
    ctx.accounts.seller.escrow[product_index] = ctx.accounts.seller.escrow[product_index]
        .checked_add(seller_pays)
        .ok_or(MacroError::MathOverflow)?;
    if ctx.accounts.seller.n_sold[product_index] == 0 {
        ctx.accounts.session.seller_products_open = ctx
            .accounts
            .session
            .seller_products_open
            .checked_add(1)
            .ok_or(MacroError::MathOverflow)?;
    }
    ctx.accounts.seller.n_sold[product_index] = ctx.accounts.seller.n_sold[product_index]
        .checked_add(units)
        .ok_or(MacroError::MathOverflow)?;
    ctx.accounts.seller.premium[product_index] = ctx.accounts.seller.premium[product_index]
        .checked_add(buyer_pays)
        .ok_or(MacroError::MathOverflow)?;

    let cover_bump = ctx.bumps.cover;
    if ctx.accounts.cover.owner == Pubkey::default() {
        ctx.accounts.cover.owner = buyer_key;
        ctx.accounts.cover.session = session_key;
        ctx.accounts.cover.bump = cover_bump;
        ctx.accounts.session.cover_count = ctx
            .accounts
            .session
            .cover_count
            .checked_add(1)
            .ok_or(MacroError::MathOverflow)?;
    }
    ctx.accounts.cover.units[product_index] = ctx.accounts.cover.units[product_index]
        .checked_add(units)
        .ok_or(MacroError::MathOverflow)?;
    ctx.accounts.cover.premium_paid[product_index] = ctx.accounts.cover.premium_paid[product_index]
        .checked_add(buyer_pays)
        .ok_or(MacroError::MathOverflow)?;
    ctx.accounts.quote.frozen = true;

    emit!(CoverBought {
        session: session_key,
        owner: buyer_key,
        product,
        units,
        buyer_paid: buyer_pays,
        seller_paid: seller_pays,
    });
    Ok(())
}

fn require_session_pda(ctx: &Context<BuyCover>, session_key: Pubkey) -> Result<()> {
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

fn transfer_from_signer<'info>(
    from: &Account<'info, TokenAccount>,
    to: &Account<'info, TokenAccount>,
    authority: &Signer<'info>,
    amount: u64,
) -> Result<()> {
    if amount == 0 {
        return Ok(());
    }
    token::transfer(
        CpiContext::new(
            token::ID,
            Transfer {
                from: from.to_account_info(),
                to: to.to_account_info(),
                authority: authority.to_account_info(),
            },
        ),
        amount,
    )
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
