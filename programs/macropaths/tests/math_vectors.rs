//! Pins `math` to `tests/vectors.json`. Every expected number is read from that file.

use macropaths::math::{
    claim_amount, cover_claim, cover_split, score, side_budgets, step_cooling, step_excess, ONE,
};
use serde_json::Value;

const VECTORS: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/../../tests/vectors.json");

fn vectors() -> Value {
    let raw = std::fs::read_to_string(VECTORS).expect("read tests/vectors.json");
    serde_json::from_str(&raw).expect("parse tests/vectors.json")
}

fn as_i64(v: &Value) -> i64 {
    v.as_i64()
        .unwrap_or_else(|| panic!("expected i64, got {v}"))
}

fn as_u64(v: &Value) -> u64 {
    v.as_u64()
        .unwrap_or_else(|| panic!("expected u64, got {v}"))
}

struct Running {
    peak: i64,
    max_decline: i64,
    excess: i64,
}

fn replay(xs: &[i64], k: i64) -> Running {
    let mut peak = i64::MIN;
    let mut max_decline = 0i64;
    let mut excess = 0i64;
    for &x in xs {
        (peak, max_decline) = step_cooling(peak, max_decline, x);
        excess = step_excess(excess, x, k).expect("excess accumulator");
    }
    Running {
        peak,
        max_decline,
        excess,
    }
}

fn xs_of(path: &Value) -> Vec<i64> {
    path["x"]
        .as_array()
        .unwrap_or_else(|| panic!("path missing x array: {path}"))
        .iter()
        .map(as_i64)
        .collect()
}

fn assert_summary(got: &Running, expected: &Value, d_cap: i64, a_cap: i64, a_cap40: i64) {
    assert_eq!(got.peak, as_i64(&expected["M"]));
    assert_eq!(got.max_decline, as_i64(&expected["D"]));
    assert_eq!(got.excess, as_i64(&expected["A"]));
    assert_eq!(
        score(got.max_decline, d_cap).expect("cooling score"),
        as_u64(&expected["s1"])
    );
    assert_eq!(
        score(got.excess, a_cap).expect("excess score"),
        as_u64(&expected["s2"])
    );
    assert_eq!(
        score(got.excess, a_cap40).expect("capped excess score"),
        as_u64(&expected["s2_cap40"])
    );
}

fn caps(v: &Value) -> (i64, i64, i64, i64) {
    let p = &v["parameters"];
    (
        as_i64(&p["K"]),
        as_i64(&p["Dcap"]),
        as_i64(&p["Acap"]),
        as_i64(&p["Acap_cap40"]),
    )
}

fn collect_paths<'a>(node: &'a Value, out: &mut Vec<&'a Value>) {
    match node {
        Value::Object(map) => {
            let is_path = map.get("x").is_some_and(|x| x.is_array()) && map.contains_key("D");
            if is_path {
                out.push(node);
            }
            for child in map.values() {
                collect_paths(child, out);
            }
        }
        Value::Array(items) => {
            for child in items {
                collect_paths(child, out);
            }
        }
        _ => {}
    }
}

#[test]
fn math_replay_running_statistics() {
    let v = vectors();
    let (k, _, _, _) = caps(&v);
    let rows = v["rows"].as_array().expect("rows");
    let running = v["running"].as_array().expect("running");
    assert_eq!(rows.len(), running.len());

    let mut peak = i64::MIN;
    let mut max_decline = 0i64;
    let mut excess = 0i64;
    for (row, step) in rows.iter().zip(running.iter()) {
        let x = as_i64(&row["x"]);
        (peak, max_decline) = step_cooling(peak, max_decline, x);
        excess = step_excess(excess, x, k).expect("excess accumulator");
        assert_eq!(peak, as_i64(&step["M"]), "t={}", as_i64(&step["t"]));
        assert_eq!(max_decline, as_i64(&step["D"]), "t={}", as_i64(&step["t"]));
        assert_eq!(excess, as_i64(&step["A"]), "t={}", as_i64(&step["t"]));
    }
}

#[test]
fn math_final_scores() {
    let v = vectors();
    let (k, d_cap, a_cap, a_cap40) = caps(&v);
    let xs: Vec<i64> = v["rows"]
        .as_array()
        .expect("rows")
        .iter()
        .map(|row| as_i64(&row["x"]))
        .collect();
    let got = replay(&xs, k);
    let fin = &v["final"];
    assert_summary(&got, fin, d_cap, a_cap, a_cap40);
    println!("D={} A={}", got.max_decline, got.excess);
}

#[test]
fn math_annual_slices() {
    let v = vectors();
    let (k, d_cap, a_cap, a_cap40) = caps(&v);
    let rows = v["rows"].as_array().expect("rows");
    let years = v["annual_slices"]["years"].as_array().expect("years");
    assert!(!years.is_empty());
    for year in years {
        let t_first = as_i64(&year["t_first"]);
        let t_last = as_i64(&year["t_last"]);
        let xs: Vec<i64> = rows
            .iter()
            .filter(|row| {
                let t = as_i64(&row["t"]);
                t >= t_first && t <= t_last
            })
            .map(|row| as_i64(&row["x"]))
            .collect();
        assert_eq!(
            i64::try_from(xs.len()).expect("slice length"),
            t_last - t_first + 1
        );
        let got = replay(&xs, k);
        assert_summary(&got, year, d_cap, a_cap, a_cap40);
    }
}

