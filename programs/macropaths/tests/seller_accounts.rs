//! seller_fund and set_entry_quote. Sessions come from put_session.
//! 500 PLAY is `parameters.one` base units times 500 (1 PLAY = parameters.one).

mod common;

use anchor_lang::prelude::Pubkey;
use anchor_lang::{InstructionData, ToAccountMetas};
use litesvm::types::{FailedTransactionMetadata, TransactionMetadata};
use litesvm_token::{CreateAssociatedTokenAccount, CreateMint, MintTo};
use solana_keypair::Keypair;
use solana_message::Instruction;
use solana_signer::Signer;
use solana_transaction::{InstructionError, TransactionError};

/// Lamports so a wallet can pay rent. Not a chain value.
const AIRDROP_LAMPORTS: u64 = 1_000_000_000;

const QUOTE_INSIDE: [u64; 2] = [400_000, 300_000];
const QUOTE_LOW: [u64; 2] = [40_000, 300_000];
const QUOTE_HIGH: [u64; 2] = [400_000, 960_000];

const CONSTRAINT_HAS_ONE: u32 = 2001;
const _: () = assert!(anchor_lang::error::ErrorCode::ConstraintHasOne as u32 == CONSTRAINT_HAS_ONE);

#[test]
fn seller_accounts_fund() {
    let mut env = common::env();
    let amount = five_hundred_play();
    let seller = wallet(&mut env);
    let session = common::put_session(&mut env, 1, |_| {});
    let wallet_ta = common::ata_with(&mut env, &seller.pubkey(), amount);

    must(fund(&mut env, &seller, &session, &wallet_ta, amount));

    let stored = read_seller(&env, &session);
    let (_, seller_bump) = common::seller_pda(&session);
    let (seller_ta, ta_bump) = common::seller_ta_pda(&session);
    assert_eq!(stored.seller, seller.pubkey());
    assert_eq!(stored.session, session);
    assert_eq!(stored.free_cash, amount);
    assert_eq!(stored.bump, seller_bump);
    assert_eq!(stored.ta_bump, ta_bump);
    assert_eq!(stored.escrow, [0, 0]);
    assert_eq!(common::token_balance(&env, &seller_ta), amount);
    assert_eq!(common::token_balance(&env, &wallet_ta), 0);
}

#[test]
fn seller_accounts_second_fund() {
    let mut env = common::env();
    let amount = five_hundred_play();
    let twice = amount.checked_mul(2).expect("1000 PLAY");
    let seller = wallet(&mut env);
    let session = common::put_session(&mut env, 1, |_| {});
    let wallet_ta = common::ata_with(&mut env, &seller.pubkey(), twice);

    must(fund(&mut env, &seller, &session, &wallet_ta, amount));
    env.svm.expire_blockhash();
    must(fund(&mut env, &seller, &session, &wallet_ta, amount));

    let stored = read_seller(&env, &session);
    let (_, seller_bump) = common::seller_pda(&session);
    let (seller_ta, ta_bump) = common::seller_ta_pda(&session);
    assert_eq!(stored.seller, seller.pubkey());
    assert_eq!(stored.free_cash, twice);
    assert_eq!(stored.bump, seller_bump);
    assert_eq!(stored.ta_bump, ta_bump);
    assert_eq!(common::token_balance(&env, &seller_ta), twice);
    assert_eq!(common::token_balance(&env, &wallet_ta), 0);
}

#[test]
fn seller_accounts_wrong_seller() {
    let mut env = common::env();
    let amount = five_hundred_play();
    let first = wallet(&mut env);
    let second = wallet(&mut env);
    let session = common::put_session(&mut env, 1, |_| {});
    let first_ta = common::ata_with(&mut env, &first.pubkey(), amount);
    let second_ta = common::ata_with(&mut env, &second.pubkey(), amount);

    must(fund(&mut env, &first, &session, &first_ta, amount));
    env.svm.expire_blockhash();
    common::assert_err(
        fund(&mut env, &second, &session, &second_ta, amount),
        macropaths::MacroError::WrongSeller,
    );

    let stored = read_seller(&env, &session);
    let (seller_ta, _) = common::seller_ta_pda(&session);
    assert_eq!(stored.seller, first.pubkey());
    assert_eq!(stored.free_cash, amount);
    assert_eq!(common::token_balance(&env, &seller_ta), amount);
    assert_eq!(common::token_balance(&env, &first_ta), 0);
    assert_eq!(common::token_balance(&env, &second_ta), amount);
}

