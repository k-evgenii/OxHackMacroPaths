//! Pure integer maths for scores, side budgets and cover. No Anchor types.

/// Scores and prices, in millionths.
pub const ONE: u64 = 1_000_000;

/// One cooling step: `(max(peak, x), max(max_decline, new_peak - x))`.
///
/// `new_peak - x` is checked. It is always non-negative; the call panics only
/// when that difference does not fit in `i64`, which the return type cannot
/// report as `None`.
pub fn step_cooling(peak: i64, max_decline: i64, x: i64) -> (i64, i64) {
    let new_peak = peak.max(x);
    let decline = new_peak
        .checked_sub(x)
        .expect("cooling decline does not fit in i64");
    (new_peak, max_decline.max(decline))
}

/// `acc + max(x - k, 0)`. `None` when the sum does not fit in `i64`.
pub fn step_excess(acc: i64, x: i64, k: i64) -> Option<i64> {
    let add = match x.checked_sub(k) {
        Some(delta) if delta > 0 => delta,
        Some(_) => 0,
        // A negative overflow is still below zero, so it adds nothing.
        // A positive overflow does not fit in the accumulator.
        None if x > k => return None,
        None => 0,
    };
    acc.checked_add(add)
}

/// `0` when `stat < 0`, otherwise `floor(min(stat, cap) * ONE / cap)`.
/// `None` when `cap <= 0` or the quotient does not fit in `u64`.
pub fn score(stat: i64, cap: i64) -> Option<u64> {
    if stat < 0 {
        return Some(0);
    }
    if cap <= 0 {
        return None;
    }
    let numer = u64::try_from(stat.min(cap)).ok()?;
    let cap_u = u64::try_from(cap).ok()?;
    let product = u128::from(ONE).checked_mul(u128::from(numer))?;
    u64::try_from(product / u128::from(cap_u)).ok()
}

/// `(P0, P1, R0, R1)` for one product.
///
/// `M = min(S0, S1)`, `P0 = floor(2·M·s / ONE)`, `P1 = 2·M − P0`, `R_j = S_j − M`.
/// `None` when a term does not fit in `u64`.
pub fn side_budgets(s0: u64, s1: u64, s_millionths: u64) -> Option<(u64, u64, u64, u64)> {
    let matched = u128::from(s0.min(s1));
    let two_m = matched.checked_mul(2)?;
    let p0 = two_m.checked_mul(u128::from(s_millionths))? / u128::from(ONE);
    if p0 > two_m {
        return None;
    }
    let p1 = two_m - p0;
    let r0 = u128::from(s0) - matched;
    let r1 = u128::from(s1) - matched;
    Some((
        u64::try_from(p0).ok()?,
        u64::try_from(p1).ok()?,
        u64::try_from(r0).ok()?,
        u64::try_from(r1).ok()?,
    ))
}

/// `floor(a·R_j / S_j) + floor(a·P_j / S_j)`. `0` when `S_j == 0`.
pub fn claim_amount(a: u64, r_j: u64, p_j: u64, s_j: u64) -> Option<u64> {
    if s_j == 0 {
        return Some(0);
    }
    let side = u128::from(s_j);
    let from_refund = u128::from(a).checked_mul(u128::from(r_j))? / side;
    let from_pool = u128::from(a).checked_mul(u128::from(p_j))? / side;
    u64::try_from(from_refund.checked_add(from_pool)?).ok()
}

/// `(buyer, seller)` where `buyer = ceil(p·units / ONE)` and `seller = units − buyer`.
/// `None` when `buyer` exceeds `units` or either term does not fit in `u64`.
pub fn cover_split(p: u64, units: u64) -> Option<(u64, u64)> {
    let one = u128::from(ONE);
    let product = u128::from(p).checked_mul(u128::from(units))?;
    let buyer_wide = product.checked_add(one - 1)? / one;
    let buyer = u64::try_from(buyer_wide).ok()?;
    let seller = units.checked_sub(buyer)?;
    Some((buyer, seller))
}

/// `floor(s·units / ONE)`.
pub fn cover_claim(s: u64, units: u64) -> Option<u64> {
    let product = u128::from(s).checked_mul(u128::from(units))?;
    u64::try_from(product / u128::from(ONE)).ok()
}
