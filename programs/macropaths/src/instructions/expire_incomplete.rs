use anchor_lang::prelude::*;

use crate::error::MacroError;
use crate::state::{Session, SessionState};

#[derive(Accounts)]
pub struct ExpireIncomplete<'info> {
    #[account(mut)]
    pub session: Box<Account<'info, Session>>,
}

pub fn handler(ctx: Context<ExpireIncomplete>) -> Result<()> {
    let session = &mut ctx.accounts.session;
    let now = Clock::get()?.unix_timestamp;
    let deposit_lapsed = session.state == SessionState::Open && now > session.deposit_deadline;
    let replay_lapsed = session.state == SessionState::Running
        && now > session.replay_deadline
        && session.next_index < session.n_obs;
    require!(deposit_lapsed || replay_lapsed, MacroError::NotExpired);
    session.state = SessionState::Refunding;
    Ok(())
}
