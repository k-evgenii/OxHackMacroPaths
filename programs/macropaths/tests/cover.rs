//! Cover buy, claim, seller settle and seller withdraw.
//! Scores and PLAY amounts are read from tests/vectors.json.
//! The entry quote is `3/10` of `parameters.one` (300_000). Twenty PLAY is
//! twice `worked_example.buyer_deposit`.

mod common;

use anchor_lang::prelude::Pubkey;
use anchor_lang::{InstructionData, ToAccountMetas};
use litesvm::types::{FailedTransactionMetadata, TransactionMetadata};
use solana_keypair::Keypair;
use solana_message::Instruction;
use solana_signer::Signer;

use macropaths::math::{claim_amount, cover_claim, cover_split, side_budgets};
use macropaths::SessionState;

/// Base-unit cover sizes for the two-buyer dust case.
const DUST_UNITS: [u64; 2] = [3, 2];

struct Refs {
    quote: u64,
    units: u64,
    score_0: u64,
    score_1: u64,
    cooling_claim: u64,
    excess_claim: u64,
    seller_funding: u64,
}

struct Market {
    id: u64,
    session: Pubkey,
    vault_0: Pubkey,
    vault_1: Pubkey,
    seller: Pubkey,
    seller_ta: Pubkey,
    quote: Pubkey,
    seller_wallet: Keypair,
    seller_wallet_ta: Pubkey,
}

struct Buyer {
    keypair: Keypair,
    ta: Pubkey,
}

struct Settled {
    session: Pubkey,
    vault_0: Pubkey,
    vault_1: Pubkey,
    seller: Pubkey,
    seller_ta: Pubkey,
    owner: Keypair,
    owner_ta: Pubkey,
}

fn refs() -> Refs {
    let v = common::vectors();
    let one = json_u64(&v["parameters"]["one"]);
    let quote = one
        .checked_mul(3)
        .and_then(|product| product.checked_div(10))
        .expect("entry quote");
    assert_eq!(quote.checked_mul(10), one.checked_mul(3));
    let ten = json_u64(&v["worked_example"]["buyer_deposit"]);
    let units = ten.checked_mul(2).expect("20 PLAY");
    let score_0 = json_u64(&v["final"]["s1"]);
    let score_1 = json_u64(&v["final"]["s2"]);
    let cooling_claim = json_u64(&v["worked_example"]["cooling"]["buyer_claim"]);
    let excess_claim = json_u64(&v["worked_example"]["excess"]["buyer_claim"]);
    assert_eq!(score_0, json_u64(&v["worked_example"]["cooling"]["s"]));
    assert_eq!(score_1, json_u64(&v["worked_example"]["excess"]["s"]));
    assert_eq!(cover_claim(score_0, units), Some(cooling_claim));
    assert_eq!(cover_claim(score_1, units), Some(excess_claim));
    Refs {
        quote,
        units,
        score_0,
        score_1,
        cooling_claim,
        excess_claim,
        seller_funding: json_u64(&v["worked_example"]["cooling"]["S"][0]),
    }
}

fn json_u64(value: &serde_json::Value) -> u64 {
    value
        .as_u64()
        .unwrap_or_else(|| panic!("expected u64, got {value}"))
}

fn buyer(env: &mut common::Env, amount: u64) -> Buyer {
    let keypair = Keypair::new();
    env.svm
        .airdrop(&keypair.pubkey(), 1_000_000_000)
        .expect("airdrop buyer");
    let ta = common::ata_with(env, &keypair.pubkey(), amount);
    Buyer { keypair, ta }
}

fn open_market(env: &mut common::Env, id: u64, free_cash: u64, quote: u64) -> Market {
    let session = common::put_session(env, id, |_| {});
    common::put_vaults(env, &session, [0, 0]);
    let seller_wallet = Keypair::new();
    env.svm
        .airdrop(&seller_wallet.pubkey(), 1_000_000_000)
        .expect("airdrop seller");
    let seller_wallet_ta = common::ata_with(env, &seller_wallet.pubkey(), 0);
    let seller = common::put_seller(env, &session, &seller_wallet.pubkey(), |account| {
        account.free_cash = free_cash;
    });
    let (seller_ta, _) = common::seller_ta_pda(&session);
    let quote = common::put_quote(env, &session, [quote, quote], false);
    let (vault_0, _) = common::vault_pda(&session, 0);
    let (vault_1, _) = common::vault_pda(&session, 1);
    Market {
        id,
        session,
        vault_0,
        vault_1,
        seller,
        seller_ta,
        quote,
        seller_wallet,
        seller_wallet_ta,
    }
}

