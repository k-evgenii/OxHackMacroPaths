//! lock_and_start and expire_incomplete.
use anchor_lang::prelude::{Clock, Pubkey};
use anchor_lang::{InstructionData, ToAccountMetas};
use litesvm::types::{FailedTransactionMetadata, TransactionMetadata};
use solana_keypair::Keypair;
use solana_message::Instruction;
use solana_signer::Signer;
use solana_transaction::{InstructionError, TransactionError};

mod common;

const SIDE_TOTALS: [u64; 4] = [90_000_000, 100_000_000, 90_000_000, 100_000_000];
const MATCHED: [u64; 2] = [90_000_000, 90_000_000];

fn instruction<A: ToAccountMetas, D: InstructionData>(accounts: A, data: D) -> Instruction {
    Instruction {
        program_id: macropaths::ID,
        accounts: accounts.to_account_metas(None),
        data: data.data(),
    }
}

fn lock(
    env: &mut common::Env,
    session: &Pubkey,
    authority: &Keypair,
) -> Result<TransactionMetadata, FailedTransactionMetadata> {
    let ix = instruction(
        macropaths::accounts::LockAndStart {
            authority: authority.pubkey(),
            session: *session,
        },
        macropaths::instruction::LockAndStart,
    );
    common::send(env, ix, &[authority])
}

fn expire(
    env: &mut common::Env,
    session: &Pubkey,
) -> Result<TransactionMetadata, FailedTransactionMetadata> {
    let ix = instruction(
        macropaths::accounts::ExpireIncomplete { session: *session },
        macropaths::instruction::ExpireIncomplete,
    );
    common::send(env, ix, &[])
}

fn chain_len() -> u32 {
    let n = common::vectors()["commitment"]["N"]
        .as_u64()
        .expect("commitment.N");
    u32::try_from(n).expect("N fits u32")
}

#[test]
fn lock_expire_lock_sets_matched_and_running() {
    let mut env = common::env();
    let authority = env.authority.insecure_clone();
    let session = common::put_session(&mut env, 1, |s| {
        s.side_totals = SIDE_TOTALS;
    });
    lock(&mut env, &session, &authority).unwrap_or_else(|err| panic!("{}", err.meta.pretty_logs()));
    let got = common::read::<macropaths::Session>(&env, &session);
    assert_eq!(got.matched, MATCHED);
    assert_eq!(got.side_totals, SIDE_TOTALS);
    assert!(got.state == macropaths::SessionState::Running);
}

#[test]
fn lock_expire_empty_side() {
    let mut env = common::env();
    let authority = env.authority.insecure_clone();
    let mut side_totals = SIDE_TOTALS;
    side_totals[3] = 0;
    let session = common::put_session(&mut env, 1, |s| {
        s.side_totals = side_totals;
    });
    common::assert_err(
        lock(&mut env, &session, &authority),
        macropaths::MacroError::EmptySide,
    );
    let got = common::read::<macropaths::Session>(&env, &session);
    assert!(got.state == macropaths::SessionState::Open);
    assert_eq!(got.matched, [0, 0]);
}

#[test]
fn lock_expire_non_authority() {
    let mut env = common::env();
    let session = common::put_session(&mut env, 1, |s| {
        s.side_totals = SIDE_TOTALS;
    });
    let stranger = Keypair::new();
    env.svm
        .airdrop(&stranger.pubkey(), 1_000_000_000)
        .expect("airdrop stranger");
    let ix = instruction(
        macropaths::accounts::LockAndStart {
            authority: stranger.pubkey(),
            session,
        },
        macropaths::instruction::LockAndStart,
    );
    let failed = common::send(&mut env, ix, &[&stranger]).expect_err("expected has_one failure");
    let code = match failed.err {
        TransactionError::InstructionError(_, InstructionError::Custom(code)) => code,
        other => panic!(
            "expected a custom program error, got {other:?}\n{}",
            failed.meta.pretty_logs()
        ),
    };
    assert_eq!(
        code,
        anchor_lang::error::ErrorCode::ConstraintHasOne as u32,
        "{}",
        failed.meta.pretty_logs()
    );
    let got = common::read::<macropaths::Session>(&env, &session);
    assert!(got.state == macropaths::SessionState::Open);
}

