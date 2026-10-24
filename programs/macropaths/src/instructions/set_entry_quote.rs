use anchor_lang::prelude::*;

use crate::constants::SEED_QUOTE;
use crate::state::{EntryQuote, Session};

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

#[allow(unused_variables)]
pub fn handler(ctx: Context<SetEntryQuote>, p: [u64; 2]) -> Result<()> {
    Ok(())
}
