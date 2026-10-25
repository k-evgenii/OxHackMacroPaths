use anchor_lang::prelude::*;

use crate::constants::PRODUCTS;
use crate::error::MacroError;
use crate::events::Settled;
use crate::math::{score, side_budgets};
use crate::state::{Session, SessionState};

#[derive(Accounts)]
pub struct Settle<'info> {
    #[account(mut)]
    pub session: Box<Account<'info, Session>>,
}

pub fn handler(ctx: Context<Settle>) -> Result<()> {
    let session = &mut ctx.accounts.session;

    require!(
        session.state == SessionState::Running,
        MacroError::WrongState
    );
    require!(
        session.next_index == session.n_obs && session.commitment == session.terminal,
        MacroError::ChainIncomplete
    );

    session.scores = [
        score(session.max_decline, session.d_cap).ok_or(MacroError::MathOverflow)?,
        score(session.excess_acc, session.a_cap).ok_or(MacroError::MathOverflow)?,
    ];

    for i in 0..PRODUCTS {
        let s0 = session.side_totals[2 * i];
        let s1 = session.side_totals[2 * i + 1];
        // Lock stored matched[i] as min of the two sides. Budgets use that same min.
        require_eq!(s0.min(s1), session.matched[i], MacroError::MathOverflow);
        let (p0, p1, r0, r1) =
            side_budgets(s0, s1, session.scores[i]).ok_or(MacroError::MathOverflow)?;
        session.p_budget[2 * i] = p0;
        session.p_budget[2 * i + 1] = p1;
        session.r_budget[2 * i] = r0;
        session.r_budget[2 * i + 1] = r1;
    }

    session.state = SessionState::Settled;
    emit!(Settled {
        session: session.key(),
        scores: session.scores,
        matched: session.matched,
        p_budget: session.p_budget,
        r_budget: session.r_budget,
    });
    Ok(())
}
