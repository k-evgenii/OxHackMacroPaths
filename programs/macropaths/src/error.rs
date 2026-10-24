use anchor_lang::prelude::*;

#[error_code]
pub enum MacroPathsError {
    #[msg("Amount must be greater than zero")]
    ZeroAmount,
    #[msg("Token mint does not match the session mint")]
    WrongMint,
    #[msg("Session is not in the state this instruction needs")]
    WrongState,
    #[msg("Deposits are closed for this session")]
    DepositClosed,
    #[msg("Every side needs a positive total before lock")]
    EmptySide,
    #[msg("Observation index is not the next expected index")]
    WrongIndex,
    #[msg("Observation period is not the next expected month")]
    WrongPeriod,
    #[msg("Observation does not match the committed chain")]
    BadCommitment,
    #[msg("Not all observations have been posted")]
    NotComplete,
    #[msg("Position has already claimed")]
    AlreadyClaimed,
    #[msg("Not every position has claimed yet")]
    NotAllClaimed,
    #[msg("Signer is not the session controller")]
    NotController,
    #[msg("Invalid session parameters")]
    BadParams,
    #[msg("The deadline has not passed yet")]
    DeadlineNotPassed,
    #[msg("Arithmetic overflow")]
    Overflow,
}