fn settled_product(
    env: &mut common::Env,
    id: u64,
    product: u8,
    units: u64,
    scores: [u64; 2],
) -> Settled {
    let owner = Keypair::new();
    env.svm
        .airdrop(&owner.pubkey(), 1_000_000_000)
        .expect("airdrop cover owner");
    let owner_ta = common::ata_with(env, &owner.pubkey(), 0);
    let mut sold = [0u64; 2];
    sold[usize::from(product)] = units;
    let mut vaults = [0u64; 2];
    vaults[usize::from(product)] = units;
    let session = common::put_session(env, id, |account| {
        account.state = SessionState::Settled;
        account.scores = scores;
        account.cover_count = 1;
        account.seller_products_open = 1;
    });
    common::put_vaults(env, &session, vaults);
    let cover = common::put_cover(env, &session, &owner.pubkey(), sold, [0, 0], false);
    let seller_wallet = Keypair::new();
    let seller = common::put_seller(env, &session, &seller_wallet.pubkey(), |account| {
        account.n_sold = sold;
    });
    let (seller_ta, _) = common::seller_ta_pda(&session);
    let (vault_0, _) = common::vault_pda(&session, 0);
    let (vault_1, _) = common::vault_pda(&session, 1);
    let _ = cover;
    Settled {
        session,
        vault_0,
        vault_1,
        seller,
        seller_ta,
        owner,
        owner_ta,
    }
}

fn vault_for(market: &Market, product: u8) -> Pubkey {
    if product == 0 {
        market.vault_0
    } else {
        market.vault_1
    }
}

fn buy_ix(market: &Market, buyer: &Buyer, product: u8, units: u64) -> Instruction {
    let (cover, _) = common::cover_pda(&market.session, &buyer.keypair.pubkey());
    instruction(
        macropaths::accounts::BuyCover {
            buyer: buyer.keypair.pubkey(),
            session: market.session,
            quote: market.quote,
            seller: market.seller,
            seller_ta: market.seller_ta,
            cover,
            buyer_ta: buyer.ta,
            vault: vault_for(market, product),
            token_program: anchor_spl::token::ID,
            system_program: anchor_lang::system_program::ID,
        },
        macropaths::instruction::BuyCover { product, units },
    )
}

fn claim_cover_ix(
    session: &Pubkey,
    owner: &Pubkey,
    owner_ta: Pubkey,
    vault_0: Pubkey,
    vault_1: Pubkey,
) -> Instruction {
    let (cover, _) = common::cover_pda(session, owner);
    instruction(
        macropaths::accounts::ClaimCover {
            owner: *owner,
            session: *session,
            cover,
            owner_ta,
            vault_0,
            vault_1,
            token_program: anchor_spl::token::ID,
        },
        macropaths::instruction::ClaimCover {},
    )
}

fn seller_settle_ix(
    session: Pubkey,
    seller: Pubkey,
    seller_ta: Pubkey,
    vault: Pubkey,
    product: u8,
) -> Instruction {
    instruction(
        macropaths::accounts::SellerSettle {
            session,
            seller,
            seller_ta,
            vault,
            token_program: anchor_spl::token::ID,
        },
        macropaths::instruction::SellerSettle { product },
    )
}

fn withdraw_ix(market: &Market, amount: u64) -> Instruction {
    instruction(
        macropaths::accounts::SellerWithdraw {
            seller_wallet: market.seller_wallet.pubkey(),
            session: market.session,
            seller: market.seller,
            seller_ta: market.seller_ta,
            seller_wallet_ta: market.seller_wallet_ta,
            token_program: anchor_spl::token::ID,
        },
        macropaths::instruction::SellerWithdraw { amount },
    )
}

fn claim_ix(
    session: Pubkey,
    owner: &Keypair,
    position: Pubkey,
    owner_ta: Pubkey,
    vault_0: Pubkey,
    vault_1: Pubkey,
) -> Instruction {
    instruction(
        macropaths::accounts::Claim {
            owner: owner.pubkey(),
            session,
            position,
            owner_ta,
            vault_0,
            vault_1,
            token_program: anchor_spl::token::ID,
        },
        macropaths::instruction::Claim {},
    )
}

fn sweep_ix(
    session: Pubkey,
    authority: Pubkey,
    treasury_ta: Pubkey,
    vault_0: Pubkey,
    vault_1: Pubkey,
) -> Instruction {
    instruction(
        macropaths::accounts::SweepDust {
            authority,
            session,
            treasury_ta,
            vault_0,
            vault_1,
            token_program: anchor_spl::token::ID,
        },
        macropaths::instruction::SweepDust {},
    )
}

fn expire_open(env: &mut common::Env, session: &Pubkey) {
    let account = common::read::<macropaths::Session>(env, session);
    let now = account
        .deposit_deadline
        .checked_add(1)
        .expect("past deposit deadline");
    common::set_time(env, now);
    must(send(
        env,
        instruction(
            macropaths::accounts::ExpireIncomplete { session: *session },
            macropaths::instruction::ExpireIncomplete {},
        ),
        &[],
    ));
}

fn send(
    env: &mut common::Env,
    ix: Instruction,
    signers: &[&Keypair],
) -> Result<TransactionMetadata, FailedTransactionMetadata> {
    env.svm.expire_blockhash();
    common::send(env, ix, signers)
}

fn must(result: Result<TransactionMetadata, FailedTransactionMetadata>) {
    result.unwrap_or_else(|err| panic!("{}", err.meta.pretty_logs()));
}

