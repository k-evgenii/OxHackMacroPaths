//! Attack checks for every instruction that moves tokens or changes who can act.
//! Chain numbers come from tests/vectors.json. Account setup uses the fixtures.

mod common;

use anchor_lang::prelude::{Clock, Pubkey};
use anchor_lang::{InstructionData, ToAccountMetas};
use litesvm::types::{FailedTransactionMetadata, TransactionMetadata};
use litesvm_token::{CreateAssociatedTokenAccount, CreateMint};
use solana_keypair::Keypair;
use solana_message::Instruction;
use solana_signer::Signer;
use solana_transaction::{InstructionError, TransactionError};

use macropaths::state::SessionState;

const CONSTRAINT_HAS_ONE: u32 = 2001;
const CONSTRAINT_RAW: u32 = 2003;
const CONSTRAINT_SEEDS: u32 = 2006;
const CONSTRAINT_DUPLICATE_MUTABLE: u32 = 2040;
const ACCOUNT_NOT_INITIALIZED: u32 = 3012;

const _: () = assert!(anchor_lang::error::ErrorCode::ConstraintHasOne as u32 == CONSTRAINT_HAS_ONE);
const _: () = assert!(anchor_lang::error::ErrorCode::ConstraintRaw as u32 == CONSTRAINT_RAW);
const _: () = assert!(anchor_lang::error::ErrorCode::ConstraintSeeds as u32 == CONSTRAINT_SEEDS);
const _: () = assert!(
    anchor_lang::error::ErrorCode::ConstraintDuplicateMutableAccount as u32
        == CONSTRAINT_DUPLICATE_MUTABLE
);
const _: () = {
    assert!(anchor_lang::error::ErrorCode::AccountNotInitialized as u32 == ACCOUNT_NOT_INITIALIZED);
};

/// Lamports for a signer. Not a chain value.
const AIRDROP: u64 = 1_000_000_000;

struct Pool {
    session: Pubkey,
    vault_0: Pubkey,
    vault_1: Pubkey,
}

struct Holder {
    owner: Keypair,
    owner_ta: Pubkey,
    position: Pubkey,
}

fn buyer_deposit() -> u64 {
    common::vectors()["worked_example"]["buyer_deposit"]
        .as_u64()
        .expect("worked_example.buyer_deposit")
}

fn side_totals() -> [u64; 4] {
    let v = common::vectors();
    let cooling = &v["worked_example"]["cooling"]["S"];
    let excess = &v["worked_example"]["excess"]["S"];
    [
        json_u64(cooling, 0),
        json_u64(cooling, 1),
        json_u64(excess, 0),
        json_u64(excess, 1),
    ]
}

fn n_obs() -> u32 {
    let n = common::vectors()["commitment"]["N"]
        .as_u64()
        .expect("commitment.N");
    u32::try_from(n).expect("N fits u32")
}

struct Obs {
    index: u32,
    period_id: u32,
    value: i64,
    next: [u8; 32],
}

fn first_obs() -> Obs {
    let v = common::vectors();
    let chain = v["chain"].as_array().expect("chain");
    let terminal = hex32(
        "commitment.C_N",
        v["commitment"]["C_N"].as_str().expect("C_N"),
    );
    let next = if chain.len() > 1 {
        hex32("chain.C_i", chain[1]["C_i"].as_str().expect("C_i"))
    } else {
        terminal
    };
    Obs {
        index: u32::try_from(chain[0]["i"].as_u64().expect("i")).expect("index"),
        period_id: u32::try_from(chain[0]["period_id"].as_u64().expect("period_id"))
            .expect("period_id"),
        value: chain[0]["value"].as_i64().expect("value"),
        next,
    }
}

fn pool_of(session: Pubkey) -> Pool {
    let (vault_0, _) = common::vault_pda(&session, 0);
    let (vault_1, _) = common::vault_pda(&session, 1);
    Pool {
        session,
        vault_0,
        vault_1,
    }
}

fn open_pool(env: &mut common::Env, id: u64) -> Pool {
    let session = common::put_session(env, id, |_| {});
    common::put_vaults(env, &session, [0, 0]);
    pool_of(session)
}

fn refunding_pool(env: &mut common::Env, id: u64, vaults: [u64; 2]) -> Pool {
    let session = common::put_session(env, id, |account| {
        account.state = SessionState::Refunding;
    });
    common::put_vaults(env, &session, vaults);
    pool_of(session)
}

