//! Shared LiteSVM harness. Instructions are built with
//! `accounts.to_account_metas(None)` and `instruction.data()`.
#![allow(dead_code)]

use std::result::Result;

use anchor_lang::prelude::{AccountDeserialize, Clock, Pubkey};
use anchor_lang::solana_program::program_option::COption;
use anchor_lang::solana_program::program_pack::Pack;
use anchor_lang::{AccountSerialize, InstructionData, ToAccountMetas};
use litesvm::types::{FailedTransactionMetadata, TransactionMetadata};
use litesvm::LiteSVM;
use litesvm_token::spl_token::state::{Account as SplAccount, AccountState};
use litesvm_token::{CreateAssociatedTokenAccount, CreateMint, MintTo};
use solana_keypair::Keypair;
use solana_message::{Instruction, Message};
use solana_signer::Signer;
use solana_transaction::{InstructionError, Transaction, TransactionError};

use macropaths::error::MacroError;

const SO: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../target/deploy/macropaths.so"
);
const VECTORS: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/../../tests/vectors.json");

/// Lamports for the fee payer and authority. Not a chain value.
const AIRDROP_LAMPORTS: u64 = 1_000_000_000;

pub struct Env {
    pub svm: LiteSVM,
    pub payer: Keypair,
    pub mint: Pubkey,
    pub authority: Keypair,
}

pub fn env() -> Env {
    let mut svm = LiteSVM::new();
    svm.add_program_from_file(macropaths::ID, SO)
        .expect("target/deploy/macropaths.so missing: run `anchor build` first");

    let payer = Keypair::new();
    let authority = Keypair::new();
    svm.airdrop(&payer.pubkey(), AIRDROP_LAMPORTS)
        .expect("airdrop payer");
    svm.airdrop(&authority.pubkey(), AIRDROP_LAMPORTS)
        .expect("airdrop authority");

    let mint = CreateMint::new(&mut svm, &payer)
        .decimals(macropaths::PLAY_DECIMALS)
        .send()
        .expect("create PLAY mint");

    Env {
        svm,
        payer,
        mint,
        authority,
    }
}

pub fn ata_with(env: &mut Env, owner: &Pubkey, amount: u64) -> Pubkey {
    let ata = CreateAssociatedTokenAccount::new(&mut env.svm, &env.payer, &env.mint)
        .owner(owner)
        .send()
        .expect("create ata");
    if amount > 0 {
        MintTo::new(&mut env.svm, &env.payer, &env.mint, &ata, amount)
            .send()
            .expect("mint PLAY");
    }
    ata
}

pub fn session_pda(authority: &Pubkey, id: u64) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[
            macropaths::SEED_SESSION,
            authority.as_ref(),
            &id.to_le_bytes(),
        ],
        &macropaths::ID,
    )
}

pub fn vault_pda(session: &Pubkey, i: u8) -> (Pubkey, u8) {
    let index = [i];
    Pubkey::find_program_address(
        &[macropaths::SEED_VAULT, session.as_ref(), &index],
        &macropaths::ID,
    )
}

pub fn position_pda(session: &Pubkey, owner: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[macropaths::SEED_POSITION, session.as_ref(), owner.as_ref()],
        &macropaths::ID,
    )
}

pub fn seller_pda(session: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[macropaths::SEED_SELLER, session.as_ref()],
        &macropaths::ID,
    )
}

pub fn seller_ta_pda(session: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[macropaths::SEED_SELLER_TA, session.as_ref()],
        &macropaths::ID,
    )
}

pub fn quote_pda(session: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[macropaths::SEED_QUOTE, session.as_ref()], &macropaths::ID)
}

pub fn cover_pda(session: &Pubkey, owner: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[macropaths::SEED_COVER, session.as_ref(), owner.as_ref()],
        &macropaths::ID,
    )
}

pub fn send(
    env: &mut Env,
    ix: Instruction,
    signers: &[&Keypair],
) -> Result<TransactionMetadata, FailedTransactionMetadata> {
    let payer_pk = env.payer.pubkey();
    let mut keys: Vec<&Keypair> = Vec::with_capacity(signers.len() + 1);
    keys.push(&env.payer);
    for signer in signers {
        if signer.pubkey() != payer_pk {
            keys.push(signer);
        }
    }
    let msg = Message::new(&[ix], Some(&payer_pk));
    let tx = Transaction::new(&keys, msg, env.svm.latest_blockhash());
    env.svm.send_transaction(tx)
}

