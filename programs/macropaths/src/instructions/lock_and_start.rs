use anchor_lang::prelude::*;

use crate::state::Session;

#[derive(Accounts)]
pub struct LockAndStart<'info> {
    pub authority: Signer<'info>,
    #[account(mut, has_one = authority)]
    pub session: Box<Account<'info, Session>>,
}

#[allow(unused_variables)]
pub fn handler(ctx: Context<LockAndStart>) -> Result<()> {
    Ok(())
}
