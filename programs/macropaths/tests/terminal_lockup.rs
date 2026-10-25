//! Terminal lockup: a session whose `terminal` is not the chain's real C_N.
//!
//! Before the fix, all 48 observes landed, settle failed with ChainIncomplete and
//! expire_incomplete failed with NotExpired (it needed next_index < n_obs), so every deposit
//! stayed in the vaults for good. Now the last observe must close the chain at `terminal`, and
//! a Running session that cannot settle refunds after replay_deadline.
use anchor_lang::prelude::{Clock, Pubkey};
use anchor_lang::{InstructionData, ToAccountMetas};
use litesvm::types::{FailedTransactionMetadata, TransactionMetadata};
use solana_keypair::Keypair;
use solana_message::Instruction;
use solana_signer::Signer;

mod common;

const SIDES: [u64; 4] = [90_000_000, 100_000_000, 90_000_000, 100_000_000];
const WRONG_TERMINAL: [u8; 32] = [7u8; 32];

fn instruction<A: ToAccountMetas, D: InstructionData>(accounts: A, data: D) -> Instruction {
    Instruction {
        program_id: macropaths::ID,
        accounts: accounts.to_account_metas(None),
        data: data.data(),
    }
}

fn hex32(raw: &str) -> [u8; 32] {
    let bytes: Vec<u8> = (0..raw.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&raw[i..i + 2], 16).expect("hex"))
        .collect();
    bytes.try_into().expect("32 bytes")
}

/// The 48 rows `(index, period_id, value, next_commitment)` from tests/vectors.json.
fn rows() -> Vec<(u32, u32, i64, [u8; 32])> {
    let v = common::vectors();
    let chain = v["chain"].as_array().expect("chain");
    let c_n = hex32(v["commitment"]["C_N"].as_str().expect("C_N"));
    (0..chain.len())
        .map(|i| {
            let next = match chain.get(i + 1) {
                Some(row) => hex32(row["C_i"].as_str().expect("C_i")),
                None => c_n,
            };
            (
                u32::try_from(i).expect("index"),
                u32::try_from(chain[i]["period_id"].as_u64().expect("period_id")).expect("period"),
                chain[i]["value"].as_i64().expect("value"),
                next,
            )
        })
        .collect()
}

/// create_session with the vectors' dataset_id and C_0 but the given terminal.
fn create_with_terminal(env: &mut common::Env, id: u64, terminal: [u8; 32]) -> Pubkey {
    let v = common::vectors();
    let c = &v["commitment"];
    let p = &v["parameters"];
    let authority = env.authority.insecure_clone();
    let (session, _) = common::session_pda(&authority.pubkey(), id);
    let now = env.svm.get_sysvar::<Clock>().unix_timestamp;
    let ix = instruction(
        macropaths::accounts::CreateSession {
            authority: authority.pubkey(),
            session,
            play_mint: env.mint,
            vault_0: common::vault_pda(&session, 0).0,
            vault_1: common::vault_pda(&session, 1).0,
            token_program: anchor_spl::token::ID,
            system_program: anchor_lang::system_program::ID,
            rent: anchor_lang::solana_program::rent::ID,
        },
        macropaths::instruction::CreateSession {
            session_id: id,
            k: p["K"].as_i64().expect("K"),
            d_cap: p["Dcap"].as_i64().expect("Dcap"),
            a_cap: p["Acap"].as_i64().expect("Acap"),
            deposit_deadline: now + 3_600,
            replay_deadline: now + 7_200,
            dataset_id: hex32(c["dataset_id"].as_str().expect("dataset_id")),
            c0: hex32(c["C_0"].as_str().expect("C_0")),
            terminal,
        },
    );
    common::send(env, ix, &[&authority]).unwrap_or_else(|e| panic!("{}", e.meta.pretty_logs()));
    session
}

/// Deposit `SIDES` from a fresh owner; returns the owner and its token account.
fn deposit(env: &mut common::Env, session: &Pubkey) -> (Keypair, Pubkey) {
    let owner = Keypair::new();
    env.svm
        .airdrop(&owner.pubkey(), 1_000_000_000)
        .expect("airdrop");
    let owner_ta = common::ata_with(env, &owner.pubkey(), SIDES.iter().sum());
    let ix = instruction(
        macropaths::accounts::Deposit {
            owner: owner.pubkey(),
            session: *session,
            position: common::position_pda(session, &owner.pubkey()).0,
            owner_ta,
            vault_0: common::vault_pda(session, 0).0,
            vault_1: common::vault_pda(session, 1).0,
            token_program: anchor_spl::token::ID,
            system_program: anchor_lang::system_program::ID,
        },
        macropaths::instruction::Deposit { amounts: SIDES },
    );
    common::send(env, ix, &[&owner]).unwrap_or_else(|e| panic!("{}", e.meta.pretty_logs()));
    (owner, owner_ta)
}

fn lock(env: &mut common::Env, session: &Pubkey) {
    let authority = env.authority.insecure_clone();
    let ix = instruction(
        macropaths::accounts::LockAndStart {
            authority: authority.pubkey(),
            session: *session,
        },
        macropaths::instruction::LockAndStart {},
    );
    common::send(env, ix, &[&authority]).unwrap_or_else(|e| panic!("{}", e.meta.pretty_logs()));
}

