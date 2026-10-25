//! Deposit: position create-or-update and transfers into both product vaults.
//! PLAY amounts come from tests/vectors.json (`worked_example.buyer_deposit` is 10 PLAY).

mod common;

use anchor_lang::prelude::Pubkey;
use anchor_lang::{InstructionData, ToAccountMetas};
use litesvm::types::TransactionMetadata;
use litesvm_token::{CreateAssociatedTokenAccount, CreateMint, MintTo};
use solana_keypair::Keypair;
use solana_message::Instruction;
use solana_signer::Signer;

const SESSION_ID: u64 = 1;

#[test]
fn deposit_first_creates_position() {
    let mut env = common::env();
    let (ten, _) = play_pair();
    let owner = env.payer.insecure_clone();
    let funding = ten.checked_mul(2).expect("fund");
    let (session, owner_ta) = prepare(&mut env, &owner.pubkey(), funding);
    let amounts = [ten, 0, ten, 0];

    must(send_deposit(&mut env, &owner, &session, &owner_ta, amounts));

    assert_position(&env, &session, &owner.pubkey(), amounts, false);
    assert_books(&env, &session, amounts, 1);
    assert_eq!(common::token_balance(&env, &owner_ta), 0);
}

#[test]
fn deposit_second_same_owner() {
    let mut env = common::env();
    let (ten, five) = play_pair();
    let owner = env.payer.insecure_clone();
    let funding = ten
        .checked_mul(2)
        .and_then(|two| two.checked_add(five))
        .expect("fund");
    let (session, owner_ta) = prepare(&mut env, &owner.pubkey(), funding);
    let first = [ten, 0, ten, 0];
    let second = [0, five, 0, 0];

    must(send_deposit(&mut env, &owner, &session, &owner_ta, first));
    env.svm.expire_blockhash();
    must(send_deposit(&mut env, &owner, &session, &owner_ta, second));

    let deposited = [ten, five, ten, 0];
    assert_position(&env, &session, &owner.pubkey(), deposited, false);
    assert_books(&env, &session, deposited, 1);
    assert_eq!(common::token_balance(&env, &owner_ta), 0);
}

#[test]
fn deposit_zero_amount() {
    let mut env = common::env();
    let (ten, _) = play_pair();
    let owner = env.payer.insecure_clone();
    let (session, owner_ta) = prepare(&mut env, &owner.pubkey(), ten);
    let before = books(&env, &session);

    common::assert_err(
        send_deposit(&mut env, &owner, &session, &owner_ta, [0, 0, 0, 0]),
        macropaths::MacroError::ZeroAmount,
    );

    assert_same_books(&books(&env, &session), &before);
    assert_eq!(common::token_balance(&env, &owner_ta), ten);
    assert_no_position(&env, &session, &owner.pubkey());
}

#[test]
fn deposit_wrong_mint() {
    let mut env = common::env();
    let (ten, _) = play_pair();
    let owner = env.payer.insecure_clone();
    let session = common::put_session(&mut env, SESSION_ID, |_| {});
    common::put_vaults(&mut env, &session, [0, 0]);
    let owner_ta = ata_of_other_mint(&mut env, &owner.pubkey(), ten);
    let before = books(&env, &session);
    let balance = common::token_balance(&env, &owner_ta);

    common::assert_err(
        send_deposit(&mut env, &owner, &session, &owner_ta, [ten, 0, 0, 0]),
        macropaths::MacroError::WrongMint,
    );

    assert_same_books(&books(&env, &session), &before);
    assert_eq!(common::token_balance(&env, &owner_ta), balance);
    assert_no_position(&env, &session, &owner.pubkey());
}

#[test]
fn deposit_wrong_owner() {
    let mut env = common::env();
    let (ten, _) = play_pair();
    let owner = env.payer.insecure_clone();
    let other = Keypair::new();
    let session = common::put_session(&mut env, SESSION_ID, |_| {});
    common::put_vaults(&mut env, &session, [0, 0]);
    let owner_ta = common::ata_with(&mut env, &other.pubkey(), ten);
    let before = books(&env, &session);

    common::assert_err(
        send_deposit(&mut env, &owner, &session, &owner_ta, [ten, 0, 0, 0]),
        macropaths::MacroError::WrongOwner,
    );

    assert_same_books(&books(&env, &session), &before);
    assert_eq!(common::token_balance(&env, &owner_ta), ten);
    assert_no_position(&env, &session, &owner.pubkey());
}