#[test]
fn seller_accounts_wrong_state() {
    let mut env = common::env();
    let amount = five_hundred_play();
    let seller = wallet(&mut env);
    let session = common::put_session(&mut env, 1, |account| {
        account.state = macropaths::SessionState::Running;
    });
    let wallet_ta = common::ata_with(&mut env, &seller.pubkey(), amount);

    common::assert_err(
        fund(&mut env, &seller, &session, &wallet_ta, amount),
        macropaths::MacroError::WrongState,
    );

    assert_seller_absent(&env, &session);
    assert_eq!(common::token_balance(&env, &wallet_ta), amount);
    let got = common::read::<macropaths::Session>(&env, &session);
    assert!(got.state == macropaths::SessionState::Running);
}

#[test]
fn seller_accounts_past_deadline() {
    let mut env = common::env();
    let amount = five_hundred_play();
    let seller = wallet(&mut env);
    let session = common::put_session(&mut env, 1, |_| {});
    let wallet_ta = common::ata_with(&mut env, &seller.pubkey(), amount);
    let deadline = common::read::<macropaths::Session>(&env, &session).deposit_deadline;
    common::set_time(
        &mut env,
        deadline.checked_add(1).expect("one second past deadline"),
    );

    common::assert_err(
        fund(&mut env, &seller, &session, &wallet_ta, amount),
        macropaths::MacroError::PastDeadline,
    );

    assert_seller_absent(&env, &session);
    assert_eq!(common::token_balance(&env, &wallet_ta), amount);
}

#[test]
fn seller_accounts_at_deadline() {
    let mut env = common::env();
    let amount = five_hundred_play();
    let seller = wallet(&mut env);
    let session = common::put_session(&mut env, 1, |_| {});
    let wallet_ta = common::ata_with(&mut env, &seller.pubkey(), amount);
    let deadline = common::read::<macropaths::Session>(&env, &session).deposit_deadline;
    common::set_time(&mut env, deadline);

    must(fund(&mut env, &seller, &session, &wallet_ta, amount));

    assert_eq!(read_seller(&env, &session).free_cash, amount);
    let (seller_ta, _) = common::seller_ta_pda(&session);
    assert_eq!(common::token_balance(&env, &seller_ta), amount);
}

#[test]
fn seller_accounts_zero_amount() {
    let mut env = common::env();
    let amount = five_hundred_play();
    let seller = wallet(&mut env);
    let session = common::put_session(&mut env, 1, |_| {});
    let wallet_ta = common::ata_with(&mut env, &seller.pubkey(), amount);

    common::assert_err(
        fund(&mut env, &seller, &session, &wallet_ta, 0),
        macropaths::MacroError::ZeroAmount,
    );

    assert_seller_absent(&env, &session);
    assert_eq!(common::token_balance(&env, &wallet_ta), amount);
}

#[test]
fn seller_accounts_wrong_mint() {
    let mut env = common::env();
    let amount = five_hundred_play();
    let seller = wallet(&mut env);
    let session = common::put_session(&mut env, 1, |_| {});
    let wallet_ta = ata_of_other_mint(&mut env, &seller.pubkey(), amount);

    common::assert_err(
        fund(&mut env, &seller, &session, &wallet_ta, amount),
        macropaths::MacroError::WrongMint,
    );

    assert_seller_absent(&env, &session);
    assert_eq!(common::token_balance(&env, &wallet_ta), amount);
}