pub fn read<T: AccountDeserialize>(env: &Env, key: &Pubkey) -> T {
    let account = env
        .svm
        .get_account(key)
        .unwrap_or_else(|| panic!("missing account {key}"));
    let mut data: &[u8] = &account.data;
    T::try_deserialize(&mut data).unwrap_or_else(|err| panic!("deserialize {key}: {err}"))
}

pub fn token_balance(env: &Env, ta: &Pubkey) -> u64 {
    let account = env
        .svm
        .get_account(ta)
        .unwrap_or_else(|| panic!("missing token account {ta}"));
    let bytes: [u8; 8] = account.data[64..72]
        .try_into()
        .expect("token account amount");
    u64::from_le_bytes(bytes)
}

pub fn set_time(env: &mut Env, unix: i64) {
    let mut clock = env.svm.get_sysvar::<Clock>();
    clock.unix_timestamp = unix;
    env.svm.set_sysvar(&clock);
}

pub fn assert_err(
    res: Result<TransactionMetadata, FailedTransactionMetadata>,
    expected: MacroError,
) {
    let failed = res.expect_err("expected transaction to fail");
    let code = match failed.err {
        TransactionError::InstructionError(_, InstructionError::Custom(code)) => code,
        other => panic!(
            "expected a custom program error, got {other:?}\n{}",
            failed.meta.pretty_logs()
        ),
    };
    assert_eq!(code, u32::from(expected), "{}", failed.meta.pretty_logs());
}

pub fn vectors() -> serde_json::Value {
    let text = std::fs::read_to_string(VECTORS).expect("read tests/vectors.json");
    serde_json::from_str(&text).expect("parse tests/vectors.json")
}

pub fn create_session_default(env: &mut Env, id: u64) -> Pubkey {
    let authority = env.authority.insecure_clone();
    let authority_pk = authority.pubkey();
    let (session, _) = session_pda(&authority_pk, id);
    let (vault_0, _) = vault_pda(&session, 0);
    let (vault_1, _) = vault_pda(&session, 1);
    let head = chain_head();
    let now = env.svm.get_sysvar::<Clock>().unix_timestamp;
    let deposit_deadline = now.checked_add(3_600).expect("deposit deadline");
    let replay_deadline = now.checked_add(7_200).expect("replay deadline");
    let mint = env.mint;
    let ix = instruction(
        macropaths::accounts::CreateSession {
            authority: authority_pk,
            session,
            play_mint: mint,
            vault_0,
            vault_1,
            token_program: anchor_spl::token::ID,
            system_program: anchor_lang::system_program::ID,
            rent: anchor_lang::solana_program::rent::ID,
        },
        macropaths::instruction::CreateSession {
            session_id: id,
            k: head.k,
            d_cap: head.d_cap,
            a_cap: head.a_cap,
            deposit_deadline,
            replay_deadline,
            dataset_id: head.dataset_id,
            c0: head.c0,
            terminal: head.terminal,
        },
    );
    send(env, ix, &[&authority]).unwrap_or_else(|err| panic!("{}", err.meta.pretty_logs()));
    session
}

pub fn seed_sides(env: &mut Env, session: &Pubkey, amounts: [u64; 4]) -> Keypair {
    let seeder = Keypair::new();
    env.svm
        .airdrop(&seeder.pubkey(), AIRDROP_LAMPORTS)
        .expect("airdrop seeder");
    let total = amounts
        .iter()
        .try_fold(0u64, |acc, amount| acc.checked_add(*amount))
        .expect("side amounts overflow");
    let owner_ta = ata_with(env, &seeder.pubkey(), total);
    let (position, _) = position_pda(session, &seeder.pubkey());
    let (vault_0, _) = vault_pda(session, 0);
    let (vault_1, _) = vault_pda(session, 1);
    let owner = seeder.pubkey();
    let ix = instruction(
        macropaths::accounts::Deposit {
            owner,
            session: *session,
            position,
            owner_ta,
            vault_0,
            vault_1,
            token_program: anchor_spl::token::ID,
            system_program: anchor_lang::system_program::ID,
        },
        macropaths::instruction::Deposit { amounts },
    );
    send(env, ix, &[&seeder]).unwrap_or_else(|err| panic!("{}", err.meta.pretty_logs()));
    seeder
}

