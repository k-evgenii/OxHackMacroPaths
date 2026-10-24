//! Claim and sweep_dust. Reference amounts are read from tests/vectors.json.
use anchor_lang::{InstructionData, ToAccountMetas};
use litesvm::types::{FailedTransactionMetadata, TransactionMetadata};
use litesvm_token::{CreateAssociatedTokenAccount, CreateMint};
use serde_json::Value;
use solana_keypair::Keypair;
use solana_message::Instruction;
use solana_signer::Signer;
use solana_transaction::{InstructionError, TransactionError};

use macropaths::math::{claim_amount, side_budgets};
use macropaths::SessionState;

mod common;

#[test]
fn claim_sweep_three_vs_two() {
    let v = common::vectors();
    let b = &v["budget_3v2"];
    let score = as_u64(&b["s"]);
    let side_0 = as_u64(&b["S"][0]);
    let side_1 = as_u64(&b["S"][1]);
    let deposit_a = as_u64(&b["deposits"][0][0]);
    let deposit_b = as_u64(&b["deposits"][0][1]);
    let deposit_c = as_u64(&b["deposits"][1][0]);
    let claim_a = as_u64(&b["claims"][0][0]);
    let claim_b = as_u64(&b["claims"][0][1]);
    let claim_c = as_u64(&b["claims"][1][0]);
    let total_claims = as_u64(&b["total_claims"]);
    let deposited = as_u64(&b["deposited"]);
    let dust = as_u64(&b["dust"]);
    assert_eq!(deposit_a.checked_add(deposit_b).expect("side 0"), side_0);
    assert_eq!(deposit_c, side_1);

    let mut env = common::env();
    let unit = deposit_a;
    let side_totals = [side_0, side_1, unit, unit];
    let pool = pool(
        &mut env,
        1,
        side_totals,
        [score, score],
        SessionState::Settled,
        4,
    );
    let holders = [
        hold(&mut env, &pool, [deposit_a, 0, 0, 0]),
        hold(&mut env, &pool, [deposit_b, 0, 0, 0]),
        hold(&mut env, &pool, [0, deposit_c, 0, 0]),
        hold(&mut env, &pool, [0, 0, unit, unit]),
    ];
    for holder in &holders {
        claim_ok(&mut env, &pool, holder);
    }

    let session = common::read::<macropaths::Session>(&env, &pool.session);
    assert_eq!(session.p_budget[0], as_u64(&b["P"][0]));
    assert_eq!(session.p_budget[1], as_u64(&b["P"][1]));
    assert_eq!(session.r_budget[0], as_u64(&b["R"][0]));
    assert_eq!(session.r_budget[1], as_u64(&b["R"][1]));
    assert_eq!(session.claimed_count, 4);

    let balances = [
        common::token_balance(&env, &holders[0].owner_ta),
        common::token_balance(&env, &holders[1].owner_ta),
        common::token_balance(&env, &holders[2].owner_ta),
        common::token_balance(&env, &holders[3].owner_ta),
    ];
    assert_eq!(balances[0], product_pay(&session, holders[0].deposited, 0));
    assert_eq!(balances[1], product_pay(&session, holders[1].deposited, 0));
    assert_eq!(balances[2], product_pay(&session, holders[2].deposited, 0));
    assert_eq!(
        [balances[0], balances[1], balances[2]],
        [claim_a, claim_b, claim_c]
    );
    let paid = balances[0]
        .checked_add(balances[1])
        .and_then(|sum| sum.checked_add(balances[2]))
        .expect("paid");
    assert_eq!(paid, total_claims);
    assert_eq!(
        side_0.checked_add(side_1).expect("product 0 deposited"),
        deposited
    );
    assert_eq!(common::token_balance(&env, &pool.vault_0), dust);
    let vault_1 = common::token_balance(&env, &pool.vault_1);
    let product_1_paid = product_pay(&session, holders[3].deposited, 1);
    assert_eq!(balances[3], product_1_paid);
    let conserved = paid
        .checked_add(balances[3])
        .and_then(|sum| sum.checked_add(dust))
        .and_then(|sum| sum.checked_add(vault_1))
        .expect("conserved");
    let funded = side_totals
        .into_iter()
        .try_fold(0u64, |acc, amount| acc.checked_add(amount))
        .expect("funded");
    assert_eq!(conserved, funded);
}