fn holder(env: &mut common::Env, session: &Pubkey, deposited: [u64; 4], funding: u64) -> Holder {
    let owner = Keypair::new();
    env.svm
        .airdrop(&owner.pubkey(), AIRDROP)
        .expect("airdrop owner");
    let owner_ta = common::ata_with(env, &owner.pubkey(), funding);
    let position = common::put_position(env, session, &owner.pubkey(), deposited, false);
    Holder {
        owner,
        owner_ta,
        position,
    }
}

fn other_mint_ata(env: &mut common::Env, owner: &Pubkey) -> Pubkey {
    let mint = CreateMint::new(&mut env.svm, &env.payer)
        .decimals(macropaths::PLAY_DECIMALS)
        .send()
        .expect("other mint");
    CreateAssociatedTokenAccount::new(&mut env.svm, &env.payer, &mint)
        .owner(owner)
        .send()
        .expect("other mint ata")
}

fn instruction<A: ToAccountMetas, D: InstructionData>(accounts: A, data: D) -> Instruction {
    Instruction {
        program_id: macropaths::ID,
        accounts: accounts.to_account_metas(None),
        data: data.data(),
    }
}

fn custom_code(res: Result<TransactionMetadata, FailedTransactionMetadata>) -> u32 {
    let failed = res.expect_err("expected the attack to fail");
    match failed.err {
        TransactionError::InstructionError(_, InstructionError::Custom(code)) => code,
        other => panic!(
            "expected a custom program error, got {other:?}\n{}",
            failed.meta.pretty_logs()
        ),
    }
}

fn deposit_ix(
    owner: Pubkey,
    pool: &Pool,
    position: Pubkey,
    owner_ta: Pubkey,
    vault_0: Pubkey,
    vault_1: Pubkey,
    amounts: [u64; 4],
) -> Instruction {
    instruction(
        macropaths::accounts::Deposit {
            owner,
            session: pool.session,
            position,
            owner_ta,
            vault_0,
            vault_1,
            token_program: anchor_spl::token::ID,
            system_program: anchor_lang::system_program::ID,
        },
        macropaths::instruction::Deposit { amounts },
    )
}

fn claim_ix(
    owner: Pubkey,
    pool: &Pool,
    position: Pubkey,
    owner_ta: Pubkey,
    vault_0: Pubkey,
    vault_1: Pubkey,
) -> Instruction {
    instruction(
        macropaths::accounts::Claim {
            owner,
            session: pool.session,
            position,
            owner_ta,
            vault_0,
            vault_1,
            token_program: anchor_spl::token::ID,
        },
        macropaths::instruction::Claim {},
    )
}

fn account_data(env: &common::Env, key: &Pubkey) -> Vec<u8> {
    env.svm
        .get_account(key)
        .unwrap_or_else(|| panic!("missing account {key}"))
        .data
}

#[test]
fn security_deposit_vault_1_in_vault_0() {
    let mut env = common::env();
    let pool = open_pool(&mut env, 1);
    let amount = buyer_deposit();
    let owner = Keypair::new();
    env.svm
        .airdrop(&owner.pubkey(), AIRDROP)
        .expect("airdrop owner");
    let owner_ta = common::ata_with(&mut env, &owner.pubkey(), amount);
    let (position, _) = common::position_pda(&pool.session, &owner.pubkey());
    let before = account_data(&env, &pool.session);
    let code = custom_code(common::send(
        &mut env,
        deposit_ix(
            owner.pubkey(),
            &pool,
            position,
            owner_ta,
            pool.vault_1,
            pool.vault_0,
            [amount, 0, 0, 0],
        ),
        &[&owner],
    ));
    assert_eq!(code, CONSTRAINT_RAW);
    assert_eq!(account_data(&env, &pool.session), before);
    assert_eq!(common::token_balance(&env, &owner_ta), amount);
    assert!(env.svm.get_account(&position).is_none());
}

#[test]
fn security_claim_vault_1_in_vault_0() {
    let amount = buyer_deposit();
    let mut env = common::env();
    let pool = refunding_pool(&mut env, 2, [amount, 0]);
    let who = holder(&mut env, &pool.session, [amount, 0, 0, 0], 0);
    let before = account_data(&env, &pool.session);
    let code = custom_code(common::send(
        &mut env,
        claim_ix(
            who.owner.pubkey(),
            &pool,
            who.position,
            who.owner_ta,
            pool.vault_1,
            pool.vault_0,
        ),
        &[&who.owner],
    ));
    assert_eq!(code, CONSTRAINT_RAW);
    assert_eq!(account_data(&env, &pool.session), before);
    assert_eq!(common::token_balance(&env, &who.owner_ta), 0);
    assert_eq!(common::token_balance(&env, &pool.vault_0), amount);
    let position: macropaths::Position = common::read(&env, &who.position);
    assert!(!position.claimed);
}