fn instruction<A: ToAccountMetas, D: InstructionData>(accounts: A, data: D) -> Instruction {
    Instruction {
        program_id: macropaths::ID,
        accounts: accounts.to_account_metas(None),
        data: data.data(),
    }
}

fn split_of(quote: u64, units: u64) -> (u64, u64) {
    cover_split(quote, units).expect("cover split")
}

#[test]
fn cover_buy_product_one() {
    let r = refs();
    let (buyer_pays, seller_pays) = split_of(r.quote, r.units);
    assert_eq!(buyer_pays.checked_add(seller_pays), Some(r.units));

    let mut env = common::env();
    let market = open_market(&mut env, 1, r.seller_funding, r.quote);
    let buyer = buyer(&mut env, r.units);
    must(send(
        &mut env,
        buy_ix(&market, &buyer, 1, r.units),
        &[&buyer.keypair],
    ));

    let session = common::read::<macropaths::Session>(&env, &market.session);
    assert_eq!(session.cover_count, 1);
    assert_eq!(session.seller_products_open, 1);
    let seller = common::read::<macropaths::Seller>(&env, &market.seller);
    assert_eq!(
        seller.free_cash,
        r.seller_funding
            .checked_sub(seller_pays)
            .expect("free cash")
    );
    assert_eq!(seller.escrow, [0, seller_pays]);
    assert_eq!(seller.n_sold, [0, r.units]);
    assert_eq!(seller.premium, [0, buyer_pays]);
    let (cover_key, bump) = common::cover_pda(&market.session, &buyer.keypair.pubkey());
    let cover = common::read::<macropaths::Cover>(&env, &cover_key);
    assert_eq!(cover.owner, buyer.keypair.pubkey());
    assert_eq!(cover.session, market.session);
    assert_eq!(cover.bump, bump);
    assert_eq!(cover.units, [0, r.units]);
    assert_eq!(cover.premium_paid, [0, buyer_pays]);
    assert!(!cover.claimed);
    let quote = common::read::<macropaths::EntryQuote>(&env, &market.quote);
    assert!(quote.frozen);
    assert!(quote.is_set);
    assert_eq!(common::token_balance(&env, &market.vault_1), r.units);
    assert_eq!(common::token_balance(&env, &market.vault_0), 0);
    assert_eq!(
        common::token_balance(&env, &buyer.ta),
        r.units.checked_sub(buyer_pays).expect("buyer change")
    );
    assert_eq!(
        common::token_balance(&env, &market.seller_ta),
        r.seller_funding
            .checked_sub(seller_pays)
            .expect("seller ta")
    );
}

#[test]
fn cover_buy_insufficient_seller_funds() {
    let r = refs();
    let (_, seller_pays) = split_of(r.quote, r.units);
    let free_cash = seller_pays.checked_sub(1).expect("just short");
    let mut env = common::env();
    let market = open_market(&mut env, 2, free_cash, r.quote);
    let buyer = buyer(&mut env, r.units);
    let (cover_key, _) = common::cover_pda(&market.session, &buyer.keypair.pubkey());

    common::assert_err(
        send(
            &mut env,
            buy_ix(&market, &buyer, 1, r.units),
            &[&buyer.keypair],
        ),
        macropaths::MacroError::InsufficientSellerFunds,
    );

    let session = common::read::<macropaths::Session>(&env, &market.session);
    assert_eq!(session.cover_count, 0);
    assert_eq!(session.seller_products_open, 0);
    assert!(session.state == SessionState::Open);
    let seller = common::read::<macropaths::Seller>(&env, &market.seller);
    assert_eq!(seller.free_cash, free_cash);
    assert_eq!(seller.escrow, [0, 0]);
    assert_eq!(seller.n_sold, [0, 0]);
    assert_eq!(seller.premium, [0, 0]);
    let quote = common::read::<macropaths::EntryQuote>(&env, &market.quote);
    assert!(!quote.frozen);
    assert!(env.svm.get_account(&cover_key).is_none());
    assert_eq!(common::token_balance(&env, &market.vault_0), 0);
    assert_eq!(common::token_balance(&env, &market.vault_1), 0);
    assert_eq!(common::token_balance(&env, &buyer.ta), r.units);
    assert_eq!(common::token_balance(&env, &market.seller_ta), free_cash);
}

