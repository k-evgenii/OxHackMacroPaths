//! Whole-pool lifecycle through the real instructions.
//! create → deposit → lock → 48 observes → settle → claim → sweep.
//! Expected numbers come from tests/vectors.json. No put_* fixtures.

mod common;

use anchor_lang::prelude::Pubkey;
use anchor_lang::{InstructionData, ToAccountMetas};
use litesvm::types::{FailedTransactionMetadata, TransactionMetadata};
use litesvm_token::MintTo;
use solana_keypair::Keypair;
use solana_message::Instruction;
use solana_signer::Signer;

use macropaths::math::claim_amount;
use macropaths::state::SessionState;

/// Chain figures the lifecycle asserts. Every field is read from tests/vectors.json.
struct Figures {
    /// `worked_example.buyer_deposit` (10 PLAY).
    buyer: u64,
    /// Cooling side 0 minus the buyer: the seeder's side-0 deposit (90 PLAY).
    seed0: u64,
    /// Cooling side 1: the seeder's side-1 deposit (100 PLAY).
    seed1: u64,
    /// 1 PLAY in base units, so product 1 can lock.
    one_play: u64,
    /// `worked_example.cooling.M`.
    cooling_m: u64,
    /// `final.s1`.
    score_cooling: u64,
    /// `final.s2`.
    score_excess: u64,
    /// `worked_example.buyer_total`.
    buyer_total: u64,
}

struct ObsRow {
    index: u32,
    period_id: u32,
    value: i64,
    next: [u8; 32],
}

struct Cu {
    observe_max: u64,
    observe_sum: u64,
    observe_n: u64,
    settle: u64,
    claim: u64,
}

/// Gate G1. Product 0 is the worked example. Product 1 is 1 PLAY on each side
/// so `lock_and_start` is not `EmptySide`.
#[test]
fn lifecycle_one_product() {
    let fig = figures();
    let mut env = common::env();
    let session = common::create_session_default(&mut env, 1);
    assert_vaults_equal_sides(&env, &session);

    let seeder = common::seed_sides(&mut env, &session, [fig.seed0, fig.seed1, 0, 0]);
    assert_vaults_equal_sides(&env, &session);

    let buyer_amounts = [fig.buyer, 0, 0, 0];
    let buyer = deposit_new(&mut env, &session, buyer_amounts);
    assert_vaults_equal_sides(&env, &session);

    let filler = [0, 0, fig.one_play, fig.one_play];
    deposit_more(&mut env, &session, &seeder, filler);
    assert_vaults_equal_sides(&env, &session);

    let open: macropaths::Session = common::read(&env, &session);
    assert!(open.state == SessionState::Open);
    assert_eq!(open.position_count, 2);
    assert_eq!(
        open.side_totals[0],
        fig.seed0.checked_add(fig.buyer).expect("side 0")
    );
    assert_eq!(open.side_totals[1], fig.seed1);
    assert_eq!(open.side_totals[2], fig.one_play);
    assert_eq!(open.side_totals[3], fig.one_play);

    let authority = env.authority.insecure_clone();
    must("lock_and_start", lock(&mut env, &session, &authority));
    let running: macropaths::Session = common::read(&env, &session);
    assert!(running.state == SessionState::Running);
    // The seeder's side-0 deposit is `seed0` (90 PLAY). The buyer then adds
    // `buyer` (10 PLAY) on that same side, so lock's matched[0] is
    // min(seed0+buyer, seed1), which is `worked_example.cooling.M`.
    assert_eq!(running.matched, [fig.cooling_m, fig.one_play]);
    assert_vaults_equal_sides(&env, &session);

    let rows = observe_rows();
    let mut cu = observe_measuring(&mut env, &session, &rows);
    assert_vaults_equal_sides(&env, &session);

    let settle_meta = must("settle", settle(&mut env, &session));
    cu.settle = settle_meta.compute_units_consumed;
    let settled: macropaths::Session = common::read(&env, &session);
    assert!(settled.state == SessionState::Settled);
    assert_eq!(settled.scores[0], fig.score_cooling);
    assert_eq!(settled.scores[1], fig.score_excess);
    assert_vaults_equal_sides(&env, &session);

    let buyer_side0 = claim_amount(
        fig.buyer,
        settled.r_budget[0],
        settled.p_budget[0],
        settled.side_totals[0],
    )
    .expect("buyer product-0 claim");
    let buyer_pay = claim_total(&settled, buyer_amounts);
    assert_eq!(buyer_pay, buyer_side0, "buyer holds only side 0");

    let seeder_amounts = [fig.seed0, fig.seed1, fig.one_play, fig.one_play];
    let seeder_pay = claim_total(&settled, seeder_amounts);

    let (paid_buyer, claim_cu) = claim_owner(&mut env, &session, &buyer, buyer_amounts);
    cu.claim = claim_cu;
    assert_eq!(paid_buyer, buyer_pay);
    let (paid_seeder, _) = claim_owner(&mut env, &session, &seeder, seeder_amounts);
    assert_eq!(paid_seeder, seeder_pay);

    let dust = assert_after_claims(&env, &session, &[paid_buyer, paid_seeder]);
    let treasury = Keypair::new();
    let treasury_ta = common::ata_with(&mut env, &treasury.pubkey(), 0);
    must(
        "sweep_dust",
        sweep(&mut env, &session, &authority, treasury_ta),
    );
    assert_swept(&env, &session, treasury_ta, dust);
    print_cu("lifecycle_one_product", &cu);
}