#[test]
fn security_claim_other_session_position() {
    let amount = buyer_deposit();
    let mut env = common::env();
    let pool = refunding_pool(&mut env, 3, [amount, 0]);
    let other = common::put_session(&mut env, 4, |_| {});
    let who = holder(&mut env, &other, [amount, 0, 0, 0], 0);
    let before = account_data(&env, &pool.session);
    let code = custom_code(common::send(
        &mut env,
        claim_ix(
            who.owner.pubkey(),
            &pool,
            who.position,
            who.owner_ta,
            pool.vault_0,
            pool.vault_1,
        ),
        &[&who.owner],
    ));
    assert_eq!(code, CONSTRAINT_SEEDS);
    assert_eq!(account_data(&env, &pool.session), before);
    assert_eq!(common::token_balance(&env, &pool.vault_0), amount);
    let position: macropaths::Position = common::read(&env, &who.position);
    assert!(!position.claimed);
}

#[test]
fn security_claim_foreign_token_account() {
    let amount = buyer_deposit();
    let mut env = common::env();
    let pool = refunding_pool(&mut env, 5, [amount, 0]);
    let who = holder(&mut env, &pool.session, [amount, 0, 0, 0], 0);
    let stranger = Keypair::new();
    env.svm
        .airdrop(&stranger.pubkey(), AIRDROP)
        .expect("airdrop stranger");
    let foreign_ta = common::ata_with(&mut env, &stranger.pubkey(), 0);
    common::assert_err(
        common::send(
            &mut env,
            claim_ix(
                who.owner.pubkey(),
                &pool,
                who.position,
                foreign_ta,
                pool.vault_0,
                pool.vault_1,
            ),
            &[&who.owner],
        ),
        macropaths::MacroError::WrongOwner,
    );
    assert_eq!(common::token_balance(&env, &foreign_ta), 0);
    assert_eq!(common::token_balance(&env, &pool.vault_0), amount);
    let position: macropaths::Position = common::read(&env, &who.position);
    assert!(!position.claimed);
}

#[test]
fn security_deposit_wrong_mint() {
    let amount = buyer_deposit();
    let mut env = common::env();
    let pool = open_pool(&mut env, 6);
    let owner = Keypair::new();
    env.svm
        .airdrop(&owner.pubkey(), AIRDROP)
        .expect("airdrop owner");
    let owner_ta = other_mint_ata(&mut env, &owner.pubkey());
    let (position, _) = common::position_pda(&pool.session, &owner.pubkey());
    let before = account_data(&env, &pool.session);
    common::assert_err(
        common::send(
            &mut env,
            deposit_ix(
                owner.pubkey(),
                &pool,
                position,
                owner_ta,
                pool.vault_0,
                pool.vault_1,
                [amount, 0, 0, 0],
            ),
            &[&owner],
        ),
        macropaths::MacroError::WrongMint,
    );
    assert_eq!(account_data(&env, &pool.session), before);
    assert!(env.svm.get_account(&position).is_none());
}

#[test]
fn security_deposit_past_deadline() {
    let amount = buyer_deposit();
    let mut env = common::env();
    let pool = open_pool(&mut env, 7);
    let owner = Keypair::new();
    env.svm
        .airdrop(&owner.pubkey(), AIRDROP)
        .expect("airdrop owner");
    let owner_ta = common::ata_with(&mut env, &owner.pubkey(), amount);
    let (position, _) = common::position_pda(&pool.session, &owner.pubkey());
    let deadline = common::read::<macropaths::Session>(&env, &pool.session).deposit_deadline;
    common::set_time(
        &mut env,
        deadline.checked_add(1).expect("one second past deadline"),
    );
    let before = account_data(&env, &pool.session);
    common::assert_err(
        common::send(
            &mut env,
            deposit_ix(
                owner.pubkey(),
                &pool,
                position,
                owner_ta,
                pool.vault_0,
                pool.vault_1,
                [amount, 0, 0, 0],
            ),
            &[&owner],
        ),
        macropaths::MacroError::PastDeadline,
    );
    assert_eq!(account_data(&env, &pool.session), before);
    assert_eq!(common::token_balance(&env, &owner_ta), amount);
    assert!(env.svm.get_account(&position).is_none());
}