#[test]
fn claim_sweep_worked_example() {
    let v = common::vectors();
    let worked = &v["worked_example"];
    let cooling = &worked["cooling"];
    let excess = &worked["excess"];
    let score_0 = as_u64(&cooling["s"]);
    let score_1 = as_u64(&excess["s"]);
    let side = as_u64(&cooling["S"][0]);
    assert_eq!(side, as_u64(&cooling["S"][1]));
    assert_eq!(side, as_u64(&excess["S"][0]));
    assert_eq!(side, as_u64(&excess["S"][1]));
    let buyer_deposit = as_u64(&worked["buyer_deposit"]);
    let buyer_total = as_u64(&worked["buyer_total"]);

    let mut env = common::env();
    let pool = pool(
        &mut env,
        2,
        [side, side, side, side],
        [score_0, score_1],
        SessionState::Settled,
        1,
    );
    let buyer = hold(&mut env, &pool, [buyer_deposit, 0, buyer_deposit, 0]);
    let session = common::read::<macropaths::Session>(&env, &pool.session);
    let expected = product_pay(&session, buyer.deposited, 0)
        .checked_add(product_pay(&session, buyer.deposited, 1))
        .expect("buyer total");
    assert_eq!(expected, buyer_total);

    claim_ok(&mut env, &pool, &buyer);
    assert_eq!(common::token_balance(&env, &buyer.owner_ta), buyer_total);
    let session = common::read::<macropaths::Session>(&env, &pool.session);
    assert_eq!(session.claimed_count, 1);
    let position = common::read::<macropaths::Position>(&env, &buyer.position);
    assert!(position.claimed);
}

#[test]
fn claim_sweep_zero_payout() {
    let v = common::vectors();
    let worked = &v["worked_example"];
    let score_0 = as_u64(&worked["cooling"]["s"]);
    let score_1 = as_u64(&worked["excess"]["s"]);
    let side = as_u64(&worked["cooling"]["S"][0]);
    let unit = as_u64(&v["budget_3v2"]["deposits"][0][0]);

    let mut env = common::env();
    let pool = pool(
        &mut env,
        3,
        [side, side, side, side],
        [score_0, score_1],
        SessionState::Settled,
        1,
    );
    let holder = hold(&mut env, &pool, [0, unit, 0, 0]);
    let session = common::read::<macropaths::Session>(&env, &pool.session);
    let expected = product_pay(&session, holder.deposited, 0)
        .checked_add(product_pay(&session, holder.deposited, 1))
        .expect("zero payout");
    assert_eq!(expected, 0);

    let vault_0 = common::token_balance(&env, &pool.vault_0);
    let vault_1 = common::token_balance(&env, &pool.vault_1);
    claim_ok(&mut env, &pool, &holder);
    assert_eq!(common::token_balance(&env, &holder.owner_ta), 0);
    assert_eq!(common::token_balance(&env, &pool.vault_0), vault_0);
    assert_eq!(common::token_balance(&env, &pool.vault_1), vault_1);
    let session = common::read::<macropaths::Session>(&env, &pool.session);
    assert_eq!(session.claimed_count, 1);
    let position = common::read::<macropaths::Position>(&env, &holder.position);
    assert!(position.claimed);
}

#[test]
fn claim_sweep_double_claim() {
    let v = common::vectors();
    let b = &v["budget_3v2"];
    let score = as_u64(&b["s"]);
    let side_0 = as_u64(&b["S"][0]);
    let side_1 = as_u64(&b["S"][1]);
    let deposit_c = as_u64(&b["deposits"][1][0]);
    let claim_c = as_u64(&b["claims"][1][0]);
    let unit = as_u64(&b["deposits"][0][0]);

    let mut env = common::env();
    let pool = pool(
        &mut env,
        4,
        [side_0, side_1, unit, unit],
        [score, score],
        SessionState::Settled,
        1,
    );
    let holder = hold(&mut env, &pool, [0, deposit_c, 0, 0]);
    claim_ok(&mut env, &pool, &holder);
    assert_eq!(common::token_balance(&env, &holder.owner_ta), claim_c);

    env.svm.expire_blockhash();
    common::assert_err(
        claim_send(&mut env, &pool, &holder),
        macropaths::MacroError::AlreadyClaimed,
    );
    let session = common::read::<macropaths::Session>(&env, &pool.session);
    assert_eq!(session.claimed_count, 1);
}

