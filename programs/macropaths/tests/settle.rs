//! settle: scores and side-level budgets from an end-of-replay session.
//! Every expected chain number is read from tests/vectors.json.

mod common;

use anchor_lang::prelude::Pubkey;
use anchor_lang::{Event, InstructionData, ToAccountMetas};
use litesvm::types::TransactionMetadata;
use solana_message::Instruction;

use macropaths::events::Settled;
use macropaths::math::side_budgets;
use macropaths::state::SessionState;

/// End-of-replay inputs. Side 0 is the worked example's fully matched `S[0]`
/// minus `buyer_deposit`; side 1 is `S[1]`. Both products use that pair.
/// `matched` is `min` of each pair, which lock stores.
struct Replay {
    n_obs: u32,
    max_decline: i64,
    excess_acc: i64,
    scores: [u64; 2],
    side_totals: [u64; 4],
    matched: [u64; 2],
}

fn replay() -> Replay {
    let v = common::vectors();
    let n = v["commitment"]["N"].as_u64().expect("commitment.N");
    assert_eq!(n, u64::from(macropaths::N_OBS));
    let n_obs = u32::try_from(n).expect("N fits u32");

    let cooling = &v["worked_example"]["cooling"];
    let excess = &v["worked_example"]["excess"];
    assert_eq!(cooling["S"], excess["S"]);
    let fully_matched = json_u64(&cooling["S"][0], "cooling.S0");
    let buyer = json_u64(&v["worked_example"]["buyer_deposit"], "buyer_deposit");
    let side_0 = fully_matched
        .checked_sub(buyer)
        .expect("seed side is the matched side minus the buyer");
    let side_1 = json_u64(&cooling["S"][1], "cooling.S1");
    let matched = side_0.min(side_1);

    Replay {
        n_obs,
        max_decline: json_i64(&v["final"]["D"], "final.D"),
        excess_acc: json_i64(&v["final"]["A"], "final.A"),
        scores: [
            json_u64(&v["final"]["s1"], "final.s1"),
            json_u64(&v["final"]["s2"], "final.s2"),
        ],
        side_totals: [side_0, side_1, side_0, side_1],
        matched: [matched, matched],
    }
}

fn end_of_replay(
    env: &mut common::Env,
    id: u64,
    apply: impl FnOnce(&mut macropaths::Session),
) -> Pubkey {
    let stats = replay();
    common::put_session(env, id, |session| {
        session.state = SessionState::Running;
        session.next_index = stats.n_obs;
        session.commitment = session.terminal;
        session.max_decline = stats.max_decline;
        session.excess_acc = stats.excess_acc;
        session.side_totals = stats.side_totals;
        session.matched = stats.matched;
        apply(session);
    })
}

fn settle_ix(session: Pubkey) -> Instruction {
    Instruction {
        program_id: macropaths::ID,
        accounts: macropaths::accounts::Settle { session }.to_account_metas(None),
        data: macropaths::instruction::Settle.data(),
    }
}

fn send_settle(
    env: &mut common::Env,
    session: Pubkey,
) -> Result<TransactionMetadata, litesvm::types::FailedTransactionMetadata> {
    common::send(env, settle_ix(session), &[])
}

fn assert_settled_event(logs: &[String], expected: &Settled) {
    let raw = expected.data();
    let found = logs.iter().any(|line| {
        line.split_once("Program data: ")
            .and_then(|(_, encoded)| decode_b64(encoded.trim()))
            .is_some_and(|bytes| bytes == raw)
    });
    assert!(
        found,
        "Settled event missing from logs:\n{}",
        logs.join("\n")
    );
}

#[test]
fn settle_scores_and_budgets() {
    let mut env = common::env();
    let stats = replay();
    let session = end_of_replay(&mut env, 1, |_| {});

    let meta =
        send_settle(&mut env, session).unwrap_or_else(|err| panic!("{}", err.meta.pretty_logs()));
    let got: macropaths::Session = common::read(&env, &session);

    assert_eq!(got.scores, stats.scores);
    assert!(got.state == SessionState::Settled);
    assert_eq!(got.matched, stats.matched);

    let mut p_budget = [0u64; 4];
    let mut r_budget = [0u64; 4];
    for i in 0..2 {
        let (p0, p1, r0, r1) = side_budgets(
            stats.side_totals[2 * i],
            stats.side_totals[2 * i + 1],
            stats.scores[i],
        )
        .expect("side budgets");
        p_budget[2 * i] = p0;
        p_budget[2 * i + 1] = p1;
        r_budget[2 * i] = r0;
        r_budget[2 * i + 1] = r1;
    }
    assert_eq!(got.p_budget, p_budget);
    assert_eq!(got.r_budget, r_budget);

    assert_settled_event(
        &meta.logs,
        &Settled {
            session,
            scores: stats.scores,
            matched: stats.matched,
            p_budget,
            r_budget,
        },
    );
}

