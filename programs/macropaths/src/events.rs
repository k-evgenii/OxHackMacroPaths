use anchor_lang::prelude::*;

#[event]
pub struct Observed {
    pub session: Pubkey,
    pub index: u32,
    pub period_id: u32,
    pub value: i64,
    pub peak: i64,
    pub max_decline: i64,
    pub excess_acc: i64,
    pub commitment: [u8; 32],
}

#[event]
pub struct Settled {
    pub session: Pubkey,
    pub scores: [u64; 2],
    pub matched: [u64; 2],
    pub p_budget: [u64; 4],
    pub r_budget: [u64; 4],
}

#[event]
pub struct Claimed {
    pub session: Pubkey,
    pub owner: Pubkey,
    pub amounts: [u64; 2],
    pub refund: bool,
}

#[event]
pub struct CoverBought {
    pub session: Pubkey,
    pub owner: Pubkey,
    pub product: u8,
    pub units: u64,
    pub buyer_paid: u64,
    pub seller_paid: u64,
}
