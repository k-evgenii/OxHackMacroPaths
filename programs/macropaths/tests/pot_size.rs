//! Pot-size lifecycles through the real binary in target/deploy/macropaths.so.
//!
//! Each test runs the whole flow with large pools:
//! create_session -> deposits on all four sides -> lock_and_start -> 48 observes
//! -> settle -> claim for every position -> sweep_dust.
//!
//! The expected payouts are recomputed here in u128 from the spec formula,
//! not through `macropaths::math`, so the binary is checked against an
//! independent reference:
//!
//!   M = min(S0, S1), P0 = floor(2*M*s / ONE), P1 = 2*M - P0, R_j = S_j - M,
//!   claim = floor(a*R_j / S_j) + floor(a*P_j / S_j)
//!
//! Scores come from the settled Session account and are checked against
//! tests/vectors.json (`final.s1`, `final.s2`). Deposit sizes are inputs of
//! these tests, not reference values.

mod common;

use anchor_lang::prelude::Pubkey;
use anchor_lang::{InstructionData, ToAccountMetas};
use litesvm::types::{FailedTransactionMetadata, TransactionMetadata};
use solana_keypair::Keypair;
use solana_message::Instruction;
use solana_signer::Signer;

use macropaths::state::SessionState;

/// Per-side deposit that matches the lamport count of 10 SOL (10 * 10^9).
/// PLAY has 6 decimals, so in PLAY terms this is 10_000 PLAY. Only the base-unit
/// scale matters here: it is a pot size, not a SOL amount.
const TEN_SOL_LAMPORTS: u64 = 10_000_000_000;

/// 10^15 base units on one side.
const BIG_SIDE: u64 = 1_000_000_000_000_000;

/// 10^6 base units (1 PLAY) on the small side.
const SMALL_SIDE: u64 = 1_000_000;

/// Largest per-side total that keeps `S0 + S1` (one vault) inside the mint's u64
/// supply while leaving room for the other product's two sides.
const U64_EDGE_SIDE: u64 = u64::MAX / 2 - 1;

/// One position's deposit: index `j = product * 2 + side`.
type Amounts = [u64; 4];

struct Outcome {
    /// Total deposited into each product vault.
    deposited: [u64; 2],
    scores: [u64; 2],
    side_totals: [u64; 4],
    budgets_p: [u64; 4],
    budgets_r: [u64; 4],
}

