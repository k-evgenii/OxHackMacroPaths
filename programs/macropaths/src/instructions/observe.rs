use anchor_lang::prelude::*;

use crate::error::MacroPathsError;
use crate::state::Session;

#[derive(Accounts)]
pub struct Observe<'info> {
    pub controller: Signer<'info>,

    #[account(mut, has_one = controller @ MacroPathsError::NotController)]
    pub session: Box<Account<'info, Session>>,
}

/// Owner: Evgenii (thin wrapper over math.rs, no token moves).
/// TODO:
/// - require state == Running (WrongState), index == next_index (WrongIndex),
///   period_id == next_period (WrongPeriod)
/// - recompute C_i from (dataset_id, index, period_id, value, next_commitment);
///   require it equals session.commitment (BadCommitment); no state change on any failure
/// - values[index] = value; update stats for both products with math::update
/// - commitment = next_commitment; next_index += 1; next_period steps one month
/// - msg!("observe i={} period={} x={} chain ok", index, period_id, value) for Explorer
/// - emit!(Observed { .. })
pub fn handler(
    _ctx: Context<Observe>,
    _index: u8,
    _period_id: u32,
    _value: i64,
    _next_commitment: [u8; 32],
) -> Result<()> {
    Ok(())
}