#[test]
fn claim_sweep_running_rejected() {
    let v = common::vectors();
    let b = &v["budget_3v2"];
    let score = as_u64(&b["s"]);
    let side_0 = as_u64(&b["S"][0]);
    let side_1 = as_u64(&b["S"][1]);
    let deposit_a = as_u64(&b["deposits"][0][0]);

    let mut env = common::env();
    let pool = pool(
        &mut env,
        5,
        [side_0, side_1, deposit_a, deposit_a],
        [score, score],
        SessionState::Running,
        1,
    );
    let holder = hold(&mut env, &pool, [deposit_a, 0, 0, 0]);
    common::assert_err(
        claim_send(&mut env, &pool, &holder),
        macropaths::MacroError::WrongState,
    );
    let session = common::read::<macropaths::Session>(&env, &pool.session);
    assert_eq!(session.claimed_count, 0);
    let position = common::read::<macropaths::Position>(&env, &holder.position);
    assert!(!position.claimed);
}

#[test]
fn claim_sweep_refund() {
    let v = common::vectors();
    let b = &v["budget_3v2"];
    let score = as_u64(&b["s"]);
    let deposited = [
        as_u64(&b["deposits"][0][0]),
        as_u64(&b["deposits"][0][1]),
        as_u64(&b["deposits"][1][0]),
        as_u64(&b["S"][0]),
    ];
    let pay_0 = deposited[0].checked_add(deposited[1]).expect("refund 0");
    let pay_1 = deposited[2].checked_add(deposited[3]).expect("refund 1");

    let mut env = common::env();
    let pool = pool(
        &mut env,
        6,
        deposited,
        [score, score],
        SessionState::Refunding,
        1,
    );
    let holder = hold(&mut env, &pool, deposited);
    claim_ok(&mut env, &pool, &holder);
    assert_eq!(
        common::token_balance(&env, &holder.owner_ta),
        pay_0.checked_add(pay_1).expect("refund")
    );
    assert_eq!(common::token_balance(&env, &pool.vault_0), 0);
    assert_eq!(common::token_balance(&env, &pool.vault_1), 0);
    let session = common::read::<macropaths::Session>(&env, &pool.session);
    assert_eq!(session.claimed_count, 1);
    let position = common::read::<macropaths::Position>(&env, &holder.position);
    assert!(position.claimed);
}

#[test]
fn claim_sweep_sweep_before_all_claimed() {
    let v = common::vectors();
    let b = &v["budget_3v2"];
    let score = as_u64(&b["s"]);
    let deposited_a = [
        as_u64(&b["deposits"][0][0]),
        0,
        as_u64(&b["deposits"][0][0]),
        0,
    ];
    let deposited_b = [
        as_u64(&b["deposits"][0][1]),
        0,
        as_u64(&b["deposits"][1][0]),
        0,
    ];
    let side_totals = [
        deposited_a[0].checked_add(deposited_b[0]).expect("side 0"),
        0,
        deposited_a[2].checked_add(deposited_b[2]).expect("side 2"),
        0,
    ];

    let mut env = common::env();
    let pool = pool(
        &mut env,
        7,
        side_totals,
        [score, score],
        SessionState::Refunding,
        2,
    );
    let first = hold(&mut env, &pool, deposited_a);
    let _second = hold(&mut env, &pool, deposited_b);
    claim_ok(&mut env, &pool, &first);

    let authority = env.authority.insecure_clone();
    let treasury = authority.pubkey();
    let treasury_ta = common::ata_with(&mut env, &treasury, 0);
    common::assert_err(
        sweep_send(&mut env, &pool, &authority, treasury_ta),
        macropaths::MacroError::NotAllClaimed,
    );
}

#[test]
fn claim_sweep_sweep_after_all_claimed() {
    let v = common::vectors();
    let b = &v["budget_3v2"];
    let score = as_u64(&b["s"]);
    let side_0 = as_u64(&b["S"][0]);
    let side_1 = as_u64(&b["S"][1]);
    let deposit_a = as_u64(&b["deposits"][0][0]);
    let deposit_b = as_u64(&b["deposits"][0][1]);
    let deposit_c = as_u64(&b["deposits"][1][0]);
    let dust = as_u64(&b["dust"]);
    let unit = deposit_a;

    let mut env = common::env();
    let pool = pool(
        &mut env,
        8,
        [side_0, side_1, unit, unit],
        [score, score],
        SessionState::Settled,
        4,
    );
    let holders = [
        hold(&mut env, &pool, [deposit_a, 0, 0, 0]),
        hold(&mut env, &pool, [deposit_b, 0, 0, 0]),
        hold(&mut env, &pool, [0, deposit_c, 0, 0]),
        hold(&mut env, &pool, [0, 0, unit, unit]),
    ];
    for holder in &holders {
        claim_ok(&mut env, &pool, holder);
    }
    assert_eq!(common::token_balance(&env, &pool.vault_0), dust);
    let dust_1 = common::token_balance(&env, &pool.vault_1);
    let left = dust.checked_add(dust_1).expect("dust");

    let authority = env.authority.insecure_clone();
    let treasury = authority.pubkey();
    let treasury_ta = common::ata_with(&mut env, &treasury, 0);
    sweep_ok(&mut env, &pool, &authority, treasury_ta);
    assert_eq!(common::token_balance(&env, &pool.vault_0), 0);
    assert_eq!(common::token_balance(&env, &pool.vault_1), 0);
    assert_eq!(common::token_balance(&env, &treasury_ta), left);
}

