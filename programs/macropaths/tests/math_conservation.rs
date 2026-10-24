//! Conservation of side budgets and cover splits. 10_000 random cases each.

use macropaths::math::{claim_amount, cover_split, side_budgets, ONE};
use proptest::prelude::*;
use proptest::test_runner::{FileFailurePersistence, TestCaseError};

const MAX_SIDE: u64 = 1_000_000_000_000;

fn conservation_config() -> ProptestConfig {
    ProptestConfig {
        cases: 10_000,
        failure_persistence: Some(Box::new(FileFailurePersistence::Off)),
        ..ProptestConfig::default()
    }
}

fn partition(total: u64, parts: usize) -> BoxedStrategy<Vec<u64>> {
    assert!((1..=8).contains(&parts));
    if parts == 1 {
        Just(vec![total]).boxed()
    } else {
        proptest::collection::vec(0u64..=total, parts - 1)
            .prop_map(move |mut cuts| {
                cuts.sort_unstable();
                let mut deposits = Vec::with_capacity(parts);
                let mut prev = 0u64;
                for cut in cuts {
                    deposits.push(cut - prev);
                    prev = cut;
                }
                deposits.push(total - prev);
                deposits
            })
            .boxed()
    }
}

fn funded_side() -> impl Strategy<Value = (u64, Vec<u64>)> {
    (0u64..=MAX_SIDE, 1usize..=8).prop_flat_map(|(total, parts)| {
        partition(total, parts).prop_map(move |deposits| (total, deposits))
    })
}

fn claim_sum(deposits: &[u64], refund: u64, pool: u64, side: u64) -> Result<u64, TestCaseError> {
    let mut total = 0u64;
    for &amount in deposits {
        let claim = claim_amount(amount, refund, pool, side)
            .ok_or_else(|| TestCaseError::fail("claim_amount returned None"))?;
        total = total
            .checked_add(claim)
            .ok_or_else(|| TestCaseError::fail("claim sum overflow"))?;
    }
    Ok(total)
}

proptest! {
    #![proptest_config(conservation_config())]

    #[test]
    fn math_side_claims_conserved(
        side0 in funded_side(),
        side1 in funded_side(),
        s in 0u64..=ONE,
    ) {
        let (s0, deposits0) = side0;
        let (s1, deposits1) = side1;
        prop_assert!((1..=8).contains(&deposits0.len()));
        prop_assert!((1..=8).contains(&deposits1.len()));
        prop_assert_eq!(
            deposits0.iter().try_fold(0u64, |acc, d| acc.checked_add(*d)),
            Some(s0)
        );
        prop_assert_eq!(
            deposits1.iter().try_fold(0u64, |acc, d| acc.checked_add(*d)),
            Some(s1)
        );

        let (p0, p1, r0, r1) = side_budgets(s0, s1, s)
            .ok_or_else(|| TestCaseError::fail("side_budgets returned None"))?;
        let matched = s0.min(s1);
        prop_assert_eq!(p0.checked_add(p1), matched.checked_mul(2));

        let claims0 = claim_sum(&deposits0, r0, p0, s0)?;
        let claims1 = claim_sum(&deposits1, r1, p1, s1)?;
        prop_assert!(claims0 <= r0.checked_add(p0).ok_or_else(|| TestCaseError::fail("side 0 budget"))?);
        prop_assert!(claims1 <= r1.checked_add(p1).ok_or_else(|| TestCaseError::fail("side 1 budget"))?);
        let total_claims = claims0
            .checked_add(claims1)
            .ok_or_else(|| TestCaseError::fail("total claims"))?;
        let deposited = s0
            .checked_add(s1)
            .ok_or_else(|| TestCaseError::fail("deposited"))?;
        prop_assert!(total_claims <= deposited);
    }

    #[test]
    fn math_cover_split_sums_and_covers_price(p in 0u64..=ONE, units in any::<u64>()) {
        let (buyer, seller) = cover_split(p, units)
            .ok_or_else(|| TestCaseError::fail("cover_split returned None"))?;
        prop_assert_eq!(buyer.checked_add(seller), Some(units));
        let product = u128::from(p)
            .checked_mul(u128::from(units))
            .ok_or_else(|| TestCaseError::fail("price product"))?;
        let buyer_scaled = u128::from(buyer)
            .checked_mul(u128::from(ONE))
            .ok_or_else(|| TestCaseError::fail("buyer scaled"))?;
        prop_assert!(buyer_scaled >= product);
    }
}