#[test]
fn deposit_past_deadline() {
    let mut env = common::env();
    let (ten, _) = play_pair();
    let owner = env.payer.insecure_clone();
    let (session, owner_ta) = prepare(&mut env, &owner.pubkey(), ten);
    let deadline = common::read::<macropaths::Session>(&env, &session).deposit_deadline;
    common::set_time(
        &mut env,
        deadline.checked_add(1).expect("one second past deadline"),
    );
    let before = books(&env, &session);

    common::assert_err(
        send_deposit(&mut env, &owner, &session, &owner_ta, [ten, 0, 0, 0]),
        macropaths::MacroError::PastDeadline,
    );

    assert_same_books(&books(&env, &session), &before);
    assert_eq!(common::token_balance(&env, &owner_ta), ten);
    assert_no_position(&env, &session, &owner.pubkey());
}

#[test]
fn deposit_at_deadline() {
    let mut env = common::env();
    let (ten, _) = play_pair();
    let owner = env.payer.insecure_clone();
    let funding = ten.checked_mul(2).expect("fund");
    let (session, owner_ta) = prepare(&mut env, &owner.pubkey(), funding);
    let deadline = common::read::<macropaths::Session>(&env, &session).deposit_deadline;
    common::set_time(&mut env, deadline);
    let amounts = [ten, 0, ten, 0];

    must(send_deposit(&mut env, &owner, &session, &owner_ta, amounts));

    assert_position(&env, &session, &owner.pubkey(), amounts, false);
    assert_books(&env, &session, amounts, 1);
}

#[test]
fn deposit_wrong_state() {
    let mut env = common::env();
    let (ten, _) = play_pair();
    let owner = env.payer.insecure_clone();
    let session = common::put_session(&mut env, SESSION_ID, |account| {
        account.state = macropaths::SessionState::Running;
    });
    common::put_vaults(&mut env, &session, [0, 0]);
    let owner_ta = common::ata_with(&mut env, &owner.pubkey(), ten);
    let before = books(&env, &session);

    common::assert_err(
        send_deposit(&mut env, &owner, &session, &owner_ta, [ten, 0, 0, 0]),
        macropaths::MacroError::WrongState,
    );

    assert_same_books(&books(&env, &session), &before);
    assert!(before.state == macropaths::SessionState::Running);
    assert_eq!(common::token_balance(&env, &owner_ta), ten);
    assert_no_position(&env, &session, &owner.pubkey());
}

#[test]
fn deposit_two_owners() {
    let mut env = common::env();
    let (ten, _) = play_pair();
    let first = env.payer.insecure_clone();
    let second = env.authority.insecure_clone();
    let funding = ten.checked_mul(2).expect("fund");
    let session = common::put_session(&mut env, SESSION_ID, |_| {});
    common::put_vaults(&mut env, &session, [0, 0]);
    let first_ta = common::ata_with(&mut env, &first.pubkey(), funding);
    let second_ta = common::ata_with(&mut env, &second.pubkey(), funding);
    let amounts = [ten, 0, ten, 0];

    must(send_deposit(&mut env, &first, &session, &first_ta, amounts));
    env.svm.expire_blockhash();
    must(send_deposit(
        &mut env, &second, &session, &second_ta, amounts,
    ));

    assert_position(&env, &session, &first.pubkey(), amounts, false);
    assert_position(&env, &session, &second.pubkey(), amounts, false);
    let side_totals = [
        ten.checked_mul(2).expect("side 0"),
        0,
        ten.checked_mul(2).expect("side 2"),
        0,
    ];
    assert_books(&env, &session, side_totals, 2);
    assert_eq!(common::token_balance(&env, &first_ta), 0);
    assert_eq!(common::token_balance(&env, &second_ta), 0);
}

/// 10 PLAY is `worked_example.buyer_deposit`. 5 PLAY is exactly half of that.
fn play_pair() -> (u64, u64) {
    let vectors = common::vectors();
    let ten = vectors["worked_example"]["buyer_deposit"]
        .as_u64()
        .expect("worked_example.buyer_deposit");
    let five = ten.checked_div(2).expect("half buyer deposit");
    assert_eq!(five.checked_mul(2), Some(ten), "buyer deposit must be even");
    (ten, five)
}

