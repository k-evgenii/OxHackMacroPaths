use anchor_lang::prelude::*;

use crate::state::Session;

#[derive(Accounts)]
pub struct Observe<'info> {
    #[account(mut)]
    pub session: Box<Account<'info, Session>>,
}

#[allow(unused_variables)]
pub fn handler(
    ctx: Context<Observe>,
    index: u8,
    period_id: u32,
    value: i64,
    next_commitment: [u8; 32],
) -> Result<()> {
    Ok(())
}