#[test]
fn lock_expire_twice() {
    let mut env = common::env();
    let authority = env.authority.insecure_clone();
    let session = common::put_session(&mut env, 1, |s| {
        s.side_totals = SIDE_TOTALS;
    });
    lock(&mut env, &session, &authority).unwrap_or_else(|err| panic!("{}", err.meta.pretty_logs()));
    env.svm.expire_blockhash();
    common::assert_err(
        lock(&mut env, &session, &authority),
        macropaths::MacroError::WrongState,
    );
    let got = common::read::<macropaths::Session>(&env, &session);
    assert!(got.state == macropaths::SessionState::Running);
    assert_eq!(got.matched, MATCHED);
}

#[test]
fn lock_expire_lock_after_deadline_fails() {
    let mut env = common::env();
    let authority = env.authority.insecure_clone();
    let session = common::put_session(&mut env, 1, |s| {
        s.side_totals = SIDE_TOTALS;
    });
    let stored = common::read::<macropaths::Session>(&env, &session);
    let past = stored
        .deposit_deadline
        .checked_add(1)
        .expect("deposit deadline");
    common::set_time(&mut env, past);
    common::assert_err(
        lock(&mut env, &session, &authority),
        macropaths::MacroError::PastDeadline,
    );
    let got = common::read::<macropaths::Session>(&env, &session);
    assert!(got.state == macropaths::SessionState::Open);
    assert_eq!(got.matched, [0, 0]);
}

#[test]
fn lock_expire_open_after_deposit_deadline() {
    let mut env = common::env();
    let session = common::put_session(&mut env, 1, |_| {});
    let stored = common::read::<macropaths::Session>(&env, &session);
    let past = stored
        .deposit_deadline
        .checked_add(1)
        .expect("deposit deadline");
    common::set_time(&mut env, past);
    expire(&mut env, &session).unwrap_or_else(|err| panic!("{}", err.meta.pretty_logs()));
    let got = common::read::<macropaths::Session>(&env, &session);
    assert!(got.state == macropaths::SessionState::Refunding);
}

#[test]
fn lock_expire_open_before_deadline() {
    let mut env = common::env();
    let session = common::put_session(&mut env, 1, |_| {});
    let stored = common::read::<macropaths::Session>(&env, &session);
    let now = env.svm.get_sysvar::<Clock>().unix_timestamp;
    assert!(now < stored.deposit_deadline);
    common::assert_err(
        expire(&mut env, &session),
        macropaths::MacroError::NotExpired,
    );
    let got = common::read::<macropaths::Session>(&env, &session);
    assert!(got.state == macropaths::SessionState::Open);
}

#[test]
fn lock_expire_running_past_replay_incomplete() {
    let mut env = common::env();
    let n = chain_len();
    let session = common::put_session(&mut env, 1, |s| {
        s.state = macropaths::SessionState::Running;
        s.next_index = n.checked_sub(1).expect("incomplete index");
    });
    let stored = common::read::<macropaths::Session>(&env, &session);
    assert!(stored.next_index < stored.n_obs);
    let past = stored
        .replay_deadline
        .checked_add(1)
        .expect("replay deadline");
    common::set_time(&mut env, past);
    expire(&mut env, &session).unwrap_or_else(|err| panic!("{}", err.meta.pretty_logs()));
    let got = common::read::<macropaths::Session>(&env, &session);
    assert!(got.state == macropaths::SessionState::Refunding);
}

#[test]
fn lock_expire_running_complete_not_expired() {
    let mut env = common::env();
    let n = chain_len();
    assert_eq!(n, macropaths::N_OBS);
    // Complete means every row in AND the chain closed at terminal; otherwise expire refunds
    // (terminal_lockup.rs).
    let session = common::put_session(&mut env, 1, |s| {
        s.state = macropaths::SessionState::Running;
        s.next_index = n;
        s.commitment = s.terminal;
    });
    let stored = common::read::<macropaths::Session>(&env, &session);
    assert_eq!(stored.next_index, stored.n_obs);
    let past = stored
        .replay_deadline
        .checked_add(1)
        .expect("replay deadline");
    common::set_time(&mut env, past);
    common::assert_err(
        expire(&mut env, &session),
        macropaths::MacroError::NotExpired,
    );
    let got = common::read::<macropaths::Session>(&env, &session);
    assert!(got.state == macropaths::SessionState::Running);
    assert_eq!(got.next_index, n);
}
