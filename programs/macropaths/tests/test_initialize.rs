//! Calls `initialize` on the compiled program inside LiteSVM (no validator needed).
//! Run with `anchor test` (or `cargo test` after `anchor build`).

use anchor_lang::{InstructionData, ToAccountMetas};
use litesvm::LiteSVM;
use solana_keypair::Keypair;
use solana_message::{Instruction, Message};
use solana_signer::Signer;
use solana_transaction::Transaction;

const SO: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/../../target/deploy/macropaths.so");

#[test]
fn initialize_succeeds_and_logs_greeting() {
    let mut svm = LiteSVM::new();
    svm.add_program_from_file(macropaths::ID, SO)
        .expect("target/deploy/macropaths.so missing: run `anchor build` first");

    let payer = Keypair::new();
    svm.airdrop(&payer.pubkey(), 1_000_000_000).unwrap();

    let ix = Instruction {
        program_id: macropaths::ID,
        accounts: macropaths::accounts::Initialize {}.to_account_metas(None),
        data: macropaths::instruction::Initialize {}.data(),
    };
    let msg = Message::new(&[ix], Some(&payer.pubkey()));
    let tx = Transaction::new(&[&payer], msg, svm.latest_blockhash());

    let meta = svm.send_transaction(tx).expect("initialize failed");
    assert!(
        meta.logs.iter().any(|l| l.contains("Greetings from")),
        "missing greeting in logs: {:#?}",
        meta.logs
    );
}
