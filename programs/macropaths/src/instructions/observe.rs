use anchor_lang::prelude::*;

use crate::error::MacroError;
use crate::events::Observed;
use crate::state::{Session, SessionState};

#[derive(Accounts)]
pub struct Observe<'info> {
    #[account(mut)]
    pub session: Box<Account<'info, Session>>,
}

pub fn handler(
    ctx: Context<Observe>,
    index: u8,
    period_id: u32,
    value: i64,
    next_commitment: [u8; 32],
) -> Result<()> {
    // §1.8 order: state, deadline, index, period, commitment.
    let now = Clock::get()?.unix_timestamp;
    let session = &mut ctx.accounts.session;

    require!(
        session.state == SessionState::Running,
        MacroError::WrongState
    );
    require!(now <= session.replay_deadline, MacroError::PastDeadline);
    require!(
        index == session.next_index
            && index < session.n_obs
            && usize::from(index) < session.values.len(),
        MacroError::WrongIndex
    );
    require!(
        period_id > session.last_period_id,
        MacroError::PeriodNotIncreasing
    );

    let digest = crate::chain::obs_hash(
        &session.dataset_id,
        u32::from(index),
        period_id,
        value,
        &next_commitment,
    );
    require!(digest == session.commitment, MacroError::BadCommitment);

    let (peak, max_decline) = crate::math::step_cooling(session.peak, session.max_decline, value);
    let excess_acc = crate::math::step_excess(session.excess_acc, value, session.k)
        .ok_or_else(|| error!(MacroError::MathOverflow))?;
    let next_index = session
        .next_index
        .checked_add(1)
        .ok_or_else(|| error!(MacroError::MathOverflow))?;

    session.peak = peak;
    session.max_decline = max_decline;
    session.excess_acc = excess_acc;
    session.values[usize::from(index)] = value;
    session.commitment = next_commitment;
    session.last_period_id = period_id;
    session.next_index = next_index;

    emit!(Observed {
        session: session.key(),
        index,
        period_id,
        value,
        peak,
        max_decline,
        excess_acc,
        commitment: next_commitment,
    });
    Ok(())
}