fn observe(
    env: &mut common::Env,
    session: &Pubkey,
    row: (u32, u32, i64, [u8; 32]),
) -> Result<TransactionMetadata, FailedTransactionMetadata> {
    let ix = instruction(
        macropaths::accounts::Observe { session: *session },
        macropaths::instruction::Observe {
            index: row.0,
            period_id: row.1,
            value: row.2,
            next_commitment: row.3,
        },
    );
    common::send(env, ix, &[])
}

fn expire(
    env: &mut common::Env,
    session: &Pubkey,
) -> Result<TransactionMetadata, FailedTransactionMetadata> {
    let ix = instruction(
        macropaths::accounts::ExpireIncomplete { session: *session },
        macropaths::instruction::ExpireIncomplete {},
    );
    common::send(env, ix, &[])
}

fn past_replay_deadline(env: &mut common::Env, session: &Pubkey) {
    let s = common::read::<macropaths::Session>(env, session);
    common::set_time(env, s.replay_deadline + 1);
    // A new blockhash, so a retried expire is not rejected as an already-processed duplicate.
    env.svm.expire_blockhash();
}

#[test]
fn terminal_lockup_last_row_rejected_then_refund() {
    let mut env = common::env();
    let session = create_with_terminal(&mut env, 1, WRONG_TERMINAL);
    let (owner, owner_ta) = deposit(&mut env, &session);
    assert_eq!(common::token_balance(&env, &owner_ta), 0);
    lock(&mut env, &session);

    let rows = rows();
    let (last, body) = rows.split_last().expect("rows");
    common::observe_all(&mut env, &session, body);
    // The last row opens C_47 correctly, but its next_commitment (the real C_N) is not terminal.
    common::assert_err(
        observe(&mut env, &session, *last),
        macropaths::MacroError::BadCommitment,
    );
    let s = common::read::<macropaths::Session>(&env, &session);
    assert_eq!(s.next_index, s.n_obs - 1);
    assert!(s.state == macropaths::SessionState::Running);

    common::assert_err(
        expire(&mut env, &session),
        macropaths::MacroError::NotExpired,
    );
    past_replay_deadline(&mut env, &session);
    expire(&mut env, &session).unwrap_or_else(|e| panic!("{}", e.meta.pretty_logs()));
    assert!(
        common::read::<macropaths::Session>(&env, &session).state
            == macropaths::SessionState::Refunding
    );

    let ix = instruction(
        macropaths::accounts::Claim {
            owner: owner.pubkey(),
            session,
            position: common::position_pda(&session, &owner.pubkey()).0,
            owner_ta,
            vault_0: common::vault_pda(&session, 0).0,
            vault_1: common::vault_pda(&session, 1).0,
            token_program: anchor_spl::token::ID,
        },
        macropaths::instruction::Claim {},
    );
    common::send(&mut env, ix, &[&owner]).unwrap_or_else(|e| panic!("{}", e.meta.pretty_logs()));
    assert_eq!(
        common::token_balance(&env, &owner_ta),
        SIDES.iter().sum::<u64>()
    );
    assert_eq!(
        common::token_balance(&env, &common::vault_pda(&session, 0).0),
        0
    );
    assert_eq!(
        common::token_balance(&env, &common::vault_pda(&session, 1).0),
        0
    );
}

#[test]
fn terminal_lockup_stuck_state_expires_after_deadline() {
    // The state the old observe allowed: every row in, commitment (C_0 here) is not terminal.
    let mut env = common::env();
    let session = common::put_session(&mut env, 2, |s| {
        s.state = macropaths::SessionState::Running;
        s.next_index = s.n_obs;
    });
    let s = common::read::<macropaths::Session>(&env, &session);
    assert_ne!(s.commitment, s.terminal);
    common::assert_err(
        expire(&mut env, &session),
        macropaths::MacroError::NotExpired,
    );
    past_replay_deadline(&mut env, &session);
    expire(&mut env, &session).unwrap_or_else(|e| panic!("{}", e.meta.pretty_logs()));
    assert!(
        common::read::<macropaths::Session>(&env, &session).state
            == macropaths::SessionState::Refunding
    );
}

#[test]
fn terminal_lockup_honest_session_completes_and_does_not_expire() {
    let mut env = common::env();
    let session = common::create_session_default(&mut env, 3);
    deposit(&mut env, &session);
    lock(&mut env, &session);
    common::observe_all(&mut env, &session, &rows());
    let s = common::read::<macropaths::Session>(&env, &session);
    assert_eq!(s.next_index, s.n_obs);
    assert_eq!(s.commitment, s.terminal);
    past_replay_deadline(&mut env, &session);
    // Complete and at terminal: settle is the only way out, expire must refuse.
    common::assert_err(
        expire(&mut env, &session),
        macropaths::MacroError::NotExpired,
    );
    let ix = instruction(
        macropaths::accounts::Settle { session },
        macropaths::instruction::Settle {},
    );
    common::send(&mut env, ix, &[]).unwrap_or_else(|e| panic!("{}", e.meta.pretty_logs()));
    let s = common::read::<macropaths::Session>(&env, &session);
    assert!(s.state == macropaths::SessionState::Settled);
    assert_eq!(s.scores, [827_387, 863_980]);
}
