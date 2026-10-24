//! Shared LiteSVM harness. Instructions are built with
//! `accounts.to_account_metas(None)` and `instruction.data()`.
#![allow(dead_code)]

use std::result::Result;

use anchor_lang::prelude::{AccountDeserialize, Clock, Pubkey};
use anchor_lang::{InstructionData, ToAccountMetas};
use litesvm::types::{FailedTransactionMetadata, TransactionMetadata};
use litesvm::LiteSVM;
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
    let v = vectors();
    let commitment = &v["commitment"];
    assert!(
        commitment.is_object(),
        "vectors.json commitment block is missing (dataset_id, C_0, C_N)"
    );
    let dataset_id = hex32(
        "commitment.dataset_id",
        commitment["dataset_id"].as_str().expect("dataset_id"),
    );
    let c0 = hex32("commitment.C_0", commitment["C_0"].as_str().expect("C_0"));
    let terminal = hex32("commitment.C_N", commitment["C_N"].as_str().expect("C_N"));
    let k = json_i64(&v["parameters"], "K");
    let d_cap = json_i64(&v["parameters"], "Dcap");
    let a_cap = json_i64(&v["parameters"], "Acap");
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
            k,
            d_cap,
            a_cap,
            deposit_deadline,
            replay_deadline,
            dataset_id,
            c0,
            terminal,
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

pub fn observe_all(env: &mut Env, session: &Pubkey, rows: &[(u8, u32, i64, [u8; 32])]) {
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

fn instruction<A: ToAccountMetas, D: InstructionData>(accounts: A, data: D) -> Instruction {
    Instruction {
        program_id: macropaths::ID,
        accounts: accounts.to_account_metas(None),
        data: data.data(),
    }
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
