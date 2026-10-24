use anchor_lang::prelude::*;

use crate::state::Session;

/// Anyone may expire a session that missed its deadline.
#[derive(Accounts)]
pub struct ExpireIncomplete<'info> {
    #[account(mut)]
    pub session: Box<Account<'info, Session>>,
}

/// Owner: Evgenii (state only; refunds are paid by claim's refund branch).
/// TODO:
/// - Open and now >= deposit_deadline -> Refunding
/// - Running and now >= replay_deadline and next_index < expected_count -> Refunding
/// - anything else, including a complete trace: WrongState or DeadlineNotPassed
pub fn handler(_ctx: Context<ExpireIncomplete>) -> Result<()> {
    Ok(())
}