pub fn observe_all(env: &mut Env, session: &Pubkey, rows: &[(u32, u32, i64, [u8; 32])]) {
    for (index, period_id, value, next_commitment) in rows {
        let ix = instruction(
            macropaths::accounts::Observe { session: *session },
            macropaths::instruction::Observe {
                index: *index,
                period_id: *period_id,
                value: *value,
                next_commitment: *next_commitment,
            },
        );
        send(env, ix, &[]).unwrap_or_else(|err| panic!("{}", err.meta.pretty_logs()));
    }
}

/// Writes a Session at `session_pda(authority, id)`.
///
/// Defaults match `create_session_default`. `apply` runs after those defaults
/// and may replace any field.
pub fn put_session(env: &mut Env, id: u64, apply: impl FnOnce(&mut macropaths::Session)) -> Pubkey {
    let authority = env.authority.pubkey();
    let (session, bump) = session_pda(&authority, id);
    let (vault_0, vault_bump_0) = vault_pda(&session, 0);
    let (vault_1, vault_bump_1) = vault_pda(&session, 1);
    let head = chain_head();
    let now = env.svm.get_sysvar::<Clock>().unix_timestamp;
    let mut account = macropaths::Session {
        authority,
        session_id: id,
        play_mint: env.mint,
        vaults: [vault_0, vault_1],
        dataset_id: head.dataset_id,
        commitment: head.c0,
        terminal: head.terminal,
        n_obs: macropaths::N_OBS,
        next_index: 0,
        last_period_id: 0,
        state: macropaths::SessionState::Open,
        k: head.k,
        d_cap: head.d_cap,
        a_cap: head.a_cap,
        deposit_deadline: now.checked_add(3_600).expect("deposit deadline"),
        replay_deadline: now.checked_add(7_200).expect("replay deadline"),
        side_totals: [0; 4],
        matched: [0; 2],
        peak: i64::MIN,
        max_decline: 0,
        excess_acc: 0,
        values: [0; 48],
        scores: [0; 2],
        p_budget: [0; 4],
        r_budget: [0; 4],
        position_count: 0,
        claimed_count: 0,
        cover_count: 0,
        cover_claimed_count: 0,
        seller_products_open: 0,
        bump,
        vault_bumps: [vault_bump_0, vault_bump_1],
        _reserved: [0; 64],
    };
    apply(&mut account);
    install_program_account(env, &session, &account);
    session
}

/// Writes the two vault token accounts for `session` and mints `amounts` into them.
pub fn put_vaults(env: &mut Env, session: &Pubkey, amounts: [u64; 2]) {
    for (index, amount) in amounts.into_iter().enumerate() {
        let (vault, _) = vault_pda(session, u8::try_from(index).expect("vault index"));
        let token = SplAccount {
            mint: env.mint,
            owner: *session,
            amount: 0,
            delegate: COption::None,
            state: AccountState::Initialized,
            is_native: COption::None,
            delegated_amount: 0,
            close_authority: COption::None,
        };
        let mut data = vec![0u8; SplAccount::LEN];
        SplAccount::pack(token, &mut data).expect("pack vault");
        install_account(env, &vault, data, anchor_spl::token::ID);
        if amount > 0 {
            MintTo::new(&mut env.svm, &env.payer, &env.mint, &vault, amount)
                .send()
                .unwrap_or_else(|err| panic!("mint vault {index}: {}", err.meta.pretty_logs()));
        }
    }
}

/// Writes a Position at `position_pda(session, owner)`.
pub fn put_position(
    env: &mut Env,
    session: &Pubkey,
    owner: &Pubkey,
    deposited: [u64; 4],
    claimed: bool,
) -> Pubkey {
    let (position, bump) = position_pda(session, owner);
    let account = macropaths::Position {
        session: *session,
        owner: *owner,
        deposited,
        claimed,
        bump,
    };
    install_program_account(env, &position, &account);
    position
}

