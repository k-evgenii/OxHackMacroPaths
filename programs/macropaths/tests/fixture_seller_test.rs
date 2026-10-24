//! Round-trip for the seller, quote, and cover LiteSVM fixtures.
use solana_signer::Signer;

mod common;

#[test]
fn fixtures_seller_roundtrip() {
    let mut env = common::env();
    let v = common::vectors();
    let example = &v["worked_example"];
    let cooling = &example["cooling"];
    let excess = &example["excess"];
    let free_cash = example["buyer_deposit"].as_u64().expect("buyer_deposit");
    let escrow = [
        cooling["buyer_claim"]
            .as_u64()
            .expect("cooling buyer_claim"),
        excess["buyer_claim"].as_u64().expect("excess buyer_claim"),
    ];
    let n_sold = [
        cooling["S"][0].as_u64().expect("cooling S0"),
        excess["S"][0].as_u64().expect("excess S0"),
    ];
    let premium = [
        cooling["P"][0].as_u64().expect("cooling P0"),
        excess["P"][0].as_u64().expect("excess P0"),
    ];
    let quote_p = [
        cooling["s"].as_u64().expect("cooling s"),
        excess["s"].as_u64().expect("excess s"),
    ];
    let units = [free_cash, cooling["M"].as_u64().expect("cooling M")];
    let premium_paid = escrow;
    let settled = [true, false];
    let frozen = true;
    let claimed = true;

    let id = 1u64;
    let session = common::put_session(&mut env, id, |_| {});
    let seller_wallet = env.authority.pubkey();
    let owner = env.payer.pubkey();
    let mint = env.mint;
    let supply_before = mint_supply(&env);

    let seller = common::put_seller(&mut env, &session, &seller_wallet, |account| {
        account.free_cash = free_cash;
        account.escrow = escrow;
        account.n_sold = n_sold;
        account.premium = premium;
        account.settled = settled;
    });
    let (expected_seller, seller_bump) = common::seller_pda(&session);
    let (seller_ta, ta_bump) = common::seller_ta_pda(&session);
    assert_eq!(seller, expected_seller);
    assert_eq!(account_owner(&env, &seller), macropaths::ID);
    let got = common::read::<macropaths::Seller>(&env, &seller);
    assert_eq!(got.session, session);
    assert_eq!(got.seller, seller_wallet);
    assert_eq!(got.free_cash, free_cash);
    assert_eq!(got.escrow, escrow);
    assert_eq!(got.n_sold, n_sold);
    assert_eq!(got.premium, premium);
    assert_eq!(got.settled, settled);
    assert_eq!(got.bump, seller_bump);
    assert_eq!(got.ta_bump, ta_bump);
    assert_eq!(common::token_balance(&env, &seller_ta), free_cash);
    let ta = env
        .svm
        .get_account(&seller_ta)
        .expect("seller token account");
    assert_eq!(ta.owner, anchor_spl::token::ID);
    assert_eq!(&ta.data[0..32], mint.as_ref());
    assert_eq!(&ta.data[32..64], session.as_ref());
    assert_eq!(
        mint_supply(&env),
        supply_before.checked_add(free_cash).expect("supply")
    );

    let quote = common::put_quote(&mut env, &session, quote_p, frozen);
    let (expected_quote, quote_bump) = common::quote_pda(&session);
    assert_eq!(quote, expected_quote);
    assert_eq!(account_owner(&env, &quote), macropaths::ID);
    let quote_account = common::read::<macropaths::EntryQuote>(&env, &quote);
    assert_eq!(quote_account.session, session);
    assert_eq!(quote_account.p, quote_p);
    assert!(quote_account.is_set);
    assert_eq!(quote_account.frozen, frozen);
    assert_eq!(quote_account.bump, quote_bump);

    let cover = common::put_cover(&mut env, &session, &owner, units, premium_paid, claimed);
    let (expected_cover, cover_bump) = common::cover_pda(&session, &owner);
    assert_eq!(cover, expected_cover);
    assert_eq!(account_owner(&env, &cover), macropaths::ID);
    let cover_account = common::read::<macropaths::Cover>(&env, &cover);
    assert_eq!(cover_account.session, session);
    assert_eq!(cover_account.owner, owner);
    assert_eq!(cover_account.units, units);
    assert_eq!(cover_account.premium_paid, premium_paid);
    assert_eq!(cover_account.claimed, claimed);
    assert_eq!(cover_account.bump, cover_bump);
}

fn account_owner(
    env: &common::Env,
    key: &anchor_lang::prelude::Pubkey,
) -> anchor_lang::prelude::Pubkey {
    env.svm.get_account(key).expect("account").owner
}

fn mint_supply(env: &common::Env) -> u64 {
    let account = env.svm.get_account(&env.mint).expect("mint");
    let bytes: [u8; 8] = account.data[36..44].try_into().expect("mint supply");
    u64::from_le_bytes(bytes)
}
