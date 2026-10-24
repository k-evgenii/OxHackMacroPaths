//! create_session: parameter checks, Session fields, and the two vault token accounts.
//! Every expected chain number is read from tests/vectors.json.

mod common;

use anchor_lang::prelude::Clock;
use anchor_lang::{InstructionData, ToAccountMetas};
use anchor_spl::token::TokenAccount;
use litesvm::types::TransactionMetadata;
use solana_message::Instruction;
use solana_signer::Signer;
use solana_transaction::TransactionError;

use macropaths::state::SessionState;

const DEPOSIT_OFFSET: i64 = 3_600;
const REPLAY_OFFSET: i64 = 7_200;

struct Params {
    session_id: u64,
    k: i64,
    d_cap: i64,
    a_cap: i64,
    deposit_deadline: i64,
    replay_deadline: i64,
    dataset_id: [u8; 32],
    c0: [u8; 32],
    terminal: [u8; 32],
}

fn params_from_vectors(env: &common::Env, session_id: u64) -> Params {
    let v = common::vectors();
    let now = env.svm.get_sysvar::<Clock>().unix_timestamp;
    let commitment = &v["commitment"];
    Params {
        session_id,
        k: json_i64(&v["parameters"], "K"),
        d_cap: json_i64(&v["parameters"], "Dcap"),
        a_cap: json_i64(&v["parameters"], "Acap"),
        deposit_deadline: now.checked_add(DEPOSIT_OFFSET).expect("deposit deadline"),
        replay_deadline: now.checked_add(REPLAY_OFFSET).expect("replay deadline"),
        dataset_id: hex32(
            "commitment.dataset_id",
            commitment["dataset_id"].as_str().expect("dataset_id"),
        ),
        c0: hex32("commitment.C_0", commitment["C_0"].as_str().expect("C_0")),
        terminal: hex32("commitment.C_N", commitment["C_N"].as_str().expect("C_N")),
    }
}

fn create_ix(env: &common::Env, p: &Params) -> Instruction {
    let authority = env.authority.pubkey();
    let (session, _) = common::session_pda(&authority, p.session_id);
    let (vault_0, _) = common::vault_pda(&session, 0);
    let (vault_1, _) = common::vault_pda(&session, 1);
    Instruction {
        program_id: macropaths::ID,
        accounts: macropaths::accounts::CreateSession {
            authority,
            session,
            play_mint: env.mint,
            vault_0,
            vault_1,
            token_program: anchor_spl::token::ID,
            system_program: anchor_lang::system_program::ID,
            rent: anchor_lang::solana_program::rent::ID,
        }
        .to_account_metas(None),
        data: macropaths::instruction::CreateSession {
            session_id: p.session_id,
            k: p.k,
            d_cap: p.d_cap,
            a_cap: p.a_cap,
            deposit_deadline: p.deposit_deadline,
            replay_deadline: p.replay_deadline,
            dataset_id: p.dataset_id,
            c0: p.c0,
            terminal: p.terminal,
        }
        .data(),
    }
}

fn send_create(
    env: &mut common::Env,
    p: &Params,
) -> Result<TransactionMetadata, litesvm::types::FailedTransactionMetadata> {
    let ix = create_ix(env, p);
    let authority = env.authority.insecure_clone();
    common::send(env, ix, &[&authority])
}

