//! Round-trip for the LiteSVM account fixtures.
use anchor_lang::prelude::Clock;
use solana_signer::Signer;

mod common;

#[test]
fn fixtures_roundtrip() {
    let mut env = common::env();
    let v = common::vectors();
    let dataset_id = hex(&v["commitment"]["dataset_id"]);
    let c0 = hex(&v["commitment"]["C_0"]);
    let terminal = hex(&v["commitment"]["C_N"]);
    let next_commitment = hex(&v["chain"][1]["C_i"]);
    let k = v["parameters"]["K"].as_i64().expect("K");
    let d_cap = v["parameters"]["Dcap"].as_i64().expect("Dcap");
    let a_cap = v["parameters"]["Acap"].as_i64().expect("Acap");
    let one = v["parameters"]["one"].as_u64().expect("one");
    let n = u32::try_from(v["commitment"]["N"].as_u64().expect("N")).expect("N fits u32");
    let first_period = u32::try_from(
        v["commitment"]["first_period_id"]
            .as_u64()
            .expect("first_period_id"),
    )
    .expect("period id");
    let chain_value = v["chain"][0]["value"].as_i64().expect("chain value");
    let final_m = v["final"]["M"].as_i64().expect("M");
    let final_d = v["final"]["D"].as_i64().expect("D");
    let final_a = v["final"]["A"].as_i64().expect("A");
    let s1 = v["final"]["s1"].as_u64().expect("s1");
    let s2 = v["final"]["s2"].as_u64().expect("s2");
    let side_0 = v["budget_3v2"]["S"][0].as_u64().expect("S0");
    let side_1 = v["budget_3v2"]["S"][1].as_u64().expect("S1");
    let side_totals = [side_0, side_1, side_0, side_1];
    let matched_m = v["budget_3v2"]["M"].as_u64().expect("M");
    let matched = [matched_m, matched_m];
    let p0 = v["budget_3v2"]["P"][0].as_u64().expect("P0");
    let p1 = v["budget_3v2"]["P"][1].as_u64().expect("P1");
    let r0 = v["budget_3v2"]["R"][0].as_u64().expect("R0");
    let r1 = v["budget_3v2"]["R"][1].as_u64().expect("R1");
    let p_budget = [p0, p1, p0, p1];
    let r_budget = [r0, r1, r0, r1];

    let authority = env.authority.pubkey();
    let mint = env.mint;
    let now = env.svm.get_sysvar::<Clock>().unix_timestamp;
    let id = 1u64;

    let plain = common::put_session(&mut env, id.checked_add(1).expect("id"), |_| {});
    let plain_got = common::read::<macropaths::Session>(&env, &plain);
    assert!(plain_got.state == macropaths::SessionState::Open);
    assert_eq!(plain_got.peak, i64::MIN);
    assert_eq!(plain_got.commitment, c0);
    assert_eq!(plain_got.next_index, 0);
    assert_eq!(plain_got.side_totals, [0; 4]);

    let session = common::put_session(&mut env, id, |s| {
        s.state = macropaths::SessionState::Settled;
        s.next_index = n;
        s.last_period_id = first_period;
        s.side_totals = side_totals;
        s.matched = matched;
        s.peak = final_m;
        s.max_decline = final_d;
        s.excess_acc = final_a;
        s.values[0] = chain_value;
        s.scores = [s1, s2];
        s.p_budget = p_budget;
        s.r_budget = r_budget;
        s.position_count = u32::from(n);
        s.claimed_count = u32::try_from(matched_m).expect("claimed count");
        s.cover_count = u32::try_from(p1).expect("cover count");
        s.cover_claimed_count = u32::try_from(r0).expect("cover claimed");
        s.seller_products_open = u8::try_from(side_1).expect("seller products");
        s.commitment = next_commitment;
    });

    let (expected_session, bump) = common::session_pda(&authority, id);
    assert_eq!(session, expected_session);
    let (vault_0, vault_bump_0) = common::vault_pda(&session, 0);
    let (vault_1, vault_bump_1) = common::vault_pda(&session, 1);
    let got = common::read::<macropaths::Session>(&env, &session);
    assert_eq!(got.authority, authority);
    assert_eq!(got.session_id, id);
    assert_eq!(got.play_mint, mint);
    assert_eq!(got.vaults, [vault_0, vault_1]);
    assert_eq!(got.dataset_id, dataset_id);
    assert_eq!(got.commitment, next_commitment);
    assert_eq!(got.terminal, terminal);
    assert_eq!(got.n_obs, macropaths::N_OBS);
    assert_eq!(got.next_index, n);
    assert_eq!(got.last_period_id, first_period);
    assert!(got.state == macropaths::SessionState::Settled);
    assert_eq!(got.k, k);
    assert_eq!(got.d_cap, d_cap);
    assert_eq!(got.a_cap, a_cap);
    assert_eq!(
        got.deposit_deadline,
        now.checked_add(3_600).expect("deposit deadline")
    );
    assert_eq!(
        got.replay_deadline,
        now.checked_add(7_200).expect("replay deadline")
    );
    assert_eq!(got.side_totals, side_totals);
    assert_eq!(got.matched, matched);
    assert_eq!(got.peak, final_m);
    assert_eq!(got.max_decline, final_d);
    assert_eq!(got.excess_acc, final_a);
    assert_eq!(got.values[0], chain_value);
    assert!(got.values[1..].iter().all(|value| *value == 0));
    assert_eq!(got.scores, [s1, s2]);
    assert_eq!(got.p_budget, p_budget);
    assert_eq!(got.r_budget, r_budget);
    assert_eq!(got.position_count, u32::from(n));
    assert_eq!(
        got.claimed_count,
        u32::try_from(matched_m).expect("claimed count")
    );
    assert_eq!(got.cover_count, u32::try_from(p1).expect("cover count"));
    assert_eq!(
        got.cover_claimed_count,
        u32::try_from(r0).expect("cover claimed")
    );
    assert_eq!(
        got.seller_products_open,
        u8::try_from(side_1).expect("seller products")
    );
    assert_eq!(got.bump, bump);
    assert_eq!(got.vault_bumps, [vault_bump_0, vault_bump_1]);

    let supply_before = mint_supply(&env);
    let amounts = [one, s1];
    common::put_vaults(&mut env, &session, amounts);
    assert_eq!(common::token_balance(&env, &vault_0), amounts[0]);
    assert_eq!(common::token_balance(&env, &vault_1), amounts[1]);
    let supply = mint_supply(&env);
    assert_eq!(
        supply,
        supply_before
            .checked_add(amounts[0])
            .and_then(|sum| sum.checked_add(amounts[1]))
            .expect("supply")
    );

    let owner = env.payer.pubkey();
    let deposited = [side_0, side_1, one, s1];
    let position = common::put_position(&mut env, &session, &owner, deposited, true);
    let (expected_position, position_bump) = common::position_pda(&session, &owner);
    assert_eq!(position, expected_position);
    let position_account = common::read::<macropaths::Position>(&env, &position);
    assert_eq!(position_account.session, session);
    assert_eq!(position_account.owner, owner);
    assert_eq!(position_account.deposited, deposited);
    assert!(position_account.claimed);
    assert_eq!(position_account.bump, position_bump);
}

fn hex(value: &serde_json::Value) -> [u8; 32] {
    let raw = value.as_str().expect("hex string");
    let s = raw.strip_prefix("0x").unwrap_or(raw);
    assert_eq!(s.len(), 64, "32-byte hex");
    let mut out = [0u8; 32];
    for (i, byte) in out.iter_mut().enumerate() {
        *byte = u8::from_str_radix(&s[i * 2..i * 2 + 2], 16).expect("hex digit");
    }
    out
}

fn mint_supply(env: &common::Env) -> u64 {
    let account = env.svm.get_account(&env.mint).expect("mint");
    let bytes: [u8; 8] = account.data[36..44].try_into().expect("mint supply");
    u64::from_le_bytes(bytes)
}