#[test]
fn math_synthetic_paths() {
    let v = vectors();
    let (k, d_cap, a_cap, a_cap40) = caps(&v);
    let mut paths = Vec::new();
    collect_paths(&v["synthetic"], &mut paths);
    assert!(
        paths.len() >= 3,
        "expected the synthetic paths, found {}",
        paths.len()
    );
    for path in paths {
        let got = replay(&xs_of(path), k);
        assert_summary(&got, path, d_cap, a_cap, a_cap40);
    }
}

#[test]
fn math_threshold_cases() {
    let v = vectors();
    let k = as_i64(&v["threshold"]["K"]);
    let cases = v["threshold"]["cases"].as_array().expect("cases");
    assert!(!cases.is_empty());
    for case in cases {
        let x = as_i64(&case["x"]);
        let added = step_excess(0, x, k).expect("threshold step");
        assert_eq!(added, as_i64(&case["A_added"]));
    }
}

#[test]
fn math_budget_3v2() {
    let b = &vectors()["budget_3v2"];
    let s = as_u64(&b["s"]);
    let s0 = as_u64(&b["S"][0]);
    let s1 = as_u64(&b["S"][1]);
    let (p0, p1, r0, r1) = side_budgets(s0, s1, s).expect("budgets");
    assert_eq!(
        (p0, p1, r0, r1),
        (
            as_u64(&b["P"][0]),
            as_u64(&b["P"][1]),
            as_u64(&b["R"][0]),
            as_u64(&b["R"][1]),
        )
    );

    let mut total_claims = 0u64;
    let mut computed: Vec<Vec<u64>> = Vec::new();
    for (j, side) in b["deposits"]
        .as_array()
        .expect("deposits")
        .iter()
        .enumerate()
    {
        let (refund, pool, side_total) = if j == 0 { (r0, p0, s0) } else { (r1, p1, s1) };
        let mut side_claims = Vec::new();
        for amount in side.as_array().expect("side deposits") {
            let claim = claim_amount(as_u64(amount), refund, pool, side_total).expect("claim");
            total_claims = total_claims.checked_add(claim).expect("claim sum");
            side_claims.push(claim);
        }
        computed.push(side_claims);
    }

    let expected: Vec<Vec<u64>> = b["claims"]
        .as_array()
        .expect("claims")
        .iter()
        .map(|side| {
            side.as_array()
                .expect("claim side")
                .iter()
                .map(as_u64)
                .collect()
        })
        .collect();
    assert_eq!(computed, expected);
    assert_eq!(total_claims, as_u64(&b["total_claims"]));
    assert_eq!(
        as_u64(&b["deposited"]).checked_sub(total_claims),
        Some(as_u64(&b["dust"]))
    );
}

#[test]
fn math_worked_example() {
    let w = &vectors()["worked_example"];
    let buyer = as_u64(&w["buyer_deposit"]);
    let mut buyer_total = 0u64;
    for name in ["cooling", "excess"] {
        let prod = &w[name];
        let s = as_u64(&prod["s"]);
        let s0 = as_u64(&prod["S"][0]);
        let s1 = as_u64(&prod["S"][1]);
        let (p0, p1, r0, r1) = side_budgets(s0, s1, s).expect(name);
        assert_eq!(p0, as_u64(&prod["P"][0]), "{name} P0");
        assert_eq!(p1, as_u64(&prod["P"][1]), "{name} P1");
        assert_eq!(r0, as_u64(&prod["R"][0]), "{name} R0");
        assert_eq!(r1, as_u64(&prod["R"][1]), "{name} R1");
        let claim = claim_amount(buyer, r0, p0, s0).expect("buyer claim");
        assert_eq!(claim, as_u64(&prod["buyer_claim"]), "{name} buyer_claim");
        buyer_total = buyer_total.checked_add(claim).expect("buyer total");
    }
    assert_eq!(buyer_total, as_u64(&w["buyer_total"]));
}

#[test]
fn math_cover_split_and_claim() {
    let v = vectors();
    let one = as_u64(&v["parameters"]["one"]);
    assert_eq!(one, ONE);

    // Brief cases. The price is half of `parameters.one` (500_000) and `one` itself.
    let (buyer, seller) = cover_split(one / 2, 3).expect("half split");
    assert_eq!((buyer, seller), (2, 1));
    let (buyer, seller) = cover_split(one, 10).expect("full split");
    assert_eq!((buyer, seller), (10, 0));

    let score_s = as_u64(&v["final"]["s1"]);
    let units = as_u64(&v["worked_example"]["buyer_deposit"])
        .checked_mul(2)
        .expect("units");
    assert_eq!(
        cover_claim(score_s, units).expect("cover claim"),
        as_u64(&v["worked_example"]["cooling"]["buyer_claim"])
    );
}
