use anchor_lang::prelude::*;

#[error_code]
pub enum MacroError {
    #[msg("Session parameters are invalid")]
    InvalidParams,
    #[msg("Product index is out of range")]
    InvalidProduct,
    #[msg("Session is in the wrong state")]
    WrongState,
    #[msg("Deadline has passed")]
    PastDeadline,
    #[msg("Amount is zero")]
    ZeroAmount,
    #[msg("Token mint does not match the session")]
    WrongMint,
    #[msg("Token account owner does not match")]
    WrongOwner,
    #[msg("A side total is empty")]
    EmptySide,
    #[msg("Observation index does not match")]
    WrongIndex,
    #[msg("Commitment does not match")]
    BadCommitment,
    #[msg("Period is not increasing")]
    PeriodNotIncreasing,
    #[msg("Commitment chain is incomplete")]
    ChainIncomplete,
    #[msg("Already claimed")]
    AlreadyClaimed,
    #[msg("Session has not expired")]
    NotExpired,
    #[msg("Not all claims are finished")]
    NotAllClaimed,
    #[msg("Arithmetic overflow")]
    MathOverflow,
    #[msg("Quote is outside the allowed range")]
    QuoteOutOfRange,
    #[msg("Quote is frozen")]
    QuoteFrozen,
    #[msg("Quote is not set")]
    QuoteNotSet,
    #[msg("Seller free cash is insufficient")]
    InsufficientSellerFunds,
    #[msg("Seller wallet does not match")]
    WrongSeller,
    #[msg("Seller escrow is outstanding")]
    SellerEscrowOutstanding,
    #[msg("Seller product is already settled")]
    AlreadySettled,
}