fn prepare(env: &mut common::Env, owner: &Pubkey, funding: u64) -> (Pubkey, Pubkey) {
    let session = common::put_session(env, SESSION_ID, |_| {});
    common::put_vaults(env, &session, [0, 0]);
    let owner_ta = common::ata_with(env, owner, funding);
    (session, owner_ta)
}

fn ata_of_other_mint(env: &mut common::Env, owner: &Pubkey, amount: u64) -> Pubkey {
    let mint = CreateMint::new(&mut env.svm, &env.payer)
        .decimals(macropaths::PLAY_DECIMALS)
        .send()
        .expect("create second mint");
    let ata = CreateAssociatedTokenAccount::new(&mut env.svm, &env.payer, &mint)
        .owner(owner)
        .send()
        .expect("create second-mint account");
    MintTo::new(&mut env.svm, &env.payer, &mint, &ata, amount)
        .send()
        .expect("fund second mint");
    ata
}

fn send_deposit(
    env: &mut common::Env,
    owner: &Keypair,
    session: &Pubkey,
    owner_ta: &Pubkey,
    amounts: [u64; 4],
) -> Result<TransactionMetadata, litesvm::types::FailedTransactionMetadata> {
    let owner_key = owner.pubkey();
    let (position, _) = common::position_pda(session, &owner_key);
    let (vault_0, _) = common::vault_pda(session, 0);
    let (vault_1, _) = common::vault_pda(session, 1);
    let ix = Instruction {
        program_id: macropaths::ID,
        accounts: macropaths::accounts::Deposit {
            owner: owner_key,
            session: *session,
            position,
            owner_ta: *owner_ta,
            vault_0,
            vault_1,
            token_program: anchor_spl::token::ID,
            system_program: anchor_lang::system_program::ID,
        }
        .to_account_metas(None),
        data: macropaths::instruction::Deposit { amounts }.data(),
    };
    common::send(env, ix, &[owner])
}

fn must(result: Result<TransactionMetadata, litesvm::types::FailedTransactionMetadata>) {
    result.unwrap_or_else(|err| panic!("{}", err.meta.pretty_logs()));
}

#[derive(Clone, Copy)]
struct Books {
    side_totals: [u64; 4],
    position_count: u32,
    state: macropaths::SessionState,
    vault_0: u64,
    vault_1: u64,
}

fn books(env: &common::Env, session: &Pubkey) -> Books {
    let account = common::read::<macropaths::Session>(env, session);
    let (vault_0, _) = common::vault_pda(session, 0);
    let (vault_1, _) = common::vault_pda(session, 1);
    Books {
        side_totals: account.side_totals,
        position_count: account.position_count,
        state: account.state,
        vault_0: common::token_balance(env, &vault_0),
        vault_1: common::token_balance(env, &vault_1),
    }
}

fn assert_same_books(left: &Books, right: &Books) {
    assert_eq!(left.side_totals, right.side_totals);
    assert_eq!(left.position_count, right.position_count);
    assert!(left.state == right.state);
    assert_eq!(left.vault_0, right.vault_0);
    assert_eq!(left.vault_1, right.vault_1);
}

fn assert_books(env: &common::Env, session: &Pubkey, side_totals: [u64; 4], position_count: u32) {
    let got = books(env, session);
    assert_eq!(got.side_totals, side_totals);
    assert_eq!(got.position_count, position_count);
    assert!(got.state == macropaths::SessionState::Open);
    let (vault_0_amount, vault_1_amount) = product_totals(side_totals);
    assert_eq!(got.vault_0, vault_0_amount);
    assert_eq!(got.vault_1, vault_1_amount);
}

fn assert_position(
    env: &common::Env,
    session: &Pubkey,
    owner: &Pubkey,
    deposited: [u64; 4],
    claimed: bool,
) {
    let (position, bump) = common::position_pda(session, owner);
    let account = common::read::<macropaths::Position>(env, &position);
    assert_eq!(account.session, *session);
    assert_eq!(account.owner, *owner);
    assert_eq!(account.deposited, deposited);
    assert_eq!(account.claimed, claimed);
    assert_eq!(account.bump, bump);
}

fn assert_no_position(env: &common::Env, session: &Pubkey, owner: &Pubkey) {
    let (position, _) = common::position_pda(session, owner);
    assert!(env.svm.get_account(&position).is_none());
}

fn product_totals(amounts: [u64; 4]) -> (u64, u64) {
    (
        amounts[0].checked_add(amounts[1]).expect("vault 0 total"),
        amounts[2].checked_add(amounts[3]).expect("vault 1 total"),
    )
}
