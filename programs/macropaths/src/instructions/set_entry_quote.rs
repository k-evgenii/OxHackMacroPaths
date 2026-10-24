use anchor_lang::prelude::*;

use crate::constants::{QUOTE_MAX, QUOTE_MIN, SEED_QUOTE};
use crate::error::MacroError;
use crate::state::{EntryQuote, Session, SessionState};

#[derive(Accounts)]
pub struct SetEntryQuote<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(has_one = authority)]
    pub session: Box<Account<'info, Session>>,
    #[account(
        init_if_needed,
        payer = authority,
        space = 8 + EntryQuote::INIT_SPACE,
        seeds = [SEED_QUOTE, session.key().as_ref()],
        bump,
    )]
    pub quote: Account<'info, EntryQuote>,
    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<SetEntryQuote>, p: [u64; 2]) -> Result<()> {
    require!(
        ctx.accounts.session.state == SessionState::Open,
        MacroError::WrongState
    );
    let now = Clock::get()?.unix_timestamp;
    require!(
        now <= ctx.accounts.session.deposit_deadline,
        MacroError::PastDeadline
    );
    for price in p {
        require!(
            (QUOTE_MIN..=QUOTE_MAX).contains(&price),
            MacroError::QuoteOutOfRange
        );
    }
    require!(!ctx.accounts.quote.frozen, MacroError::QuoteFrozen);

    let session_key = ctx.accounts.session.key();
    ctx.accounts.quote.p = p;
    ctx.accounts.quote.is_set = true;
    ctx.accounts.quote.session = session_key;
    // buy_cover re-derives this PDA with the stored canonical bump.
    ctx.accounts.quote.bump = ctx.bumps.quote;
    Ok(())
}
