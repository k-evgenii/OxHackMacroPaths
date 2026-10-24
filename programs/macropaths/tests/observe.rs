//! observe: hash-chain checks and the cooling / excess recursions.
//! Every expected number is read from tests/vectors.json.
//! Each test starts from put_session in state Running.

mod common;

use anchor_lang::prelude::Pubkey;
use anchor_lang::{InstructionData, ToAccountMetas};
use litesvm::types::TransactionMetadata;
use solana_message::Instruction;

use macropaths::error::MacroError;
use macropaths::state::SessionState;

struct Row {
    index: u8,
    period_id: u32,
    value: i64,
    next: [u8; 32],
    peak: i64,
    max_decline: i64,
    excess_acc: i64,
}

struct Series {
    rows: Vec<Row>,
    terminal: [u8; 32],
    final_decline: i64,
    final_excess: i64,
}

fn series() -> Series {
    let v = common::vectors();
    let chain = v["chain"].as_array().expect("chain");
    let running = v["running"].as_array().expect("running");
    assert_eq!(chain.len(), running.len(), "chain and running length");
    let terminal = hex32(
        "commitment.C_N",
        v["commitment"]["C_N"].as_str().expect("C_N"),
    );
    let mut rows = Vec::with_capacity(chain.len());
    for i in 0..chain.len() {
        let t = running[i]["t"].as_u64().expect("running.t");
        assert_eq!(t, i as u64, "running row order");
        let index = u8::try_from(chain[i]["i"].as_u64().expect("chain.i")).expect("index");
        assert_eq!(usize::from(index), i, "chain row order");
        let next = if i + 1 < chain.len() {
            hex32("chain.C_i", chain[i + 1]["C_i"].as_str().expect("C_i"))
        } else {
            terminal
        };
        rows.push(Row {
            index,
            period_id: u32::try_from(chain[i]["period_id"].as_u64().expect("period_id"))
                .expect("period_id"),
            value: chain[i]["value"].as_i64().expect("value"),
            next,
            peak: running[i]["M"].as_i64().expect("M"),
            max_decline: running[i]["D"].as_i64().expect("D"),
            excess_acc: running[i]["A"].as_i64().expect("A"),
        });
    }
    Series {
        rows,
        terminal,
        final_decline: v["final"]["D"].as_i64().expect("final.D"),
        final_excess: v["final"]["A"].as_i64().expect("final.A"),
    }
}

fn running_session(env: &mut common::Env, id: u64) -> Pubkey {
    common::put_session(env, id, |session| {
        session.state = SessionState::Running;
    })
}

fn observe_ix(
    session: Pubkey,
    index: u8,
    period_id: u32,
    value: i64,
    next_commitment: [u8; 32],
) -> Instruction {
    Instruction {
        program_id: macropaths::ID,
        accounts: macropaths::accounts::Observe { session }.to_account_metas(None),
        data: macropaths::instruction::Observe {
            index,
            period_id,
            value,
            next_commitment,
        }
        .data(),
    }
}

fn send_ok(env: &mut common::Env, ix: Instruction) -> TransactionMetadata {
    common::send(env, ix, &[]).unwrap_or_else(|err| panic!("{}", err.meta.pretty_logs()))
}

fn session_bytes(env: &common::Env, session: &Pubkey) -> Vec<u8> {
    env.svm
        .get_account(session)
        .unwrap_or_else(|| panic!("missing session {session}"))
        .data
}