#[test]
fn cover_buy_deadline() {
    let r = refs();
    let (buyer_pays, seller_pays) = split_of(r.quote, r.units);
    let mut env = common::env();
    let market = open_market(&mut env, 13, r.seller_funding, r.quote);
    let buyer = buyer(&mut env, r.units);
    let session = common::read::<macropaths::Session>(&env, &market.session);
    let deadline = session.deposit_deadline;
    let (cover_key, _) = common::cover_pda(&market.session, &buyer.keypair.pubkey());

    common::set_time(
        &mut env,
        deadline.checked_add(1).expect("past deposit deadline"),
    );
    common::assert_err(
        send(
            &mut env,
            buy_ix(&market, &buyer, 1, r.units),
            &[&buyer.keypair],
        ),
        macropaths::MacroError::PastDeadline,
    );
    let session = common::read::<macropaths::Session>(&env, &market.session);
    assert_eq!(session.cover_count, 0);
    assert!(session.state == SessionState::Open);
    let seller = common::read::<macropaths::Seller>(&env, &market.seller);
    assert_eq!(seller.free_cash, r.seller_funding);
    assert_eq!(seller.n_sold, [0, 0]);
    let quote = common::read::<macropaths::EntryQuote>(&env, &market.quote);
    assert!(!quote.frozen);
    assert!(env.svm.get_account(&cover_key).is_none());
    assert_eq!(common::token_balance(&env, &market.vault_1), 0);

    common::set_time(&mut env, deadline);
    must(send(
        &mut env,
        buy_ix(&market, &buyer, 1, r.units),
        &[&buyer.keypair],
    ));
    let session = common::read::<macropaths::Session>(&env, &market.session);
    assert_eq!(session.cover_count, 1);
    assert_eq!(common::token_balance(&env, &market.vault_1), r.units);
    let seller = common::read::<macropaths::Seller>(&env, &market.seller);
    assert_eq!(
        seller.free_cash,
        r.seller_funding
            .checked_sub(seller_pays)
            .expect("free cash")
    );
    let cover = common::read::<macropaths::Cover>(&env, &cover_key);
    assert_eq!(cover.premium_paid[1], buyer_pays);
}

#[test]
fn cover_buy_accumulates_one_cover() {
    let r = refs();
    let (buyer_pays, seller_pays) = split_of(r.quote, r.units);
    let twice_units = r.units.checked_mul(2).expect("two buys");
    let twice_buyer = buyer_pays.checked_mul(2).expect("two premiums");
    let twice_seller = seller_pays.checked_mul(2).expect("two escrows");
    let mut env = common::env();
    let market = open_market(&mut env, 3, r.seller_funding, r.quote);
    let buyer = buyer(&mut env, twice_units);

    must(send(
        &mut env,
        buy_ix(&market, &buyer, 1, r.units),
        &[&buyer.keypair],
    ));
    must(send(
        &mut env,
        buy_ix(&market, &buyer, 1, r.units),
        &[&buyer.keypair],
    ));

    let session = common::read::<macropaths::Session>(&env, &market.session);
    assert_eq!(session.cover_count, 1);
    assert_eq!(session.seller_products_open, 1);
    let seller = common::read::<macropaths::Seller>(&env, &market.seller);
    assert_eq!(seller.n_sold, [0, twice_units]);
    assert_eq!(seller.escrow, [0, twice_seller]);
    assert_eq!(seller.premium, [0, twice_buyer]);
    assert_eq!(
        seller.free_cash,
        r.seller_funding
            .checked_sub(twice_seller)
            .expect("free cash")
    );
    let (cover_key, _) = common::cover_pda(&market.session, &buyer.keypair.pubkey());
    let cover = common::read::<macropaths::Cover>(&env, &cover_key);
    assert_eq!(cover.units, [0, twice_units]);
    assert_eq!(cover.premium_paid, [0, twice_buyer]);
    assert_eq!(common::token_balance(&env, &market.vault_1), twice_units);
}

#[test]
fn cover_refund_returns_premium_and_escrow() {
    let r = refs();
    let (buyer_pays, seller_pays) = split_of(r.quote, r.units);
    let mut env = common::env();
    let market = open_market(&mut env, 4, r.seller_funding, r.quote);
    let buyer = buyer(&mut env, r.units);
    must(send(
        &mut env,
        buy_ix(&market, &buyer, 1, r.units),
        &[&buyer.keypair],
    ));
    expire_open(&mut env, &market.session);

    let session = common::read::<macropaths::Session>(&env, &market.session);
    assert!(session.state == SessionState::Refunding);
    let seller = common::read::<macropaths::Seller>(&env, &market.seller);
    let (cover_key, _) = common::cover_pda(&market.session, &buyer.keypair.pubkey());
    let cover = common::read::<macropaths::Cover>(&env, &cover_key);
    assert_eq!(cover.premium_paid, [0, buyer_pays]);
    assert_eq!(seller.escrow, [0, seller_pays]);
    assert_eq!(
        cover.premium_paid[1].checked_add(seller.escrow[1]),
        Some(seller.n_sold[1])
    );
    assert_eq!(seller.n_sold[1], r.units);

    let buyer_before = common::token_balance(&env, &buyer.ta);
    let seller_before = common::token_balance(&env, &market.seller_ta);
    must(send(
        &mut env,
        claim_cover_ix(
            &market.session,
            &buyer.keypair.pubkey(),
            buyer.ta,
            market.vault_0,
            market.vault_1,
        ),
        &[&buyer.keypair],
    ));
    must(send(
        &mut env,
        seller_settle_ix(
            market.session,
            market.seller,
            market.seller_ta,
            market.vault_1,
            1,
        ),
        &[],
    ));

    let buyer_gain = common::token_balance(&env, &buyer.ta)
        .checked_sub(buyer_before)
        .expect("premium back");
    let seller_gain = common::token_balance(&env, &market.seller_ta)
        .checked_sub(seller_before)
        .expect("escrow back");
    assert_eq!(buyer_gain, buyer_pays);
    assert_eq!(seller_gain, seller_pays);
    assert_eq!(buyer_gain.checked_add(seller_gain), Some(r.units));
    assert_eq!(common::token_balance(&env, &market.vault_1), 0);
    let seller = common::read::<macropaths::Seller>(&env, &market.seller);
    assert_eq!(seller.escrow, [0, 0]);
    assert_eq!(seller.settled, [false, true]);
    assert_eq!(
        seller.free_cash,
        r.seller_funding
            .checked_sub(seller_pays)
            .expect("still lent")
            .checked_add(seller_pays)
            .expect("returned")
    );
    let session = common::read::<macropaths::Session>(&env, &market.session);
    assert_eq!(session.cover_claimed_count, 1);
    assert_eq!(session.seller_products_open, 0);
    let cover = common::read::<macropaths::Cover>(&env, &cover_key);
    assert!(cover.claimed);
}