/// Gate G2. Both products are the worked example: seeder [90, 100, 90, 100],
/// buyer [10, 0, 10, 0].
#[test]
fn lifecycle_full() {
    let fig = figures();
    let mut env = common::env();
    let session = common::create_session_default(&mut env, 1);
    assert_vaults_equal_sides(&env, &session);

    let seeder_amounts = [fig.seed0, fig.seed1, fig.seed0, fig.seed1];
    let seeder = common::seed_sides(&mut env, &session, seeder_amounts);
    assert_vaults_equal_sides(&env, &session);

    let buyer_amounts = [fig.buyer, 0, fig.buyer, 0];
    let buyer = deposit_new(&mut env, &session, buyer_amounts);
    assert_vaults_equal_sides(&env, &session);

    let open: macropaths::Session = common::read(&env, &session);
    assert!(open.state == SessionState::Open);
    assert_eq!(open.position_count, 2);
    assert_eq!(
        open.side_totals,
        [
            fig.seed0.checked_add(fig.buyer).expect("side 0"),
            fig.seed1,
            fig.seed0.checked_add(fig.buyer).expect("side 2"),
            fig.seed1,
        ]
    );

    let authority = env.authority.insecure_clone();
    must("lock_and_start", lock(&mut env, &session, &authority));
    let running: macropaths::Session = common::read(&env, &session);
    assert!(running.state == SessionState::Running);
    assert_eq!(running.matched, [fig.cooling_m, fig.cooling_m]);
    assert_vaults_equal_sides(&env, &session);

    let rows = observe_rows();
    let mut cu = observe_measuring(&mut env, &session, &rows);
    assert_vaults_equal_sides(&env, &session);

    let settle_meta = must("settle", settle(&mut env, &session));
    cu.settle = settle_meta.compute_units_consumed;
    let settled: macropaths::Session = common::read(&env, &session);
    assert!(settled.state == SessionState::Settled);
    assert_eq!(settled.scores, [fig.score_cooling, fig.score_excess]);
    assert_vaults_equal_sides(&env, &session);

    let buyer_pay = claim_total(&settled, buyer_amounts);
    let seeder_pay = claim_total(&settled, seeder_amounts);

    let (paid_buyer, claim_cu) = claim_owner(&mut env, &session, &buyer, buyer_amounts);
    cu.claim = claim_cu;
    assert_eq!(
        paid_buyer, fig.buyer_total,
        "buyer balance rises by worked_example.buyer_total"
    );
    assert_eq!(paid_buyer, buyer_pay);
    let (paid_seeder, _) = claim_owner(&mut env, &session, &seeder, seeder_amounts);
    assert_eq!(
        paid_seeder, seeder_pay,
        "seeder claim is the sum of its four claim_amounts"
    );

    let dust = assert_after_claims(&env, &session, &[paid_buyer, paid_seeder]);
    let treasury = Keypair::new();
    let treasury_ta = common::ata_with(&mut env, &treasury.pubkey(), 0);
    must(
        "sweep_dust",
        sweep(&mut env, &session, &authority, treasury_ta),
    );
    assert_swept(&env, &session, treasury_ta, dust);
    print_cu("lifecycle_full", &cu);
}