#[test]
fn security_deposit_owner_ta_is_vault() {
    let amount = buyer_deposit();
    let mut env = common::env();
    let pool = open_pool(&mut env, 8);
    let owner = Keypair::new();
    env.svm
        .airdrop(&owner.pubkey(), AIRDROP)
        .expect("airdrop owner");
    let (position, _) = common::position_pda(&pool.session, &owner.pubkey());
    let before_vault = common::token_balance(&env, &pool.vault_0);
    let code = custom_code(common::send(
        &mut env,
        deposit_ix(
            owner.pubkey(),
            &pool,
            position,
            pool.vault_0,
            pool.vault_0,
            pool.vault_1,
            [amount, 0, 0, 0],
        ),
        &[&owner],
    ));
    assert_eq!(code, CONSTRAINT_DUPLICATE_MUTABLE);
    assert_eq!(common::token_balance(&env, &pool.vault_0), before_vault);
    assert!(env.svm.get_account(&position).is_none());
}

#[test]
fn security_observe_valid_hash_while_open() {
    let row = first_obs();
    let mut env = common::env();
    let open = common::put_session(&mut env, 9, |_| {});
    let before = account_data(&env, &open);
    let ix = instruction(
        macropaths::accounts::Observe { session: open },
        macropaths::instruction::Observe {
            index: row.index,
            period_id: row.period_id,
            value: row.value,
            next_commitment: row.next,
        },
    );
    common::assert_err(
        common::send(&mut env, ix, &[]),
        macropaths::MacroError::WrongState,
    );
    assert_eq!(account_data(&env, &open), before);

    let running = common::put_session(&mut env, 10, |account| {
        account.state = SessionState::Running;
    });
    let ix = instruction(
        macropaths::accounts::Observe { session: running },
        macropaths::instruction::Observe {
            index: row.index,
            period_id: row.period_id,
            value: row.value,
            next_commitment: row.next,
        },
    );
    common::send(&mut env, ix, &[]).unwrap_or_else(|err| panic!("{}", err.meta.pretty_logs()));
    let got = common::read::<macropaths::Session>(&env, &running);
    assert!(got.state == SessionState::Running);
    assert_eq!(got.commitment, row.next);
    assert_eq!(
        got.next_index,
        row.index.checked_add(1).expect("next index")
    );
}

#[test]
fn security_lock_non_authority() {
    let mut env = common::env();
    let session = common::put_session(&mut env, 11, |account| {
        account.side_totals = side_totals();
    });
    let stranger = Keypair::new();
    env.svm
        .airdrop(&stranger.pubkey(), AIRDROP)
        .expect("airdrop stranger");
    let before = account_data(&env, &session);
    let code = custom_code(common::send(
        &mut env,
        instruction(
            macropaths::accounts::LockAndStart {
                authority: stranger.pubkey(),
                session,
            },
            macropaths::instruction::LockAndStart {},
        ),
        &[&stranger],
    ));
    assert_eq!(code, CONSTRAINT_HAS_ONE);
    assert_eq!(account_data(&env, &session), before);
}

#[test]
fn security_sweep_non_authority() {
    let mut env = common::env();
    let session = common::put_session(&mut env, 12, |account| {
        account.state = SessionState::Settled;
        account.position_count = 0;
        account.claimed_count = 0;
    });
    common::put_vaults(&mut env, &session, [0, 0]);
    let pool = pool_of(session);
    let stranger = Keypair::new();
    env.svm
        .airdrop(&stranger.pubkey(), AIRDROP)
        .expect("airdrop stranger");
    let treasury_ta = common::ata_with(&mut env, &stranger.pubkey(), 0);
    let before = account_data(&env, &pool.session);
    let code = custom_code(common::send(
        &mut env,
        sweep_ix(&pool, stranger.pubkey(), treasury_ta),
        &[&stranger],
    ));
    assert_eq!(code, CONSTRAINT_HAS_ONE);
    assert_eq!(account_data(&env, &pool.session), before);
    assert_eq!(common::token_balance(&env, &treasury_ta), 0);
}