#[test]
fn settle_chain_incomplete_next_index() {
    let mut env = common::env();
    let prior = replay()
        .n_obs
        .checked_sub(1)
        .expect("index before the last");
    let session = end_of_replay(&mut env, 1, |account| {
        account.next_index = prior;
    });

    common::assert_err(
        send_settle(&mut env, session),
        macropaths::MacroError::ChainIncomplete,
    );
}

#[test]
fn settle_chain_incomplete_commitment() {
    let mut env = common::env();
    let opening = common::vectors()["commitment"]["C_0"]
        .as_str()
        .expect("C_0")
        .to_string();
    let session = end_of_replay(&mut env, 1, |account| {
        account.commitment = hex32("commitment.C_0", &opening);
        assert_ne!(account.commitment, account.terminal);
    });

    common::assert_err(
        send_settle(&mut env, session),
        macropaths::MacroError::ChainIncomplete,
    );
}

#[test]
fn settle_wrong_state_open() {
    let mut env = common::env();
    let session = end_of_replay(&mut env, 1, |account| {
        account.state = SessionState::Open;
    });

    common::assert_err(
        send_settle(&mut env, session),
        macropaths::MacroError::WrongState,
    );
}

#[test]
fn settle_twice_wrong_state() {
    let mut env = common::env();
    let session = end_of_replay(&mut env, 1, |_| {});

    send_settle(&mut env, session).unwrap_or_else(|err| panic!("{}", err.meta.pretty_logs()));
    let settled: macropaths::Session = common::read(&env, &session);
    assert!(settled.state == SessionState::Settled);

    env.svm.expire_blockhash();
    common::assert_err(
        send_settle(&mut env, session),
        macropaths::MacroError::WrongState,
    );
    let still: macropaths::Session = common::read(&env, &session);
    assert!(still.state == SessionState::Settled);
}

fn json_u64(value: &serde_json::Value, label: &str) -> u64 {
    value
        .as_u64()
        .unwrap_or_else(|| panic!("{label} must be a u64"))
}

fn json_i64(value: &serde_json::Value, label: &str) -> i64 {
    value
        .as_i64()
        .unwrap_or_else(|| panic!("{label} must be an i64"))
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

fn decode_b64(input: &str) -> Option<Vec<u8>> {
    fn val(b: u8) -> Option<u8> {
        match b {
            b'A'..=b'Z' => Some(b - b'A'),
            b'a'..=b'z' => Some(b - b'a' + 26),
            b'0'..=b'9' => Some(b - b'0' + 52),
            b'+' => Some(62),
            b'/' => Some(63),
            _ => None,
        }
    }

    let bytes = input.trim().trim_end_matches('=').as_bytes();
    if bytes.len() % 4 == 1 {
        return None;
    }
    let mut out = Vec::with_capacity(bytes.len() / 4 * 3 + 2);
    let mut i = 0;
    while i + 4 <= bytes.len() {
        let a = val(bytes[i])?;
        let b = val(bytes[i + 1])?;
        let c = val(bytes[i + 2])?;
        let d = val(bytes[i + 3])?;
        out.push((a << 2) | (b >> 4));
        out.push(((b & 0x0f) << 4) | (c >> 2));
        out.push(((c & 0x03) << 6) | d);
        i += 4;
    }
    let rest = bytes.len() - i;
    if rest == 2 {
        let a = val(bytes[i])?;
        let b = val(bytes[i + 1])?;
        out.push((a << 2) | (b >> 4));
    } else if rest == 3 {
        let a = val(bytes[i])?;
        let b = val(bytes[i + 1])?;
        let c = val(bytes[i + 2])?;
        out.push((a << 2) | (b >> 4));
        out.push(((b & 0x0f) << 4) | (c >> 2));
    }
    Some(out)
}