fn assert_row(env: &common::Env, session: &Pubkey, rows: &[Row], through: usize) {
    let got: macropaths::Session = common::read(env, session);
    let row = &rows[through];
    assert_eq!(got.peak, row.peak, "peak at {}", row.index);
    assert_eq!(
        got.max_decline, row.max_decline,
        "max_decline at {}",
        row.index
    );
    assert_eq!(
        got.excess_acc, row.excess_acc,
        "excess_acc at {}",
        row.index
    );
    assert_eq!(
        got.values[usize::from(row.index)],
        row.value,
        "value at {}",
        row.index
    );
    assert_eq!(
        got.next_index,
        row.index.checked_add(1).expect("next_index"),
        "next_index at {}",
        row.index
    );
    assert_eq!(got.commitment, row.next, "commitment at {}", row.index);
    assert_eq!(got.last_period_id, row.period_id, "period at {}", row.index);
    for earlier in &rows[..=through] {
        assert_eq!(
            got.values[usize::from(earlier.index)],
            earlier.value,
            "stored value {}",
            earlier.index
        );
    }
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

#[test]
fn observe_ten_rows() {
    let series = series();
    let mut env = common::env();
    let session = running_session(&mut env, 1);
    for through in 0..10 {
        let row = &series.rows[through];
        send_ok(
            &mut env,
            observe_ix(session, row.index, row.period_id, row.value, row.next),
        );
        assert_row(&env, &session, &series.rows, through);
    }
}

#[test]
fn observe_wrong_value_unchanged() {
    let series = series();
    let mut env = common::env();
    let session = running_session(&mut env, 1);
    let row = &series.rows[0];
    let before = session_bytes(&env, &session);
    let bad_value = row.value.checked_add(1).expect("bad value");
    let res = common::send(
        &mut env,
        observe_ix(session, row.index, row.period_id, bad_value, row.next),
        &[],
    );
    common::assert_err(res, MacroError::BadCommitment);
    assert_eq!(session_bytes(&env, &session), before);
}

#[test]
fn observe_wrong_next_commitment() {
    let series = series();
    let mut env = common::env();
    let session = running_session(&mut env, 1);
    let row = &series.rows[0];
    let mut bad_next = row.next;
    bad_next[0] ^= 0xff;
    let res = common::send(
        &mut env,
        observe_ix(session, row.index, row.period_id, row.value, bad_next),
        &[],
    );
    common::assert_err(res, MacroError::BadCommitment);
}

#[test]
fn observe_skip_index() {
    let series = series();
    let mut env = common::env();
    let session = running_session(&mut env, 1);
    let row = &series.rows[1];
    let res = common::send(
        &mut env,
        observe_ix(session, row.index, row.period_id, row.value, row.next),
        &[],
    );
    common::assert_err(res, MacroError::WrongIndex);
}

#[test]
fn observe_replay_same_row() {
    let series = series();
    let mut env = common::env();
    let session = running_session(&mut env, 1);
    let row = &series.rows[0];
    let ix = observe_ix(session, row.index, row.period_id, row.value, row.next);
    send_ok(&mut env, ix.clone());
    env.svm.expire_blockhash();
    let res = common::send(&mut env, ix, &[]);
    common::assert_err(res, MacroError::WrongIndex);
}

#[test]
fn observe_swapped_rows() {
    let series = series();
    let mut env = common::env();
    let session = running_session(&mut env, 1);
    for row in &series.rows[..3] {
        send_ok(
            &mut env,
            observe_ix(session, row.index, row.period_id, row.value, row.next),
        );
    }
    let swapped = &series.rows[4];
    let res = common::send(
        &mut env,
        observe_ix(
            session,
            series.rows[3].index,
            swapped.period_id,
            swapped.value,
            swapped.next,
        ),
        &[],
    );
    common::assert_err(res, MacroError::BadCommitment);
}

#[test]
fn observe_tampered_period() {
    let series = series();
    let mut env = common::env();
    let session = running_session(&mut env, 1);
    let row = &series.rows[0];
    let period_id = row.period_id.checked_add(1).expect("period");
    assert!(period_id > 0);
    let res = common::send(
        &mut env,
        observe_ix(session, row.index, period_id, row.value, row.next),
        &[],
    );
    common::assert_err(res, MacroError::BadCommitment);
}

#[test]
fn observe_open_wrong_state() {
    let series = series();
    let mut env = common::env();
    let session = common::put_session(&mut env, 1, |_| {});
    let row = &series.rows[0];
    let res = common::send(
        &mut env,
        observe_ix(session, row.index, row.period_id, row.value, row.next),
        &[],
    );
    common::assert_err(res, MacroError::WrongState);
}

#[test]
fn observe_past_deadline() {
    let series = series();
    let mut env = common::env();
    let session = running_session(&mut env, 1);
    let stored: macropaths::Session = common::read(&env, &session);
    common::set_time(
        &mut env,
        stored.replay_deadline.checked_add(1).expect("deadline"),
    );
    let row = &series.rows[0];
    let res = common::send(
        &mut env,
        observe_ix(session, row.index, row.period_id, row.value, row.next),
        &[],
    );
    common::assert_err(res, MacroError::PastDeadline);
}

#[test]
fn observe_period_not_increasing() {
    let series = series();
    let mut env = common::env();
    let session = running_session(&mut env, 1);
    let first = &series.rows[0];
    send_ok(
        &mut env,
        observe_ix(
            session,
            first.index,
            first.period_id,
            first.value,
            first.next,
        ),
    );
    let row = &series.rows[1];
    let res = common::send(
        &mut env,
        observe_ix(session, row.index, first.period_id, row.value, row.next),
        &[],
    );
    common::assert_err(res, MacroError::PeriodNotIncreasing);
}

#[test]
fn observe_compute_units() {
    let series = series();
    let mut env = common::env();
    let session = running_session(&mut env, 1);
    let row = &series.rows[0];
    let meta = send_ok(
        &mut env,
        observe_ix(session, row.index, row.period_id, row.value, row.next),
    );
    println!(
        "observe compute_units_consumed: {}",
        meta.compute_units_consumed
    );
    assert!(meta.compute_units_consumed > 0);
}

#[test]
fn observe_all_rows() {
    let series = series();
    let mut env = common::env();
    let session = running_session(&mut env, 1);
    let mut max_cu = 0u64;
    for through in 0..series.rows.len() {
        let row = &series.rows[through];
        let meta = send_ok(
            &mut env,
            observe_ix(session, row.index, row.period_id, row.value, row.next),
        );
        max_cu = max_cu.max(meta.compute_units_consumed);
        assert_row(&env, &session, &series.rows, through);
    }
    let got: macropaths::Session = common::read(&env, &session);
    assert_eq!(got.commitment, series.terminal);
    assert_eq!(got.commitment, got.terminal);
    assert_eq!(got.max_decline, series.final_decline);
    assert_eq!(got.excess_acc, series.final_excess);
    println!("observe max compute_units_consumed: {max_cu}");
    assert!(max_cu > 0);
}