/// Writes a Seller at `seller_pda(session)` and the SPL token account at `seller_ta_pda(session)`.
///
/// `free_cash`, `escrow`, `n_sold`, `premium` and `settled` start at zero. `bump` and `ta_bump`
/// are the canonical `find_program_address` bumps. `apply` runs after those defaults. The token
/// account uses the PLAY mint, owner `session`, and amount `free_cash` after `apply`, minted so
/// supply matches.
pub fn put_seller(
    env: &mut Env,
    session: &Pubkey,
    seller_wallet: &Pubkey,
    apply: impl FnOnce(&mut macropaths::Seller),
) -> Pubkey {
    let (seller, bump) = seller_pda(session);
    let (seller_ta, ta_bump) = seller_ta_pda(session);
    let mut account = macropaths::Seller {
        session: *session,
        seller: *seller_wallet,
        free_cash: 0,
        escrow: [0; 2],
        n_sold: [0; 2],
        premium: [0; 2],
        settled: [false; 2],
        bump,
        ta_bump,
    };
    apply(&mut account);
    install_program_account(env, &seller, &account);
    let token = SplAccount {
        mint: env.mint,
        owner: *session,
        amount: 0,
        delegate: COption::None,
        state: AccountState::Initialized,
        is_native: COption::None,
        delegated_amount: 0,
        close_authority: COption::None,
    };
    let mut data = vec![0u8; SplAccount::LEN];
    SplAccount::pack(token, &mut data).expect("pack seller token account");
    install_account(env, &seller_ta, data, anchor_spl::token::ID);
    if account.free_cash > 0 {
        MintTo::new(
            &mut env.svm,
            &env.payer,
            &env.mint,
            &seller_ta,
            account.free_cash,
        )
        .send()
        .unwrap_or_else(|err| panic!("mint seller token account: {}", err.meta.pretty_logs()));
    }
    seller
}

/// Writes an EntryQuote at `quote_pda(session)` with `is_set` and the canonical bump.
pub fn put_quote(env: &mut Env, session: &Pubkey, p: [u64; 2], frozen: bool) -> Pubkey {
    let (quote, bump) = quote_pda(session);
    let account = macropaths::EntryQuote {
        session: *session,
        p,
        is_set: true,
        frozen,
        bump,
    };
    install_program_account(env, &quote, &account);
    quote
}

/// Writes a Cover at `cover_pda(session, owner)`.
pub fn put_cover(
    env: &mut Env,
    session: &Pubkey,
    owner: &Pubkey,
    units: [u64; 2],
    premium_paid: [u64; 2],
    claimed: bool,
) -> Pubkey {
    let (cover, bump) = cover_pda(session, owner);
    let account = macropaths::Cover {
        session: *session,
        owner: *owner,
        units,
        premium_paid,
        claimed,
        bump,
    };
    install_program_account(env, &cover, &account);
    cover
}

fn instruction<A: ToAccountMetas, D: InstructionData>(accounts: A, data: D) -> Instruction {
    Instruction {
        program_id: macropaths::ID,
        accounts: accounts.to_account_metas(None),
        data: data.data(),
    }
}

struct ChainHead {
    dataset_id: [u8; 32],
    c0: [u8; 32],
    terminal: [u8; 32],
    k: i64,
    d_cap: i64,
    a_cap: i64,
}

fn chain_head() -> ChainHead {
    let v = vectors();
    let commitment = &v["commitment"];
    assert!(
        commitment.is_object(),
        "vectors.json commitment block is missing (dataset_id, C_0, C_N)"
    );
    ChainHead {
        dataset_id: hex32(
            "commitment.dataset_id",
            commitment["dataset_id"].as_str().expect("dataset_id"),
        ),
        c0: hex32("commitment.C_0", commitment["C_0"].as_str().expect("C_0")),
        terminal: hex32("commitment.C_N", commitment["C_N"].as_str().expect("C_N")),
        k: json_i64(&v["parameters"], "K"),
        d_cap: json_i64(&v["parameters"], "Dcap"),
        a_cap: json_i64(&v["parameters"], "Acap"),
    }
}

fn install_program_account<T: AccountSerialize>(env: &mut Env, key: &Pubkey, account: &T) {
    let mut data = Vec::new();
    account
        .try_serialize(&mut data)
        .expect("serialize program account");
    install_account(env, key, data, macropaths::ID);
}

fn install_account(env: &mut Env, key: &Pubkey, data: Vec<u8>, owner: Pubkey) {
    let lamports = env.svm.minimum_balance_for_rent_exemption(data.len());
    let mut stored = env
        .svm
        .get_account(&env.payer.pubkey())
        .expect("payer account");
    stored.lamports = lamports;
    stored.data = data;
    stored.owner = owner;
    stored.executable = false;
    stored.rent_epoch = 0;
    env.svm
        .set_account(*key, stored)
        .unwrap_or_else(|err| panic!("set account {key}: {err}"));
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
