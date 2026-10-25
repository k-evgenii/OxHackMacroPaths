use solana_signer::Signer;

mod common;

#[test]
fn harness_smoke() {
    let mut env = common::env();
    let owner = env.payer.pubkey();
    let ata = common::ata_with(&mut env, &owner, 1_000_000);
    assert_eq!(common::token_balance(&env, &ata), 1_000_000);
    common::set_time(&mut env, 1_700_000_000);
}
