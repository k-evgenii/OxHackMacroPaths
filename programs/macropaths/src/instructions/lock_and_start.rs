use anchor_lang::prelude::*;

use crate::error::MacroPathsError;
use crate::state::Session;

#[derive(Accounts)]
pub struct LockAndStart<'info> {
    pub controller: Signer<'info>,

    #[account(mut, has_one = controller @ MacroPathsError::NotController)]
    pub session: Box<Account<'info, Session>>,
}

/// Owner: Dev.
/// TODO:
/// - require state == Open (WrongState)
/// - require all four side_totals > 0 (EmptySide)
/// - matched[p] = min(side_totals[2p], side_totals[2p + 1])
/// - state = Running
pub fn handler(_ctx: Context<LockAndStart>) -> Result<()> {
    Ok(())
}