#[test]
fn cover_settled_product_one() {
    let r = refs();
    let mut env = common::env();
    let desk = settled_product(&mut env, 5, 1, r.units, [r.score_0, r.score_1]);
    must(send(
        &mut env,
        claim_cover_ix(
            &desk.session,
            &desk.owner.pubkey(),
            desk.owner_ta,
            desk.vault_0,
            desk.vault_1,
        ),
        &[&desk.owner],
    ));
    assert_eq!(common::token_balance(&env, &desk.owner_ta), r.excess_claim);

    let before = common::token_balance(&env, &desk.seller_ta);
    must(send(
        &mut env,
        seller_settle_ix(desk.session, desk.seller, desk.seller_ta, desk.vault_1, 1),
        &[],
    ));
    let pay = common::token_balance(&env, &desk.seller_ta)
        .checked_sub(before)
        .expect("seller remainder");
    assert_eq!(pay, r.units.checked_sub(r.excess_claim).expect("remainder"));
    assert_eq!(r.excess_claim.checked_add(pay), Some(r.units));
    assert_eq!(common::token_balance(&env, &desk.vault_1), 0);
    let seller = common::read::<macropaths::Seller>(&env, &desk.seller);
    assert_eq!(seller.free_cash, pay);
    assert_eq!(seller.escrow[1], 0);
    assert!(seller.settled[1]);
    let session = common::read::<macropaths::Session>(&env, &desk.session);
    assert_eq!(session.scores, [r.score_0, r.score_1]);
    assert_eq!(session.seller_products_open, 0);
    assert_eq!(session.cover_claimed_count, 1);
}

#[test]
fn cover_settled_product_zero() {
    let r = refs();
    let mut env = common::env();
    let desk = settled_product(&mut env, 6, 0, r.units, [r.score_0, r.score_1]);
    must(send(
        &mut env,
        claim_cover_ix(
            &desk.session,
            &desk.owner.pubkey(),
            desk.owner_ta,
            desk.vault_0,
            desk.vault_1,
        ),
        &[&desk.owner],
    ));
    assert_eq!(common::token_balance(&env, &desk.owner_ta), r.cooling_claim);

    let before = common::token_balance(&env, &desk.seller_ta);
    must(send(
        &mut env,
        seller_settle_ix(desk.session, desk.seller, desk.seller_ta, desk.vault_0, 0),
        &[],
    ));
    let pay = common::token_balance(&env, &desk.seller_ta)
        .checked_sub(before)
        .expect("seller remainder");
    assert_eq!(
        pay,
        r.units.checked_sub(r.cooling_claim).expect("remainder")
    );
    assert_eq!(r.cooling_claim.checked_add(pay), Some(r.units));
    assert_eq!(common::token_balance(&env, &desk.vault_0), 0);
    let session = common::read::<macropaths::Session>(&env, &desk.session);
    assert_eq!(session.scores, [r.score_0, r.score_1]);
    assert_eq!(session.seller_products_open, 0);
}

