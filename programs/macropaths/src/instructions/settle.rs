use anchor_lang::prelude::*;

use crate::state::Session;

#[derive(Accounts)]
pub struct Settle<'info> {
    #[account(mut)]
    pub session: Box<Account<'info, Session>>,
}

#[allow(unused_variables)]
pub fn handler(ctx: Context<Settle>) -> Result<()> {
    Ok(())
}