#[test]
fn claim_sweep_sweep_non_authority() {
    let v = common::vectors();
    let score = as_u64(&v["budget_3v2"]["s"]);
    let mut env = common::env();
    let pool = pool(
        &mut env,
        9,
        [0, 0, 0, 0],
        [score, score],
        SessionState::Settled,
        0,
    );
    let intruder = Keypair::new();
    env.svm
        .airdrop(&intruder.pubkey(), 1_000_000_000)
        .expect("airdrop intruder");
    let treasury = intruder.pubkey();
    let treasury_ta = common::ata_with(&mut env, &treasury, 0);
    let code = custom_code(sweep_send(&mut env, &pool, &intruder, treasury_ta));
    assert_eq!(code, anchor_lang::error::ErrorCode::ConstraintHasOne as u32);
}

#[test]
fn claim_sweep_wrong_mint() {
    let v = common::vectors();
    let b = &v["budget_3v2"];
    let score = as_u64(&b["s"]);
    let deposit = as_u64(&b["deposits"][0][0]);
    let mut env = common::env();
    let pool = pool(
        &mut env,
        10,
        [deposit, deposit, deposit, deposit],
        [score, score],
        SessionState::Refunding,
        1,
    );
    let holder = hold(&mut env, &pool, [deposit, 0, 0, 0]);
    let other_mint = CreateMint::new(&mut env.svm, &env.payer)
        .decimals(macropaths::PLAY_DECIMALS)
        .send()
        .expect("other mint");
    let wrong_ta = CreateAssociatedTokenAccount::new(&mut env.svm, &env.payer, &other_mint)
        .owner(&holder.owner.pubkey())
        .send()
        .expect("other ata");
    let mut accounts = claim_accounts(&pool, &holder);
    accounts.owner_ta = wrong_ta;
    common::assert_err(
        common::send(
            &mut env,
            instruction(accounts, macropaths::instruction::Claim {}),
            &[&holder.owner],
        ),
        macropaths::MacroError::WrongMint,
    );
}

#[test]
fn claim_sweep_wrong_owner() {
    let v = common::vectors();
    let b = &v["budget_3v2"];
    let score = as_u64(&b["s"]);
    let deposit = as_u64(&b["deposits"][0][0]);
    let mut env = common::env();
    let pool = pool(
        &mut env,
        11,
        [deposit, deposit, deposit, deposit],
        [score, score],
        SessionState::Refunding,
        1,
    );
    let holder = hold(&mut env, &pool, [deposit, 0, 0, 0]);
    let other = Keypair::new();
    env.svm
        .airdrop(&other.pubkey(), 1_000_000_000)
        .expect("airdrop other");
    let wrong_ta = common::ata_with(&mut env, &other.pubkey(), 0);
    let mut accounts = claim_accounts(&pool, &holder);
    accounts.owner_ta = wrong_ta;
    common::assert_err(
        common::send(
            &mut env,
            instruction(accounts, macropaths::instruction::Claim {}),
            &[&holder.owner],
        ),
        macropaths::MacroError::WrongOwner,
    );
}

struct Pool {
    session: anchor_lang::prelude::Pubkey,
    vault_0: anchor_lang::prelude::Pubkey,
    vault_1: anchor_lang::prelude::Pubkey,
}

struct Holder {
    owner: Keypair,
    owner_ta: anchor_lang::prelude::Pubkey,
    position: anchor_lang::prelude::Pubkey,
    deposited: [u64; 4],
}

