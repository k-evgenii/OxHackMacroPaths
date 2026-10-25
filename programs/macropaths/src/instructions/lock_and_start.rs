use anchor_lang::prelude::*;

use crate::error::MacroError;
use crate::state::{Session, SessionState};

#[derive(Accounts)]
pub struct LockAndStart<'info> {
    pub authority: Signer<'info>,
    #[account(mut, has_one = authority)]
    pub session: Box<Account<'info, Session>>,
}

pub fn handler(ctx: Context<LockAndStart>) -> Result<()> {
    let session = &mut ctx.accounts.session;
    require!(session.state == SessionState::Open, MacroError::WrongState);
    let now = Clock::get()?.unix_timestamp;
    require!(now <= session.deposit_deadline, MacroError::PastDeadline);
    for total in session.side_totals {
        require!(total > 0, MacroError::EmptySide);
    }
    session.matched[0] = session.side_totals[0].min(session.side_totals[1]);
    session.matched[1] = session.side_totals[2].min(session.side_totals[3]);
    session.state = SessionState::Running;
    Ok(())
}