fn figures() -> Figures {
    let v = common::vectors();
    let buyer = json_u64(&v["worked_example"]["buyer_deposit"], "buyer_deposit");
    let cooling = &v["worked_example"]["cooling"];
    let excess = &v["worked_example"]["excess"];
    let cooling_s0 = json_u64(&cooling["S"][0], "cooling.S0");
    let cooling_s1 = json_u64(&cooling["S"][1], "cooling.S1");
    assert_eq!(
        cooling["S"], excess["S"],
        "both products use the worked-example sides"
    );
    let seed0 = cooling_s0
        .checked_sub(buyer)
        .expect("seed side is matched minus buyer");
    let one_play = 10u64
        .checked_pow(u32::from(macropaths::PLAY_DECIMALS))
        .expect("1 PLAY");
    assert_eq!(one_play, macropaths::ONE);
    let score_cooling = json_u64(&v["final"]["s1"], "final.s1");
    let score_excess = json_u64(&v["final"]["s2"], "final.s2");
    assert_eq!(score_cooling, json_u64(&cooling["s"], "cooling.s"));
    assert_eq!(score_excess, json_u64(&excess["s"], "excess.s"));
    assert_eq!(
        json_u64(&cooling["M"], "cooling.M"),
        cooling_s0.min(cooling_s1)
    );
    Figures {
        buyer,
        seed0,
        seed1: cooling_s1,
        one_play,
        cooling_m: json_u64(&cooling["M"], "cooling.M"),
        score_cooling,
        score_excess,
        buyer_total: json_u64(&v["worked_example"]["buyer_total"], "buyer_total"),
    }
}

/// The 48 observe rows, same construction as `observe.rs::series`.
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
        rows.push(ObsRow {
            index,
            period_id: u32::try_from(chain[i]["period_id"].as_u64().expect("period_id"))
                .expect("period_id"),
            value: chain[i]["value"].as_i64().expect("value"),
            next,
        });
    }
    rows
}

fn observe_measuring(env: &mut common::Env, session: &Pubkey, rows: &[ObsRow]) -> Cu {
    let mut observe_max = 0u64;
    let mut observe_sum = 0u64;
    for row in rows {
        let ix = instruction(
            macropaths::accounts::Observe { session: *session },
            macropaths::instruction::Observe {
                index: row.index,
                period_id: row.period_id,
                value: row.value,
                next_commitment: row.next,
            },
        );
        let meta = must("observe", common::send(env, ix, &[]));
        let cu = meta.compute_units_consumed;
        observe_max = observe_max.max(cu);
        observe_sum = observe_sum.checked_add(cu).expect("observe cu sum");
        assert_vaults_equal_sides(env, session);
    }
    Cu {
        observe_max,
        observe_sum,
        observe_n: u64::try_from(rows.len()).expect("row count"),
        settle: 0,
        claim: 0,
    }
}

fn print_cu(name: &str, cu: &Cu) {
    let mean = cu
        .observe_sum
        .checked_div(cu.observe_n)
        .expect("observe mean");
    println!(
        "{name} cu observe_max={observe_max} observe_mean={mean} observe_sum={observe_sum} observe_n={observe_n} settle={settle} claim={claim}",
        observe_max = cu.observe_max,
        observe_sum = cu.observe_sum,
        observe_n = cu.observe_n,
        settle = cu.settle,
        claim = cu.claim,
    );
}

fn deposit_new(env: &mut common::Env, session: &Pubkey, amounts: [u64; 4]) -> Keypair {
    let owner = Keypair::new();
    env.svm
        .airdrop(&owner.pubkey(), 1_000_000_000)
        .expect("airdrop depositor");
    let total = amounts
        .iter()
        .try_fold(0u64, |acc, n| acc.checked_add(*n))
        .expect("fund");
    let owner_ta = common::ata_with(env, &owner.pubkey(), total);
    must(
        "deposit",
        send_deposit(env, &owner, session, owner_ta, amounts),
    );
    assert_eq!(common::token_balance(env, &owner_ta), 0);
    owner
}

fn deposit_more(env: &mut common::Env, session: &Pubkey, owner: &Keypair, amounts: [u64; 4]) {
    let owner_ta =
        anchor_spl::associated_token::get_associated_token_address(&owner.pubkey(), &env.mint);
    let extra = amounts
        .iter()
        .try_fold(0u64, |acc, n| acc.checked_add(*n))
        .expect("extra");
    MintTo::new(&mut env.svm, &env.payer, &env.mint, &owner_ta, extra)
        .send()
        .unwrap_or_else(|err| panic!("mint seeder top-up: {}", err.meta.pretty_logs()));
    must(
        "deposit",
        send_deposit(env, owner, session, owner_ta, amounts),
    );
    assert_eq!(common::token_balance(env, &owner_ta), 0);
}