#[test]
fn security_sweep_before_all_claimed() {
    let amount = buyer_deposit();
    let mut env = common::env();
    let authority = env.authority.insecure_clone();
    let session = common::put_session(&mut env, 13, |account| {
        account.state = SessionState::Settled;
        account.position_count = 1;
        account.claimed_count = 0;
    });
    common::put_vaults(&mut env, &session, [amount, 0]);
    let pool = pool_of(session);
    let treasury_ta = common::ata_with(&mut env, &authority.pubkey(), 0);
    let before = account_data(&env, &pool.session);
    common::assert_err(
        common::send(
            &mut env,
            sweep_ix(&pool, authority.pubkey(), treasury_ta),
            &[&authority],
        ),
        macropaths::MacroError::NotAllClaimed,
    );
    assert_eq!(account_data(&env, &pool.session), before);
    assert_eq!(common::token_balance(&env, &pool.vault_0), amount);
    assert_eq!(common::token_balance(&env, &treasury_ta), 0);
}

#[test]
fn security_settle_complete_index_wrong_terminal() {
    let mut env = common::env();
    let n = n_obs();
    let session = common::put_session(&mut env, 14, |account| {
        account.state = SessionState::Running;
        account.next_index = n;
    });
    let stored = common::read::<macropaths::Session>(&env, &session);
    assert_ne!(stored.commitment, stored.terminal);
    assert_eq!(stored.next_index, stored.n_obs);
    let before = account_data(&env, &session);
    common::assert_err(
        common::send(
            &mut env,
            instruction(
                macropaths::accounts::Settle { session },
                macropaths::instruction::Settle {},
            ),
            &[],
        ),
        macropaths::MacroError::ChainIncomplete,
    );
    assert_eq!(account_data(&env, &session), before);
}

#[test]
fn security_create_session_same_id_after_expire_blockhash() {
    let mut env = common::env();
    let authority = env.authority.insecure_clone();
    let ix = create_ix(&env, 15);
    common::send(&mut env, ix.clone(), &[&authority])
        .unwrap_or_else(|err| panic!("{}", err.meta.pretty_logs()));
    let (session, _) = common::session_pda(&authority.pubkey(), 15);
    let before = account_data(&env, &session);
    env.svm.expire_blockhash();
    let failed = common::send(&mut env, ix, &[&authority]).expect_err("second create must fail");
    assert!(
        !matches!(failed.err, TransactionError::AlreadyProcessed),
        "second send was treated as a duplicate transaction: {:?}",
        failed.err
    );
    assert!(
        failed
            .meta
            .logs
            .iter()
            .any(|line| line.contains("already in use")),
        "expected the session account to already exist, got {:?}\n{}",
        failed.err,
        failed.meta.pretty_logs()
    );
    assert_eq!(account_data(&env, &session), before);
}

#[test]
fn security_claim_twice_after_expire_blockhash() {
    let amount = buyer_deposit();
    let mut env = common::env();
    let pool = refunding_pool(&mut env, 16, [amount, 0]);
    let who = holder(&mut env, &pool.session, [amount, 0, 0, 0], 0);
    let ix = claim_ix(
        who.owner.pubkey(),
        &pool,
        who.position,
        who.owner_ta,
        pool.vault_0,
        pool.vault_1,
    );
    common::send(&mut env, ix.clone(), &[&who.owner])
        .unwrap_or_else(|err| panic!("{}", err.meta.pretty_logs()));
    assert_eq!(common::token_balance(&env, &who.owner_ta), amount);
    assert_eq!(common::token_balance(&env, &pool.vault_0), 0);
    env.svm.expire_blockhash();
    let failed = common::send(&mut env, ix, &[&who.owner]).expect_err("second claim must fail");
    assert!(
        !matches!(failed.err, TransactionError::AlreadyProcessed),
        "second send was treated as a duplicate transaction: {:?}",
        failed.err
    );
    let code = match failed.err {
        TransactionError::InstructionError(_, InstructionError::Custom(code)) => code,
        other => panic!(
            "expected a custom program error, got {other:?}\n{}",
            failed.meta.pretty_logs()
        ),
    };
    assert_eq!(
        code,
        u32::from(macropaths::MacroError::AlreadyClaimed),
        "{}",
        failed.meta.pretty_logs()
    );
    assert_eq!(common::token_balance(&env, &who.owner_ta), amount);
    assert_eq!(common::token_balance(&env, &pool.vault_0), 0);
}