fn pool(
    env: &mut common::Env,
    id: u64,
    side_totals: [u64; 4],
    scores: [u64; 2],
    state: SessionState,
    position_count: u32,
) -> Pool {
    let (p0, p1, r0, r1) =
        side_budgets(side_totals[0], side_totals[1], scores[0]).expect("product 0 budgets");
    let (p2, p3, r2, r3) =
        side_budgets(side_totals[2], side_totals[3], scores[1]).expect("product 1 budgets");
    let session = common::put_session(env, id, |account| {
        account.state = state;
        account.side_totals = side_totals;
        account.scores = scores;
        account.p_budget = [p0, p1, p2, p3];
        account.r_budget = [r0, r1, r2, r3];
        account.matched = [
            side_totals[0].min(side_totals[1]),
            side_totals[2].min(side_totals[3]),
        ];
        account.position_count = position_count;
        account.claimed_count = 0;
        account.cover_count = 0;
        account.cover_claimed_count = 0;
        account.seller_products_open = 0;
    });
    common::put_vaults(
        env,
        &session,
        [
            side_totals[0].checked_add(side_totals[1]).expect("vault 0"),
            side_totals[2].checked_add(side_totals[3]).expect("vault 1"),
        ],
    );
    let (vault_0, _) = common::vault_pda(&session, 0);
    let (vault_1, _) = common::vault_pda(&session, 1);
    Pool {
        session,
        vault_0,
        vault_1,
    }
}

fn hold(env: &mut common::Env, pool: &Pool, deposited: [u64; 4]) -> Holder {
    let owner = Keypair::new();
    env.svm
        .airdrop(&owner.pubkey(), 1_000_000_000)
        .expect("airdrop owner");
    let owner_ta = common::ata_with(env, &owner.pubkey(), 0);
    let position = common::put_position(env, &pool.session, &owner.pubkey(), deposited, false);
    Holder {
        owner,
        owner_ta,
        position,
        deposited,
    }
}

fn claim_accounts(pool: &Pool, holder: &Holder) -> macropaths::accounts::Claim {
    macropaths::accounts::Claim {
        owner: holder.owner.pubkey(),
        session: pool.session,
        position: holder.position,
        owner_ta: holder.owner_ta,
        vault_0: pool.vault_0,
        vault_1: pool.vault_1,
        token_program: anchor_spl::token::ID,
    }
}

fn claim_send(
    env: &mut common::Env,
    pool: &Pool,
    holder: &Holder,
) -> Result<TransactionMetadata, FailedTransactionMetadata> {
    common::send(
        env,
        instruction(
            claim_accounts(pool, holder),
            macropaths::instruction::Claim {},
        ),
        &[&holder.owner],
    )
}

fn claim_ok(env: &mut common::Env, pool: &Pool, holder: &Holder) {
    claim_send(env, pool, holder).unwrap_or_else(|err| panic!("{}", err.meta.pretty_logs()));
}

fn sweep_send(
    env: &mut common::Env,
    pool: &Pool,
    authority: &Keypair,
    treasury_ta: anchor_lang::prelude::Pubkey,
) -> Result<TransactionMetadata, FailedTransactionMetadata> {
    common::send(
        env,
        instruction(
            macropaths::accounts::SweepDust {
                authority: authority.pubkey(),
                session: pool.session,
                treasury_ta,
                vault_0: pool.vault_0,
                vault_1: pool.vault_1,
                token_program: anchor_spl::token::ID,
            },
            macropaths::instruction::SweepDust {},
        ),
        &[authority],
    )
}

fn sweep_ok(
    env: &mut common::Env,
    pool: &Pool,
    authority: &Keypair,
    treasury_ta: anchor_lang::prelude::Pubkey,
) {
    sweep_send(env, pool, authority, treasury_ta)
        .unwrap_or_else(|err| panic!("{}", err.meta.pretty_logs()));
}

fn product_pay(session: &macropaths::Session, deposited: [u64; 4], product: usize) -> u64 {
    let mut sum = 0u64;
    for side in 0..2 {
        let j = product * 2 + side;
        let part = claim_amount(
            deposited[j],
            session.r_budget[j],
            session.p_budget[j],
            session.side_totals[j],
        )
        .expect("claim amount");
        sum = sum.checked_add(part).expect("product pay");
    }
    sum
}

fn custom_code(res: Result<TransactionMetadata, FailedTransactionMetadata>) -> u32 {
    let failed = res.expect_err("expected transaction to fail");
    match failed.err {
        TransactionError::InstructionError(_, InstructionError::Custom(code)) => code,
        other => panic!(
            "expected a custom program error, got {other:?}\n{}",
            failed.meta.pretty_logs()
        ),
    }
}

fn instruction<A: ToAccountMetas, D: InstructionData>(accounts: A, data: D) -> Instruction {
    Instruction {
        program_id: macropaths::ID,
        accounts: accounts.to_account_metas(None),
        data: data.data(),
    }
}

fn as_u64(value: &Value) -> u64 {
    value
        .as_u64()
        .unwrap_or_else(|| panic!("expected u64, got {value}"))
}