#[test]
fn create_session_happy_path() {
    let mut env = common::env();
    let session_id = 1u64;
    let expected = params_from_vectors(&env, session_id);
    let now = env.svm.get_sysvar::<Clock>().unix_timestamp;
    let session_key = common::create_session_default(&mut env, session_id);
    let session: macropaths::Session = common::read(&env, &session_key);

    let (pda, bump) = common::session_pda(&env.authority.pubkey(), session_id);
    let (vault_0, vault_bump_0) = common::vault_pda(&session_key, 0);
    let (vault_1, vault_bump_1) = common::vault_pda(&session_key, 1);
    let n_obs = common::vectors()["commitment"]["N"]
        .as_u64()
        .expect("commitment.N");

    assert_eq!(session_key, pda);
    assert_eq!(session.authority, env.authority.pubkey());
    assert_eq!(session.session_id, session_id);
    assert_eq!(session.play_mint, env.mint);
    assert_eq!(session.vaults, [vault_0, vault_1]);
    assert_eq!(session.dataset_id, expected.dataset_id);
    assert_eq!(session.commitment, expected.c0);
    assert_eq!(session.terminal, expected.terminal);
    assert_eq!(u64::from(session.n_obs), n_obs);
    assert_eq!(session.next_index, 0);
    assert_eq!(session.last_period_id, 0);
    assert!(session.state == SessionState::Open);
    assert_eq!(session.k, expected.k);
    assert_eq!(session.d_cap, expected.d_cap);
    assert_eq!(session.a_cap, expected.a_cap);
    assert_eq!(
        session.deposit_deadline,
        now.checked_add(DEPOSIT_OFFSET).unwrap()
    );
    assert_eq!(
        session.replay_deadline,
        now.checked_add(REPLAY_OFFSET).unwrap()
    );
    assert_eq!(session.side_totals, [0; 4]);
    assert_eq!(session.matched, [0; 2]);
    assert_eq!(session.peak, i64::MIN);
    assert_eq!(session.max_decline, 0);
    assert_eq!(session.excess_acc, 0);
    assert!(session.values.iter().all(|value| *value == 0));
    assert_eq!(session.values.len(), n_obs as usize);
    assert_eq!(session.scores, [0; 2]);
    assert_eq!(session.p_budget, [0; 4]);
    assert_eq!(session.r_budget, [0; 4]);
    assert_eq!(session.position_count, 0);
    assert_eq!(session.claimed_count, 0);
    assert_eq!(session.cover_count, 0);
    assert_eq!(session.cover_claimed_count, 0);
    assert_eq!(session.seller_products_open, 0);
    assert_eq!(session.bump, bump);
    assert_eq!(session.vault_bumps, [vault_bump_0, vault_bump_1]);

    for key in [vault_0, vault_1] {
        let vault: TokenAccount = common::read(&env, &key);
        assert_eq!(vault.mint, env.mint);
        assert_eq!(vault.owner, session_key);
        assert_eq!(vault.amount, 0);
    }
}

#[test]
fn create_session_rejects_deposit_deadline_not_after_now() {
    let mut env = common::env();
    let mut p = params_from_vectors(&env, 2);
    let now = env.svm.get_sysvar::<Clock>().unix_timestamp;
    p.deposit_deadline = now;
    common::assert_err(
        send_create(&mut env, &p),
        macropaths::MacroError::InvalidParams,
    );
}

#[test]
fn create_session_rejects_replay_deadline_not_after_deposit() {
    let mut env = common::env();
    let mut p = params_from_vectors(&env, 3);
    p.replay_deadline = p.deposit_deadline;
    common::assert_err(
        send_create(&mut env, &p),
        macropaths::MacroError::InvalidParams,
    );
}

#[test]
fn create_session_rejects_zero_d_cap() {
    let mut env = common::env();
    let mut p = params_from_vectors(&env, 4);
    p.d_cap = 0;
    common::assert_err(
        send_create(&mut env, &p),
        macropaths::MacroError::InvalidParams,
    );
}

#[test]
fn create_session_rejects_zero_a_cap() {
    let mut env = common::env();
    let mut p = params_from_vectors(&env, 5);
    p.a_cap = 0;
    common::assert_err(
        send_create(&mut env, &p),
        macropaths::MacroError::InvalidParams,
    );
}

#[test]
fn create_session_rejects_same_session_id_twice() {
    let mut env = common::env();
    let p = params_from_vectors(&env, 6);
    send_create(&mut env, &p).unwrap_or_else(|err| panic!("{}", err.meta.pretty_logs()));

    // A fresh blockhash makes the second signature distinct, so a failure is the
    // existing session account and not TransactionError::AlreadyProcessed.
    env.svm.expire_blockhash();

    let failed = send_create(&mut env, &p).expect_err("second create_session must fail");
    println!("second create_session error: {:?}", failed.err);
    println!("{}", failed.meta.pretty_logs());

    assert!(
        !matches!(failed.err, TransactionError::AlreadyProcessed),
        "second send was treated as a duplicate transaction: {:?}",
        failed.err
    );
    let already_exists = failed
        .meta
        .logs
        .iter()
        .any(|line| line.contains("already in use"));
    assert!(
        already_exists,
        "expected the session account to already exist, got {:?}\n{}",
        failed.err,
        failed.meta.pretty_logs()
    );
}

fn json_i64(obj: &serde_json::Value, key: &str) -> i64 {
    obj[key]
        .as_i64()
        .unwrap_or_else(|| panic!("vectors parameters.{key}"))
}

fn hex32(label: &str, raw: &str) -> [u8; 32] {
    let s = raw.strip_prefix("0x").unwrap_or(raw);
    assert_eq!(s.len(), 64, "{label} must be 32 bytes of hex");
    let mut out = [0u8; 32];
    for (i, byte) in out.iter_mut().enumerate() {
        *byte = u8::from_str_radix(&s[i * 2..i * 2 + 2], 16)
            .unwrap_or_else(|err| panic!("{label}: {err}"));
    }
    out
}