#[test]
fn security_claim_owner_ta_is_vault() {
    let amount = buyer_deposit();
    let mut env = common::env();
    let pool = refunding_pool(&mut env, 17, [amount, 0]);
    let who = holder(&mut env, &pool.session, [amount, 0, 0, 0], 0);
    let code = custom_code(common::send(
        &mut env,
        claim_ix(
            who.owner.pubkey(),
            &pool,
            who.position,
            pool.vault_0,
            pool.vault_0,
            pool.vault_1,
        ),
        &[&who.owner],
    ));
    assert_eq!(code, CONSTRAINT_DUPLICATE_MUTABLE);
    assert_eq!(common::token_balance(&env, &pool.vault_0), amount);
    let position: macropaths::Position = common::read(&env, &who.position);
    assert!(!position.claimed);
}

#[test]
fn security_seller_fund_wrong_mint() {
    let mut env = common::env();
    let session = common::put_session(&mut env, 18, |_| {});
    let seller = Keypair::new();
    env.svm
        .airdrop(&seller.pubkey(), AIRDROP)
        .expect("airdrop seller");
    let other = CreateMint::new(&mut env.svm, &env.payer)
        .decimals(macropaths::PLAY_DECIMALS)
        .send()
        .expect("other mint");
    let seller_wallet_ta = CreateAssociatedTokenAccount::new(&mut env.svm, &env.payer, &other)
        .owner(&seller.pubkey())
        .send()
        .expect("seller wallet ta");
    let (seller_pda, _) = common::seller_pda(&session);
    let (seller_ta, _) = common::seller_ta_pda(&session);
    let ix = instruction(
        macropaths::accounts::SellerFund {
            seller_wallet: seller.pubkey(),
            session,
            seller: seller_pda,
            seller_ta,
            seller_wallet_ta,
            play_mint: other,
            token_program: anchor_spl::token::ID,
            system_program: anchor_lang::system_program::ID,
        },
        macropaths::instruction::SellerFund {
            amount: buyer_deposit(),
        },
    );
    common::assert_err(
        common::send(&mut env, ix, &[&seller]),
        macropaths::MacroError::WrongMint,
    );
    assert!(
        env.svm.get_account(&seller_ta).is_none(),
        "seller token account was created for the wrong mint"
    );
    assert!(env.svm.get_account(&seller_pda).is_none());
}

fn sweep_ix(pool: &Pool, authority: Pubkey, treasury_ta: Pubkey) -> Instruction {
    instruction(
        macropaths::accounts::SweepDust {
            authority,
            session: pool.session,
            treasury_ta,
            vault_0: pool.vault_0,
            vault_1: pool.vault_1,
            token_program: anchor_spl::token::ID,
        },
        macropaths::instruction::SweepDust {},
    )
}

fn create_ix(env: &common::Env, session_id: u64) -> Instruction {
    let v = common::vectors();
    let commitment = &v["commitment"];
    let now = env.svm.get_sysvar::<Clock>().unix_timestamp;
    let authority = env.authority.pubkey();
    let (session, _) = common::session_pda(&authority, session_id);
    let (vault_0, _) = common::vault_pda(&session, 0);
    let (vault_1, _) = common::vault_pda(&session, 1);
    instruction(
        macropaths::accounts::CreateSession {
            authority,
            session,
            play_mint: env.mint,
            vault_0,
            vault_1,
            token_program: anchor_spl::token::ID,
            system_program: anchor_lang::system_program::ID,
            rent: anchor_lang::solana_program::rent::ID,
        },
        macropaths::instruction::CreateSession {
            session_id,
            k: json_i64(&v["parameters"], "K"),
            d_cap: json_i64(&v["parameters"], "Dcap"),
            a_cap: json_i64(&v["parameters"], "Acap"),
            deposit_deadline: now.checked_add(1).expect("deposit deadline"),
            replay_deadline: now.checked_add(2).expect("replay deadline"),
            dataset_id: hex32(
                "commitment.dataset_id",
                commitment["dataset_id"].as_str().expect("dataset_id"),
            ),
            c0: hex32("commitment.C_0", commitment["C_0"].as_str().expect("C_0")),
            terminal: hex32("commitment.C_N", commitment["C_N"].as_str().expect("C_N")),
        },
    )
}

fn json_u64(value: &serde_json::Value, index: usize) -> u64 {
    value[index].as_u64().expect("u64")
}

fn json_i64(obj: &serde_json::Value, key: &str) -> i64 {
    obj[key].as_i64().unwrap_or_else(|| panic!("{key}"))
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
