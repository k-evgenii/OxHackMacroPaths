use anchor_lang::prelude::*;

use crate::state::Session;

/// Anyone may settle once the trace is complete.
#[derive(Accounts)]
pub struct Settle<'info> {
    #[account(mut)]
    pub session: Box<Account<'info, Session>>,
}

/// Owner: Evgenii (thin wrapper over math.rs, no token moves).
/// TODO:
/// - require state == Running (WrongState), next_index == expected_count and
///   commitment == terminal (NotComplete)
/// - scores[p] = math::score(stats[p].stat, products[p].cap)
/// - per product: math::settle_product(side_totals[2p], side_totals[2p + 1], scores[p])
///   -> payout_budget and refund_budget for both sides
/// - state = Settled (once); emit!(Settled { .. })
pub fn handler(_ctx: Context<Settle>) -> Result<()> {
    Ok(())
}