/// Runs the full lifecycle for `holders` and checks every conservation and
/// reference-formula property. Panics on any instruction failure.
fn run_pot(name: &str, holders: &[Amounts]) -> Outcome {
    let mut env = common::env();
    let session = common::create_session_default(&mut env, 1);

    // Deposits. `seed_sides` mints exactly the holder's total, so the owner
    // balance must be empty afterwards.
    let mut keys: Vec<Keypair> = Vec::with_capacity(holders.len());
    let mut expected_sides = [0u64; 4];
    for amounts in holders {
        for (j, amount) in amounts.iter().enumerate() {
            expected_sides[j] = expected_sides[j]
                .checked_add(*amount)
                .expect("test deposits fit in u64 per side");
        }
        let owner = common::seed_sides(&mut env, &session, *amounts);
        let ta =
            anchor_spl::associated_token::get_associated_token_address(&owner.pubkey(), &env.mint);
        assert_eq!(
            common::token_balance(&env, &ta),
            0,
            "deposit drained the owner"
        );
        keys.push(owner);
    }

    let open: macropaths::Session = common::read(&env, &session);
    assert!(open.state == SessionState::Open);
    assert_eq!(open.side_totals, expected_sides, "{name}: side totals");
    assert_eq!(
        usize::try_from(open.position_count).expect("position count"),
        holders.len()
    );
    let deposited = [
        expected_sides[0]
            .checked_add(expected_sides[1])
            .expect("product 0 total"),
        expected_sides[2]
            .checked_add(expected_sides[3])
            .expect("product 1 total"),
    ];
    assert_eq!(vault_balances(&env, &session), (deposited[0], deposited[1]));

    // Lock.
    let authority = env.authority.insecure_clone();
    must("lock_and_start", lock(&mut env, &session, &authority));
    let running: macropaths::Session = common::read(&env, &session);
    assert!(running.state == SessionState::Running);
    assert_eq!(
        running.matched,
        [
            expected_sides[0].min(expected_sides[1]),
            expected_sides[2].min(expected_sides[3])
        ]
    );

    // 48 observes. `observe_all` panics with the program logs on any failure.
    let rows = observe_rows();
    assert_eq!(rows.len(), usize::try_from(macropaths::N_OBS).expect("N"));
    let mut observe_cu_max = 0u64;
    for row in &rows {
        let meta = must(
            "observe",
            common::send(
                &mut env,
                instruction(
                    macropaths::accounts::Observe { session },
                    macropaths::instruction::Observe {
                        index: row.0,
                        period_id: row.1,
                        value: row.2,
                        next_commitment: row.3,
                    },
                ),
                &[],
            ),
        );
        observe_cu_max = observe_cu_max.max(meta.compute_units_consumed);
    }
    assert_eq!(vault_balances(&env, &session), (deposited[0], deposited[1]));

    // Settle.
    let settle_meta = must("settle", settle(&mut env, &session));
    let settled: macropaths::Session = common::read(&env, &session);
    assert!(settled.state == SessionState::Settled);
    let v = common::vectors();
    let want_scores = [
        v["final"]["s1"].as_u64().expect("final.s1"),
        v["final"]["s2"].as_u64().expect("final.s2"),
    ];
    assert_eq!(settled.scores, want_scores, "{name}: scores match vectors");
    assert_eq!(settled.side_totals, expected_sides);

    // Reference budgets against what settle stored.
    for product in 0..2 {
        let (p, r) = ref_budgets(
            settled.side_totals[2 * product],
            settled.side_totals[2 * product + 1],
            settled.scores[product],
        );
        for side in 0..2 {
            let j = 2 * product + side;
            assert_eq!(u128::from(settled.p_budget[j]), p[side], "{name}: P[{j}]");
            assert_eq!(u128::from(settled.r_budget[j]), r[side], "{name}: R[{j}]");
        }
        // P0 + P1 = 2M and R0 + R1 + P0 + P1 = S0 + S1: nothing is created.
        let matched = u128::from(settled.matched[product]);
        assert_eq!(p[0] + p[1], 2 * matched);
        assert_eq!(
            p[0] + p[1] + r[0] + r[1],
            u128::from(deposited[product]),
            "{name}: budgets cover the product vault exactly"
        );
    }

    // Claims for every position, each against the u128 reference.
    let mut paid: Vec<[u64; 2]> = Vec::with_capacity(holders.len());
    let mut claim_cu_max = 0u64;
    for (owner, amounts) in keys.iter().zip(holders) {
        let want = ref_pays(amounts, &settled.side_totals, settled.scores);
        let (got, cu) = claim_owner(&mut env, &session, owner);
        claim_cu_max = claim_cu_max.max(cu);
        assert_eq!(
            [u128::from(got[0]), u128::from(got[1])],
            want,
            "{name}: claim for {amounts:?}"
        );
        paid.push(got);
    }
    let after: macropaths::Session = common::read(&env, &session);
    assert_eq!(after.claimed_count, after.position_count);

    // Conservation per product vault: claims plus what is left equals deposited.
    let (v0, v1) = vault_balances(&env, &session);
    let dust = [v0, v1];
    for product in 0..2 {
        let claimed: u128 = paid.iter().map(|p| u128::from(p[product])).sum();
        assert_eq!(
            claimed + u128::from(dust[product]),
            u128::from(deposited[product]),
            "{name}: product {product} vault conservation"
        );
        // Dust is only floor loss: each (holder, side) pair floors twice.
        let terms = 2 * holders
            .iter()
            .flat_map(|h| h[2 * product..2 * product + 2].iter())
            .filter(|a| **a > 0)
            .count();
        assert!(
            usize::try_from(dust[product]).expect("dust") < terms,
            "{name}: product {product} dust {} must be below {terms} floor terms",
            dust[product]
        );
    }

    // Sweep and re-check conservation with the swept dust included.
    let treasury = Keypair::new();
    let treasury_ta = common::ata_with(&mut env, &treasury.pubkey(), 0);
    must(
        "sweep_dust",
        sweep(&mut env, &session, &authority, treasury_ta),
    );
    assert_eq!(
        vault_balances(&env, &session),
        (0, 0),
        "vaults empty after sweep"
    );
    let swept = common::token_balance(&env, &treasury_ta);
    assert_eq!(
        swept,
        dust[0] + dust[1],
        "treasury received both vaults' dust"
    );
    let all_claims: u128 = paid
        .iter()
        .flat_map(|p| p.iter())
        .map(|n| u128::from(*n))
        .sum();
    assert_eq!(
        all_claims + u128::from(swept),
        u128::from(deposited[0]) + u128::from(deposited[1]),
        "{name}: claims + swept dust == total deposited"
    );

    println!(
        "pot_size {name}: deposited={deposited:?} sides={expected_sides:?} scores={:?} \
         P={:?} R={:?} paid={paid:?} dust={dust:?} swept={swept} \
         cu observe_max={observe_cu_max} settle={} claim_max={claim_cu_max}",
        settled.scores, settled.p_budget, settled.r_budget, settle_meta.compute_units_consumed,
    );

    Outcome {
        deposited,
        scores: settled.scores,
        side_totals: settled.side_totals,
        budgets_p: settled.p_budget,
        budgets_r: settled.r_budget,
    }
}