#[test]
fn seller_accounts_wrong_owner() {
    let mut env = common::env();
    let amount = five_hundred_play();
    let seller = wallet(&mut env);
    let other = wallet(&mut env);
    let session = common::put_session(&mut env, 1, |_| {});
    let wallet_ta = common::ata_with(&mut env, &other.pubkey(), amount);

    common::assert_err(
        fund(&mut env, &seller, &session, &wallet_ta, amount),
        macropaths::MacroError::WrongOwner,
    );

    assert_seller_absent(&env, &session);
    assert_eq!(common::token_balance(&env, &wallet_ta), amount);
}

#[test]
fn seller_accounts_quote() {
    let mut env = common::env();
    let authority = env.authority.insecure_clone();
    let session = common::put_session(&mut env, 1, |_| {});

    must(set_quote(&mut env, &authority, &session, QUOTE_INSIDE));

    let (quote_pda, bump) = common::quote_pda(&session);
    let quote = common::read::<macropaths::EntryQuote>(&env, &quote_pda);
    assert_eq!(quote.p, QUOTE_INSIDE);
    assert!(quote.is_set);
    assert!(!quote.frozen);
    assert_eq!(quote.session, session);
    assert_eq!(quote.bump, bump);
}

#[test]
fn seller_accounts_quote_low() {
    let mut env = common::env();
    let authority = env.authority.insecure_clone();
    let session = common::put_session(&mut env, 1, |_| {});

    common::assert_err(
        set_quote(&mut env, &authority, &session, QUOTE_LOW),
        macropaths::MacroError::QuoteOutOfRange,
    );

    assert_quote_absent(&env, &session);
}

#[test]
fn seller_accounts_quote_high() {
    let mut env = common::env();
    let authority = env.authority.insecure_clone();
    let session = common::put_session(&mut env, 1, |_| {});

    common::assert_err(
        set_quote(&mut env, &authority, &session, QUOTE_HIGH),
        macropaths::MacroError::QuoteOutOfRange,
    );

    assert_quote_absent(&env, &session);
}

#[test]
fn seller_accounts_quote_overwrite() {
    let mut env = common::env();
    let authority = env.authority.insecure_clone();
    let session = common::put_session(&mut env, 1, |_| {});
    let replacement = [macropaths::QUOTE_MIN, macropaths::QUOTE_MAX];

    must(set_quote(&mut env, &authority, &session, QUOTE_INSIDE));
    env.svm.expire_blockhash();
    must(set_quote(&mut env, &authority, &session, replacement));

    let (quote_pda, bump) = common::quote_pda(&session);
    let quote = common::read::<macropaths::EntryQuote>(&env, &quote_pda);
    assert_eq!(quote.p, replacement);
    assert!(quote.is_set);
    assert!(!quote.frozen);
    assert_eq!(quote.session, session);
    assert_eq!(quote.bump, bump);
}

#[test]
fn seller_accounts_quote_non_authority() {
    let mut env = common::env();
    let stranger = wallet(&mut env);
    let session = common::put_session(&mut env, 1, |_| {});

    let failed = set_quote(&mut env, &stranger, &session, QUOTE_INSIDE)
        .expect_err("expected has_one failure");
    let code = match failed.err {
        TransactionError::InstructionError(_, InstructionError::Custom(code)) => code,
        other => panic!(
            "expected a custom program error, got {other:?}\n{}",
            failed.meta.pretty_logs()
        ),
    };
    assert_eq!(code, 2001, "{}", failed.meta.pretty_logs());
    assert_quote_absent(&env, &session);
    let got = common::read::<macropaths::Session>(&env, &session);
    assert!(got.state == macropaths::SessionState::Open);
}

#[test]
fn seller_accounts_quote_running() {
    let mut env = common::env();
    let authority = env.authority.insecure_clone();
    let session = common::put_session(&mut env, 1, |account| {
        account.state = macropaths::SessionState::Running;
    });

    common::assert_err(
        set_quote(&mut env, &authority, &session, QUOTE_INSIDE),
        macropaths::MacroError::WrongState,
    );

    assert_quote_absent(&env, &session);
}