fn send_deposit(
    env: &mut common::Env,
    owner: &Keypair,
    session: &Pubkey,
    owner_ta: Pubkey,
    amounts: [u64; 4],
) -> Result<TransactionMetadata, FailedTransactionMetadata> {
    let owner_key = owner.pubkey();
    let (position, _) = common::position_pda(session, &owner_key);
    let (vault_0, _) = common::vault_pda(session, 0);
    let (vault_1, _) = common::vault_pda(session, 1);
    common::send(
        env,
        instruction(
            macropaths::accounts::Deposit {
                owner: owner_key,
                session: *session,
                position,
                owner_ta,
                vault_0,
                vault_1,
                token_program: anchor_spl::token::ID,
                system_program: anchor_lang::system_program::ID,
            },
            macropaths::instruction::Deposit { amounts },
        ),
        &[owner],
    )
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

/// Claims, checks each vault fell by that product's payout, and returns
/// (tokens received, compute units of this claim).
fn claim_owner(
    env: &mut common::Env,
    session: &Pubkey,
    owner: &Keypair,
    deposited: [u64; 4],
) -> (u64, u64) {
    let owner_key = owner.pubkey();
    let (position, _) = common::position_pda(session, &owner_key);
    let owner_ta =
        anchor_spl::associated_token::get_associated_token_address(&owner_key, &env.mint);
    let (vault_0, _) = common::vault_pda(session, 0);
    let (vault_1, _) = common::vault_pda(session, 1);
    let before_vaults = [
        common::token_balance(env, &vault_0),
        common::token_balance(env, &vault_1),
    ];
    let before_owner = common::token_balance(env, &owner_ta);
    let account: macropaths::Session = common::read(env, session);
    let pays = product_pays(&account, deposited);

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

    let after_vaults = [
        common::token_balance(env, &vault_0),
        common::token_balance(env, &vault_1),
    ];
    for i in 0..2 {
        let fell = before_vaults[i]
            .checked_sub(after_vaults[i])
            .expect("vault fell");
        assert_eq!(fell, pays[i], "vault {i} fell by the claim");
    }
    let received = common::token_balance(env, &owner_ta)
        .checked_sub(before_owner)
        .expect("owner balance rose");
    let expected = pays[0].checked_add(pays[1]).expect("claim total");
    assert_eq!(received, expected);
    (received, meta.compute_units_consumed)
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

fn claim_total(session: &macropaths::Session, deposited: [u64; 4]) -> u64 {
    let pays = product_pays(session, deposited);
    pays[0].checked_add(pays[1]).expect("claim total")
}

fn product_pays(session: &macropaths::Session, deposited: [u64; 4]) -> [u64; 2] {
    let mut pays = [0u64; 2];
    for product in 0..2 {
        for side in 0..2 {
            let j = product * 2 + side;
            let part = claim_amount(
                deposited[j],
                session.r_budget[j],
                session.p_budget[j],
                session.side_totals[j],
            )
            .expect("claim_amount");
            pays[product] = pays[product].checked_add(part).expect("product pay");
        }
    }
    pays
}

fn assert_vaults_equal_sides(env: &common::Env, session: &Pubkey) {
    let account: macropaths::Session = common::read(env, session);
    let sides = account
        .side_totals
        .iter()
        .try_fold(0u64, |acc, n| acc.checked_add(*n))
        .expect("side sum");
    let (v0, v1) = vault_balances(env, session);
    let vaults = v0.checked_add(v1).expect("vault sum");
    assert_eq!(vaults, sides, "vault_0 + vault_1 == sum of side_totals");
}

fn assert_after_claims(env: &common::Env, session: &Pubkey, paid: &[u64]) -> u64 {
    let account: macropaths::Session = common::read(env, session);
    assert_eq!(account.claimed_count, account.position_count);
    let deposited = account
        .side_totals
        .iter()
        .try_fold(0u64, |acc, n| acc.checked_add(*n))
        .expect("deposited");
    let paid_sum = paid
        .iter()
        .try_fold(0u64, |acc, n| acc.checked_add(*n))
        .expect("paid");
    assert!(
        paid_sum <= deposited,
        "paid {paid_sum} exceeds deposited {deposited}"
    );
    let (v0, v1) = vault_balances(env, session);
    let dust = v0.checked_add(v1).expect("dust");
    assert_eq!(
        paid_sum.checked_add(dust).expect("conservation"),
        deposited,
        "paid plus dust equals deposited"
    );
    dust
}

fn assert_swept(env: &common::Env, session: &Pubkey, treasury_ta: Pubkey, dust: u64) {
    let (v0, v1) = vault_balances(env, session);
    assert_eq!(v0, 0, "vault 0 empty after sweep");
    assert_eq!(v1, 0, "vault 1 empty after sweep");
    assert_eq!(common::token_balance(env, &treasury_ta), dust);
    let account: macropaths::Session = common::read(env, session);
    assert_eq!(account.claimed_count, account.position_count);
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

fn json_u64(value: &serde_json::Value, label: &str) -> u64 {
    value
        .as_u64()
        .unwrap_or_else(|| panic!("{label} must be a u64"))
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