#[test]
fn cover_dust_two_buyers() {
    let r = refs();
    let units_a = DUST_UNITS[0];
    let units_b = DUST_UNITS[1];
    let n_sold = units_a.checked_add(units_b).expect("n_sold");
    let mut env = common::env();
    let market = open_market(&mut env, 7, r.seller_funding, r.quote);
    let buyer_a = buyer(&mut env, r.units);
    let buyer_b = buyer(&mut env, r.units);
    must(send(
        &mut env,
        buy_ix(&market, &buyer_a, 1, units_a),
        &[&buyer_a.keypair],
    ));
    must(send(
        &mut env,
        buy_ix(&market, &buyer_b, 1, units_b),
        &[&buyer_b.keypair],
    ));

    let live = common::read::<macropaths::Session>(&env, &market.session);
    assert_eq!(live.cover_count, 2);
    assert_eq!(live.seller_products_open, 1);
    let seller = common::read::<macropaths::Seller>(&env, &market.seller);
    assert_eq!(seller.n_sold[1], n_sold);
    assert_eq!(common::token_balance(&env, &market.vault_1), n_sold);
    common::put_session(&mut env, market.id, |account| {
        account.state = SessionState::Settled;
        account.scores = [r.score_0, r.score_1];
        account.cover_count = live.cover_count;
        account.seller_products_open = live.seller_products_open;
    });

    let before_a = common::token_balance(&env, &buyer_a.ta);
    let before_b = common::token_balance(&env, &buyer_b.ta);
    let before_seller = common::token_balance(&env, &market.seller_ta);
    must(send(
        &mut env,
        claim_cover_ix(
            &market.session,
            &buyer_a.keypair.pubkey(),
            buyer_a.ta,
            market.vault_0,
            market.vault_1,
        ),
        &[&buyer_a.keypair],
    ));
    must(send(
        &mut env,
        claim_cover_ix(
            &market.session,
            &buyer_b.keypair.pubkey(),
            buyer_b.ta,
            market.vault_0,
            market.vault_1,
        ),
        &[&buyer_b.keypair],
    ));
    must(send(
        &mut env,
        seller_settle_ix(
            market.session,
            market.seller,
            market.seller_ta,
            market.vault_1,
            1,
        ),
        &[],
    ));

    let paid_a = common::token_balance(&env, &buyer_a.ta)
        .checked_sub(before_a)
        .expect("buyer a");
    let paid_b = common::token_balance(&env, &buyer_b.ta)
        .checked_sub(before_b)
        .expect("buyer b");
    let paid_seller = common::token_balance(&env, &market.seller_ta)
        .checked_sub(before_seller)
        .expect("seller remainder");
    assert_eq!(paid_a, cover_claim(r.score_1, units_a).expect("claim a"));
    assert_eq!(paid_b, cover_claim(r.score_1, units_b).expect("claim b"));
    assert_eq!(
        paid_seller,
        n_sold
            .checked_sub(cover_claim(r.score_1, n_sold).expect("whole"))
            .expect("remainder")
    );
    let paid = paid_a
        .checked_add(paid_b)
        .and_then(|sum| sum.checked_add(paid_seller))
        .expect("paid");
    assert!(paid <= n_sold);
    let dust = n_sold.checked_sub(paid).expect("dust");
    assert_eq!(common::token_balance(&env, &market.vault_1), dust);
}

#[test]
fn cover_withdraw_after_escrow_clears() {
    let r = refs();
    let (_, seller_pays) = split_of(r.quote, r.units);
    let mut env = common::env();
    let market = open_market(&mut env, 8, r.seller_funding, r.quote);
    let buyer = buyer(&mut env, r.units);
    must(send(
        &mut env,
        buy_ix(&market, &buyer, 1, r.units),
        &[&buyer.keypair],
    ));

    let seller = common::read::<macropaths::Seller>(&env, &market.seller);
    assert!(seller.escrow[1] > 0);
    assert_eq!(seller.escrow[1], seller_pays);
    let free_cash = seller.free_cash;
    let seller_ta = common::token_balance(&env, &market.seller_ta);
    let wallet_ta = common::token_balance(&env, &market.seller_wallet_ta);
    common::assert_err(
        send(
            &mut env,
            withdraw_ix(&market, free_cash),
            &[&market.seller_wallet],
        ),
        macropaths::MacroError::SellerEscrowOutstanding,
    );
    let seller = common::read::<macropaths::Seller>(&env, &market.seller);
    assert_eq!(seller.free_cash, free_cash);
    assert_eq!(seller.escrow[1], seller_pays);
    assert_eq!(common::token_balance(&env, &market.seller_ta), seller_ta);
    assert_eq!(
        common::token_balance(&env, &market.seller_wallet_ta),
        wallet_ta
    );

    expire_open(&mut env, &market.session);
    must(send(
        &mut env,
        seller_settle_ix(
            market.session,
            market.seller,
            market.seller_ta,
            market.vault_0,
            0,
        ),
        &[],
    ));
    must(send(
        &mut env,
        seller_settle_ix(
            market.session,
            market.seller,
            market.seller_ta,
            market.vault_1,
            1,
        ),
        &[],
    ));
    let seller = common::read::<macropaths::Seller>(&env, &market.seller);
    assert_eq!(seller.escrow, [0, 0]);
    assert_eq!(seller.settled, [true, true]);
    assert_eq!(seller.free_cash, r.seller_funding);
    let amount = seller.free_cash;
    must(send(
        &mut env,
        withdraw_ix(&market, amount),
        &[&market.seller_wallet],
    ));
    assert_eq!(
        common::token_balance(&env, &market.seller_wallet_ta),
        wallet_ta.checked_add(amount).expect("wallet")
    );
    assert_eq!(
        common::token_balance(&env, &market.seller_ta),
        seller_ta
            .checked_add(seller_pays)
            .and_then(|sum| sum.checked_sub(amount))
            .expect("seller ta after withdraw")
    );
    let seller = common::read::<macropaths::Seller>(&env, &market.seller);
    assert_eq!(seller.free_cash, 0);
}