#[test]
fn seller_accounts_quote_frozen() {
    let mut env = common::env();
    let authority = env.authority.insecure_clone();
    let session = common::put_session(&mut env, 1, |_| {});
    let quote_pda = common::put_quote(&mut env, &session, QUOTE_INSIDE, true);

    common::assert_err(
        set_quote(
            &mut env,
            &authority,
            &session,
            [macropaths::QUOTE_MIN, macropaths::QUOTE_MAX],
        ),
        macropaths::MacroError::QuoteFrozen,
    );

    let quote = common::read::<macropaths::EntryQuote>(&env, &quote_pda);
    assert_eq!(quote.p, QUOTE_INSIDE);
    assert!(quote.is_set);
    assert!(quote.frozen);
    assert_eq!(quote.bump, common::quote_pda(&session).1);
}

/// 500 PLAY in base units. `parameters.one` is 1 PLAY.
fn five_hundred_play() -> u64 {
    let one = common::vectors()["parameters"]["one"]
        .as_u64()
        .expect("parameters.one");
    500u64.checked_mul(one).expect("500 PLAY")
}

fn wallet(env: &mut common::Env) -> Keypair {
    let seller = Keypair::new();
    env.svm
        .airdrop(&seller.pubkey(), AIRDROP_LAMPORTS)
        .expect("airdrop wallet");
    seller
}

fn fund(
    env: &mut common::Env,
    seller: &Keypair,
    session: &Pubkey,
    seller_wallet_ta: &Pubkey,
    amount: u64,
) -> Result<TransactionMetadata, FailedTransactionMetadata> {
    let (seller_pda, _) = common::seller_pda(session);
    let (seller_ta, _) = common::seller_ta_pda(session);
    let ix = Instruction {
        program_id: macropaths::ID,
        accounts: macropaths::accounts::SellerFund {
            seller_wallet: seller.pubkey(),
            session: *session,
            seller: seller_pda,
            seller_ta,
            seller_wallet_ta: *seller_wallet_ta,
            play_mint: env.mint,
            token_program: anchor_spl::token::ID,
            system_program: anchor_lang::system_program::ID,
        }
        .to_account_metas(None),
        data: macropaths::instruction::SellerFund { amount }.data(),
    };
    common::send(env, ix, &[seller])
}

fn set_quote(
    env: &mut common::Env,
    authority: &Keypair,
    session: &Pubkey,
    p: [u64; 2],
) -> Result<TransactionMetadata, FailedTransactionMetadata> {
    let (quote, _) = common::quote_pda(session);
    let ix = Instruction {
        program_id: macropaths::ID,
        accounts: macropaths::accounts::SetEntryQuote {
            authority: authority.pubkey(),
            session: *session,
            quote,
            system_program: anchor_lang::system_program::ID,
        }
        .to_account_metas(None),
        data: macropaths::instruction::SetEntryQuote { p }.data(),
    };
    common::send(env, ix, &[authority])
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

fn read_seller(env: &common::Env, session: &Pubkey) -> macropaths::Seller {
    let (seller, _) = common::seller_pda(session);
    common::read(env, &seller)
}

fn assert_seller_absent(env: &common::Env, session: &Pubkey) {
    let (seller, _) = common::seller_pda(session);
    let (seller_ta, _) = common::seller_ta_pda(session);
    assert!(env.svm.get_account(&seller).is_none());
    assert!(env.svm.get_account(&seller_ta).is_none());
}

fn assert_quote_absent(env: &common::Env, session: &Pubkey) {
    let (quote, _) = common::quote_pda(session);
    assert!(env.svm.get_account(&quote).is_none());
}

fn must(result: Result<TransactionMetadata, FailedTransactionMetadata>) {
    result.unwrap_or_else(|err| panic!("{}", err.meta.pretty_logs()));
}