/// Scenario 1. Every side holds 10 * 10^9 base units (the lamport count of 10 SOL).
/// Side 0 of both products is split across two positions so the floors bite.
#[test]
fn pot_ten_sol_vs_ten_sol() {
    let holders: [Amounts; 3] = [
        [3_333_333_333, 0, 3_333_333_333, 0],
        [6_666_666_667, 0, 6_666_666_667, 0],
        [0, TEN_SOL_LAMPORTS, 0, TEN_SOL_LAMPORTS],
    ];
    let out = run_pot("10sol_vs_10sol", &holders);
    assert_eq!(out.side_totals, [TEN_SOL_LAMPORTS; 4]);
    assert_eq!(out.deposited, [2 * TEN_SOL_LAMPORTS; 2]);
    // Equal sides: no refunds, everything is the matched pool.
    assert_eq!(out.budgets_r, [0; 4]);
    assert_eq!(out.budgets_p[0] + out.budgets_p[1], 2 * TEN_SOL_LAMPORTS);
    assert_eq!(out.budgets_p[2] + out.budgets_p[3], 2 * TEN_SOL_LAMPORTS);
}

/// Scenario 2. One side of each product holds 10^15 base units and the other
/// 10^6, in opposite directions for the two products. The large side's refund
/// budget `R = 10^15 - 10^6` is multiplied by deposits near 10^15 in the claim.
#[test]
fn pot_one_e15_side_vs_small_side() {
    let big_a: u64 = 600_000_000_000_001;
    let big_b: u64 = BIG_SIDE - big_a;
    let holders: [Amounts; 3] = [
        [big_a, 0, 0, big_a],
        [big_b, 0, 0, big_b],
        [0, SMALL_SIDE, SMALL_SIDE, 0],
    ];
    let out = run_pot("1e15_vs_1e6", &holders);
    assert_eq!(
        out.side_totals,
        [BIG_SIDE, SMALL_SIDE, SMALL_SIDE, BIG_SIDE]
    );
    // M = 10^6 in both products, so the pool is 2 * 10^6 and the rest is refunded.
    assert_eq!(out.budgets_p[0] + out.budgets_p[1], 2 * SMALL_SIDE);
    assert_eq!(out.budgets_p[2] + out.budgets_p[3], 2 * SMALL_SIDE);
    assert_eq!(
        out.budgets_r,
        [BIG_SIDE - SMALL_SIDE, 0, 0, BIG_SIDE - SMALL_SIDE]
    );
}

/// Scenario 2b. Both sides of both products hold 10^15 base units.
#[test]
fn pot_one_e15_both_sides() {
    let third: u64 = 333_333_333_333_333;
    let rest: u64 = BIG_SIDE - third;
    let holders: [Amounts; 3] = [
        [third, 0, third, 0],
        [rest, 0, rest, 0],
        [0, BIG_SIDE, 0, BIG_SIDE],
    ];
    let out = run_pot("1e15_vs_1e15", &holders);
    assert_eq!(out.side_totals, [BIG_SIDE; 4]);
    assert_eq!(out.deposited, [2 * BIG_SIDE; 2]);
    assert_eq!(out.budgets_r, [0; 4]);
}