#[test]
fn cover_pool_and_cover_sweep() {
    let r = refs();
    let v = common::vectors();
    let cooling = &v["worked_example"]["cooling"];
    let side_0 = json_u64(&cooling["S"][0]);
    let side_1 = json_u64(&cooling["S"][1]);
    let (p0, p1, r0, r1) = side_budgets(side_0, side_1, r.score_0).expect("budgets");
    assert_eq!(p0, json_u64(&cooling["P"][0]));
    assert_eq!(p1, json_u64(&cooling["P"][1]));
    assert_eq!(r0, json_u64(&cooling["R"][0]));
    assert_eq!(r1, json_u64(&cooling["R"][1]));
    let units_a = DUST_UNITS[0];
    let units_b = DUST_UNITS[1];
    let n_sold = units_a.checked_add(units_b).expect("n_sold");
    let funded = side_0
        .checked_add(side_1)
        .and_then(|sum| sum.checked_add(n_sold))
        .expect("vault funding");

    let mut env = common::env();
    let session = common::put_session(&mut env, 9, |account| {
        account.state = SessionState::Settled;
        account.scores = [r.score_0, r.score_1];
        account.side_totals = [side_0, side_1, 0, 0];
        account.matched = [json_u64(&cooling["M"]), 0];
        account.p_budget = [p0, p1, 0, 0];
        account.r_budget = [r0, r1, 0, 0];
        account.position_count = 2;
        account.cover_count = 2;
        account.seller_products_open = 1;
    });
    common::put_vaults(&mut env, &session, [funded, 0]);
    let (vault_0, _) = common::vault_pda(&session, 0);
    let (vault_1, _) = common::vault_pda(&session, 1);

    let pool_a = buyer(&mut env, 0);
    let pool_b = buyer(&mut env, 0);
    let position_a = common::put_position(
        &mut env,
        &session,
        &pool_a.keypair.pubkey(),
        [side_0, 0, 0, 0],
        false,
    );
    let position_b = common::put_position(
        &mut env,
        &session,
        &pool_b.keypair.pubkey(),
        [0, side_1, 0, 0],
        false,
    );
    let cover_a = buyer(&mut env, 0);
    let cover_b = buyer(&mut env, 0);
    common::put_cover(
        &mut env,
        &session,
        &cover_a.keypair.pubkey(),
        [units_a, 0],
        [0, 0],
        false,
    );
    common::put_cover(
        &mut env,
        &session,
        &cover_b.keypair.pubkey(),
        [units_b, 0],
        [0, 0],
        false,
    );
    let seller_wallet = Keypair::new();
    let seller = common::put_seller(&mut env, &session, &seller_wallet.pubkey(), |account| {
        account.n_sold = [n_sold, 0];
    });
    let (seller_ta, _) = common::seller_ta_pda(&session);
    let authority = env.authority.insecure_clone();
    let treasury = common::ata_with(&mut env, &authority.pubkey(), 0);

    let sweep = sweep_ix(session, authority.pubkey(), treasury, vault_0, vault_1);
    common::assert_err(
        send(&mut env, sweep.clone(), &[&authority]),
        macropaths::MacroError::NotAllClaimed,
    );

    must(send(
        &mut env,
        claim_ix(
            session,
            &pool_a.keypair,
            position_a,
            pool_a.ta,
            vault_0,
            vault_1,
        ),
        &[&pool_a.keypair],
    ));
    must(send(
        &mut env,
        claim_ix(
            session,
            &pool_b.keypair,
            position_b,
            pool_b.ta,
            vault_0,
            vault_1,
        ),
        &[&pool_b.keypair],
    ));
    common::assert_err(
        send(&mut env, sweep.clone(), &[&authority]),
        macropaths::MacroError::NotAllClaimed,
    );
    must(send(
        &mut env,
        claim_cover_ix(
            &session,
            &cover_a.keypair.pubkey(),
            cover_a.ta,
            vault_0,
            vault_1,
        ),
        &[&cover_a.keypair],
    ));
    must(send(
        &mut env,
        claim_cover_ix(
            &session,
            &cover_b.keypair.pubkey(),
            cover_b.ta,
            vault_0,
            vault_1,
        ),
        &[&cover_b.keypair],
    ));
    common::assert_err(
        send(&mut env, sweep.clone(), &[&authority]),
        macropaths::MacroError::NotAllClaimed,
    );
    must(send(
        &mut env,
        seller_settle_ix(session, seller, seller_ta, vault_1, 1),
        &[],
    ));
    let mid = common::read::<macropaths::Session>(&env, &session);
    assert_eq!(mid.seller_products_open, 1);
    common::assert_err(
        send(&mut env, sweep.clone(), &[&authority]),
        macropaths::MacroError::NotAllClaimed,
    );
    must(send(
        &mut env,
        seller_settle_ix(session, seller, seller_ta, vault_0, 0),
        &[],
    ));

    let pool_paid_a = claim_amount(side_0, r0, p0, side_0)
        .and_then(|left| claim_amount(0, r1, p1, side_1).and_then(|right| left.checked_add(right)))
        .expect("pool a");
    let pool_paid_b = claim_amount(0, r0, p0, side_0)
        .and_then(|left| {
            claim_amount(side_1, r1, p1, side_1).and_then(|right| left.checked_add(right))
        })
        .expect("pool b");
    let cover_paid_a = cover_claim(r.score_0, units_a).expect("cover a");
    let cover_paid_b = cover_claim(r.score_0, units_b).expect("cover b");
    let remainder = n_sold
        .checked_sub(cover_claim(r.score_0, n_sold).expect("whole"))
        .expect("remainder");
    assert_eq!(common::token_balance(&env, &pool_a.ta), pool_paid_a);
    assert_eq!(common::token_balance(&env, &pool_b.ta), pool_paid_b);
    assert_eq!(common::token_balance(&env, &cover_a.ta), cover_paid_a);
    assert_eq!(common::token_balance(&env, &cover_b.ta), cover_paid_b);
    assert_eq!(common::token_balance(&env, &seller_ta), remainder);
    let paid = [
        pool_paid_a,
        pool_paid_b,
        cover_paid_a,
        cover_paid_b,
        remainder,
    ]
    .into_iter()
    .try_fold(0u64, |acc, amount| acc.checked_add(amount))
    .expect("paid");
    assert!(paid <= funded);
    let dust = funded.checked_sub(paid).expect("dust");
    assert_eq!(common::token_balance(&env, &vault_0), dust);
    assert_eq!(common::token_balance(&env, &vault_1), 0);
    let session_account = common::read::<macropaths::Session>(&env, &session);
    assert_eq!(
        session_account.claimed_count,
        session_account.position_count
    );
    assert_eq!(
        session_account.cover_claimed_count,
        session_account.cover_count
    );
    assert_eq!(session_account.seller_products_open, 0);

    must(send(&mut env, sweep, &[&authority]));
    assert_eq!(common::token_balance(&env, &vault_0), 0);
    assert_eq!(common::token_balance(&env, &vault_1), 0);
    assert_eq!(common::token_balance(&env, &treasury), dust);
}

#[test]
fn cover_claim_twice() {
    let r = refs();
    let mut env = common::env();
    let desk = settled_product(&mut env, 10, 1, r.units, [r.score_0, r.score_1]);
    let ix = claim_cover_ix(
        &desk.session,
        &desk.owner.pubkey(),
        desk.owner_ta,
        desk.vault_0,
        desk.vault_1,
    );
    must(send(&mut env, ix.clone(), &[&desk.owner]));
    assert_eq!(common::token_balance(&env, &desk.owner_ta), r.excess_claim);
    common::assert_err(
        send(&mut env, ix, &[&desk.owner]),
        macropaths::MacroError::AlreadyClaimed,
    );
    assert_eq!(common::token_balance(&env, &desk.owner_ta), r.excess_claim);
    let session = common::read::<macropaths::Session>(&env, &desk.session);
    assert_eq!(session.cover_claimed_count, 1);
}

#[test]
fn cover_seller_settle_twice() {
    let r = refs();
    let mut env = common::env();
    let desk = settled_product(&mut env, 11, 1, r.units, [r.score_0, r.score_1]);
    let ix = seller_settle_ix(desk.session, desk.seller, desk.seller_ta, desk.vault_1, 1);
    must(send(&mut env, ix.clone(), &[]));
    let pay = r.units.checked_sub(r.excess_claim).expect("remainder");
    assert_eq!(common::token_balance(&env, &desk.seller_ta), pay);
    common::assert_err(
        send(&mut env, ix, &[]),
        macropaths::MacroError::AlreadySettled,
    );
    assert_eq!(common::token_balance(&env, &desk.seller_ta), pay);
    let seller = common::read::<macropaths::Seller>(&env, &desk.seller);
    assert_eq!(seller.free_cash, pay);
    assert!(seller.settled[1]);
    let session = common::read::<macropaths::Session>(&env, &desk.session);
    assert_eq!(session.seller_products_open, 0);
}

#[test]
fn cover_buy_while_running() {
    let r = refs();
    let mut env = common::env();
    let market = open_market(&mut env, 12, r.seller_funding, r.quote);
    common::put_session(&mut env, market.id, |account| {
        account.state = SessionState::Running;
    });
    let buyer = buyer(&mut env, r.units);
    let (cover_key, _) = common::cover_pda(&market.session, &buyer.keypair.pubkey());
    common::assert_err(
        send(
            &mut env,
            buy_ix(&market, &buyer, 1, r.units),
            &[&buyer.keypair],
        ),
        macropaths::MacroError::WrongState,
    );
    let session = common::read::<macropaths::Session>(&env, &market.session);
    assert!(session.state == SessionState::Running);
    assert_eq!(session.cover_count, 0);
    assert_eq!(session.seller_products_open, 0);
    let seller = common::read::<macropaths::Seller>(&env, &market.seller);
    assert_eq!(seller.free_cash, r.seller_funding);
    assert_eq!(seller.n_sold, [0, 0]);
    let quote = common::read::<macropaths::EntryQuote>(&env, &market.quote);
    assert!(!quote.frozen);
    assert!(env.svm.get_account(&cover_key).is_none());
    assert_eq!(common::token_balance(&env, &market.vault_1), 0);
    assert_eq!(common::token_balance(&env, &buyer.ta), r.units);
}