/// Edge of the u64 range for one vault: product 0 sides hold `u64::MAX / 2 - 1`
/// each, so the vault holds nearly `u64::MAX` and `2 * M` is still a u64. The
/// claim products `a * P_j` reach about 1.4e38, under `u128::MAX` (about 3.4e38).
#[test]
fn pot_u64_range_edge() {
    let split: u64 = 1_000_000_007;
    let holders: [Amounts; 3] = [
        [U64_EDGE_SIDE - split, 0, 1, 0],
        [split, 0, 0, 0],
        [0, U64_EDGE_SIDE, 0, 1],
    ];
    let out = run_pot("u64_edge", &holders);
    assert_eq!(out.side_totals, [U64_EDGE_SIDE, U64_EDGE_SIDE, 1, 1]);
    assert_eq!(out.deposited[0], 2 * U64_EDGE_SIDE);
    assert!(out.deposited[0] < u64::MAX);
    assert_eq!(out.budgets_r, [0; 4]);
    assert!(out.scores[0] > 0 && out.scores[1] > 0);
}

// ---------------------------------------------------------------------------
// Reference maths in u128. Independent of `macropaths::math`.
// ---------------------------------------------------------------------------

/// `([P0, P1], [R0, R1])` for one product.
fn ref_budgets(s0: u64, s1: u64, score: u64) -> ([u128; 2], [u128; 2]) {
    let (s0, s1, score) = (u128::from(s0), u128::from(s1), u128::from(score));
    let one = u128::from(macropaths::ONE);
    let m = s0.min(s1);
    let p0 = 2u128
        .checked_mul(m)
        .and_then(|x| x.checked_mul(score))
        .expect("2*M*s fits u128")
        / one;
    let p1 = 2 * m - p0;
    ([p0, p1], [s0 - m, s1 - m])
}

/// `floor(a*R/S) + floor(a*P/S)`, `0` for an empty side.
fn ref_claim(a: u64, s_j: u64, r_j: u128, p_j: u128) -> u128 {
    if s_j == 0 {
        return 0;
    }
    let a = u128::from(a);
    let s = u128::from(s_j);
    let from_r = a.checked_mul(r_j).expect("a*R fits u128") / s;
    let from_p = a.checked_mul(p_j).expect("a*P fits u128") / s;
    from_r + from_p
}

/// The reference payout out of `[vault_0, vault_1]` for one position.
fn ref_pays(amounts: &Amounts, side_totals: &[u64; 4], scores: [u64; 2]) -> [u128; 2] {
    let mut pays = [0u128; 2];
    for product in 0..2 {
        let (p, r) = ref_budgets(
            side_totals[2 * product],
            side_totals[2 * product + 1],
            scores[product],
        );
        for side in 0..2 {
            let j = 2 * product + side;
            pays[product] += ref_claim(amounts[j], side_totals[j], r[side], p[side]);
        }
    }
    pays
}

// ---------------------------------------------------------------------------
// Local helpers (same shape as lifecycle.rs).
// ---------------------------------------------------------------------------

type ObsRow = (u32, u32, i64, [u8; 32]);

/// The 48 observe rows from tests/vectors.json, same construction as lifecycle.rs.
fn observe_rows() -> Vec<ObsRow> {
    let v = common::vectors();
    let chain = v["chain"].as_array().expect("chain");
    let n = v["commitment"]["N"].as_u64().expect("commitment.N");
    assert_eq!(n, u64::from(macropaths::N_OBS));
    assert_eq!(chain.len() as u64, n, "chain length");
    let terminal = hex32(
        "commitment.C_N",
        v["commitment"]["C_N"].as_str().expect("C_N"),
    );
    let mut rows = Vec::with_capacity(chain.len());
    for i in 0..chain.len() {
        let index = u32::try_from(chain[i]["i"].as_u64().expect("chain.i")).expect("index");
        assert_eq!(index as usize, i, "chain row order");
        let next = if i + 1 < chain.len() {
            hex32("chain.C_i", chain[i + 1]["C_i"].as_str().expect("C_i"))
        } else {
            terminal
        };
        rows.push((
            index,
            u32::try_from(chain[i]["period_id"].as_u64().expect("period_id")).expect("period_id"),
            chain[i]["value"].as_i64().expect("value"),
            next,
        ));
    }
    rows
}

fn lock(
    env: &mut common::Env,
    session: &Pubkey,
    authority: &Keypair,
) -> Result<TransactionMetadata, FailedTransactionMetadata> {
    common::send(
        env,
        instruction(
            macropaths::accounts::LockAndStart {
                authority: authority.pubkey(),
                session: *session,
            },
            macropaths::instruction::LockAndStart,
        ),
        &[authority],
    )
}

fn settle(
    env: &mut common::Env,
    session: &Pubkey,
) -> Result<TransactionMetadata, FailedTransactionMetadata> {
    common::send(
        env,
        instruction(
            macropaths::accounts::Settle { session: *session },
            macropaths::instruction::Settle,
        ),
        &[],
    )
}

/// Claims for `owner`. Returns (what each vault paid out, compute units), and
/// checks the owner's balance rose by exactly the two vault payouts.
fn claim_owner(env: &mut common::Env, session: &Pubkey, owner: &Keypair) -> ([u64; 2], u64) {
    let owner_key = owner.pubkey();
    let (position, _) = common::position_pda(session, &owner_key);
    let owner_ta =
        anchor_spl::associated_token::get_associated_token_address(&owner_key, &env.mint);
    let (vault_0, _) = common::vault_pda(session, 0);
    let (vault_1, _) = common::vault_pda(session, 1);
    let before = [
        common::token_balance(env, &vault_0),
        common::token_balance(env, &vault_1),
    ];
    let before_owner = common::token_balance(env, &owner_ta);

    let meta = must(
        "claim",
        common::send(
            env,
            instruction(
                macropaths::accounts::Claim {
                    owner: owner_key,
                    session: *session,
                    position,
                    owner_ta,
                    vault_0,
                    vault_1,
                    token_program: anchor_spl::token::ID,
                },
                macropaths::instruction::Claim {},
            ),
            &[owner],
        ),
    );

    let after = [
        common::token_balance(env, &vault_0),
        common::token_balance(env, &vault_1),
    ];
    let fell = [
        before[0].checked_sub(after[0]).expect("vault 0 fell"),
        before[1].checked_sub(after[1]).expect("vault 1 fell"),
    ];
    let received = common::token_balance(env, &owner_ta)
        .checked_sub(before_owner)
        .expect("owner balance rose");
    assert_eq!(
        received,
        fell[0].checked_add(fell[1]).expect("claim total"),
        "owner received what the vaults paid"
    );
    (fell, meta.compute_units_consumed)
}

fn sweep(
    env: &mut common::Env,
    session: &Pubkey,
    authority: &Keypair,
    treasury_ta: Pubkey,
) -> Result<TransactionMetadata, FailedTransactionMetadata> {
    let (vault_0, _) = common::vault_pda(session, 0);
    let (vault_1, _) = common::vault_pda(session, 1);
    common::send(
        env,
        instruction(
            macropaths::accounts::SweepDust {
                authority: authority.pubkey(),
                session: *session,
                treasury_ta,
                vault_0,
                vault_1,
                token_program: anchor_spl::token::ID,
            },
            macropaths::instruction::SweepDust {},
        ),
        &[authority],
    )
}

fn vault_balances(env: &common::Env, session: &Pubkey) -> (u64, u64) {
    let (vault_0, _) = common::vault_pda(session, 0);
    let (vault_1, _) = common::vault_pda(session, 1);
    (
        common::token_balance(env, &vault_0),
        common::token_balance(env, &vault_1),
    )
}

fn must(
    instruction_name: &str,
    result: Result<TransactionMetadata, FailedTransactionMetadata>,
) -> TransactionMetadata {
    result.unwrap_or_else(|err| {
        panic!(
            "{instruction_name} failed: {err:?}\n{}",
            err.meta.pretty_logs()
        )
    })
}

fn instruction<A: ToAccountMetas, D: InstructionData>(accounts: A, data: D) -> Instruction {
    Instruction {
        program_id: macropaths::ID,
        accounts: accounts.to_account_metas(None),
        data: data.data(),
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
