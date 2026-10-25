"""forecast/backtest.py: calculations, leakage controls and reproducibility.

Data-dependent tests need data/snapshots/CPIAUCNS.json (gitignored; `pixi run fetch`) and skip
without it. Run: pixi run pytest tests/research -q
"""
import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd
import pytest
import scipy.stats

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "forecast"))
import backtest as bt  # noqa: E402  (puts research/ and tests/ on sys.path)
import macrolib  # noqa: E402
import make_vectors as mv  # noqa: E402

P = lambda s: pd.Period(s, "M")  # noqa: E731


@pytest.fixture(scope="module")
def data():
    if not bt.SNAPSHOT.exists():
        pytest.skip("needs data/snapshots/CPIAUCNS.json (pixi run fetch)")
    return bt.load_data()


def shifted(data, from_idx, delta=50_000):
    """Same data, every observation from `from_idx` on moved by delta (1e-4 pp)."""
    x = data.x.copy()
    x[from_idx:] += delta
    return bt.Data(data.periods, x, data.provenance)


def toy_fit(x0=3.0, b=0.9, sd=0.5, n_resid=600):
    return {"a": 0.1, "b": b, "resid_sd": sd, "x0": x0,
            "resid": np.random.default_rng(11).normal(0.0, sd, n_resid)}


# ---------------------------------------------------------------- cut-off and leakage


def test_fit_ou_until_is_inclusive_and_fit_ar1_stops_at_t0_minus_1(data):
    t0 = P("1990-01")
    y = data.y
    window = y[: t0 - 1]
    assert window.index[-1] == t0 - 1  # label slicing includes the end label
    fit = macrolib.fit_ou(y, until=str(t0 - 1))
    v = window.to_numpy()
    x0, x1 = v[:-1], v[1:]
    b = np.sum((x0 - x0.mean()) * (x1 - x1.mean())) / np.sum((x0 - x0.mean()) ** 2)
    assert fit["n"] == len(v)
    assert fit["b"] == pytest.approx(b, rel=1e-12)
    f = bt.fit_ar1(y, t0)
    assert (f["n"], f["last_obs"], f["first_obs"]) == (len(v), "1989-12", "1914-01")
    assert f["x0"] == v[-1]


@pytest.mark.parametrize("t0", ["1965-01", "1990-01", "2021-01"])
def test_observations_at_or_after_t0_cannot_change_the_forecast(data, t0):
    t0 = P(t0)
    i0 = data.idx(t0)
    base_fit = bt.fit_ar1(data.y, t0)
    base = bt.forecast_stats(base_fit, 2_000, bt.origin_rng(1, bt.STREAM_SIM, t0))
    for start in (i0, i0 + 1, i0 + 47, len(data.x) - 1):
        alt = shifted(data, start)
        f = bt.fit_ar1(alt.y, t0)
        assert (f["a"], f["b"], f["resid_sd"], f["x0"], f["n"]) == (
            base_fit["a"], base_fit["b"], base_fit["resid_sd"], base_fit["x0"], base_fit["n"])
        d, a = bt.forecast_stats(f, 2_000, bt.origin_rng(1, bt.STREAM_SIM, t0))
        assert np.array_equal(d, base[0]) and np.array_equal(a, base[1])
    # ...while the last pre-origin observation does enter the forecast
    x = data.x.copy()
    x[i0 - 1] += 50_000
    f = bt.fit_ar1(bt.Data(data.periods, x, data.provenance).y, t0)
    assert f["x0"] != base_fit["x0"] and f["b"] != base_fit["b"]


def test_rolling_fit_window_uses_only_the_last_n_months_before_t0(data):
    t0 = P("2021-01")
    f = bt.fit_ar1(data.y, t0, window=288)
    assert (f["n"], f["first_obs"], f["last_obs"]) == (288, "1997-01", "2020-12")
    g = bt.fit_ar1(shifted(data, data.idx(t0)).y, t0, window=288)
    assert (g["a"], g["b"], g["resid_sd"]) == (f["a"], f["b"], f["resid_sd"])


def test_run_backtest_forecast_side_ignores_the_future(data):
    t0 = P("1990-01")
    base = bt.run_backtest(data, [t0], 500, 3)
    alt = bt.run_backtest(shifted(data, data.idx(t0)), [t0], 500, 3)
    for pol in bt.POLICIES:
        for prod in bt.PRODUCTS:
            a, b = base["arr"][(pol, prod)], alt["arr"][(pol, prod)]
            for key in ("E_ar1", "sd_ar1", "E_clim", "cap"):
                assert np.array_equal(a[key], b[key], equal_nan=True), (pol, prod, key)
    assert base["rows"][0]["caps_B"] == alt["rows"][0]["caps_B"]
    assert base["rows"][0]["realised_stats"] != alt["rows"][0]["realised_stats"]  # the outcome does change


def test_pre_origin_caps_use_no_future_data_and_match_pandas(data):
    t0 = P("2021-01")
    i0, rule = data.idx(t0), data.idx(bt.CAP_RULE_START)
    win_d, win_a = bt.window_stats(data.x)
    caps = bt.pre_origin_caps(win_d, win_a, i0, rule)
    for start in (i0, i0 + 30):
        alt = bt.window_stats(shifted(data, start).x)
        assert bt.pre_origin_caps(*alt, i0, rule) == caps
    eligible = slice(rule, i0 - bt.H + 1)
    assert caps["n_windows"] == eligible.stop - eligible.start
    assert caps["cooling"] == int(np.floor(pd.Series(win_d[eligible]).quantile(0.9) + 0.5))
    assert caps["excess"] == int(np.floor(pd.Series(win_a[eligible]).quantile(0.9) + 0.5))
    assert abs(caps["cooling"] / 1e4 - 7.697) < 0.001  # declared 7.697 pp
    assert abs(caps["excess"] / 1e4 - 188.18) < 0.01  # declared 188.18 pp-months


@pytest.mark.parametrize("t0", ["1965-01", "1990-07", "2021-01"])
def test_climatology_holds_only_windows_that_ended_before_t0(data, t0):
    i0 = data.idx(P(t0))
    sl = bt.climatology_slice(i0, data.idx(bt.HIST_START))
    last_start = sl.stop - 1
    assert last_start + bt.H - 1 == i0 - 1  # the window ending at t0 - 1 is included
    assert (i0 - bt.H + 1) not in range(sl.start, sl.stop)  # the one ending at t0 is not
    assert sl.start == 0


# ---------------------------------------------------------------- horizon and path statistics


@pytest.mark.parametrize("innovation", bt.INNOVATIONS)
def test_forecast_is_exactly_48_future_months_without_x0(innovation):
    fit = toy_fit()
    paths = bt.simulate_paths(fit, 7, np.random.default_rng(5), innovation)
    assert paths.shape == (7, bt.H)
    if innovation == "gaussian":
        e = np.random.default_rng(5).normal(0.0, fit["resid_sd"], size=(7, bt.H))
        assert np.allclose(paths[:, 0], fit["a"] + fit["b"] * fit["x0"] + e[:, 0])


def test_gaussian_paths_equal_macrolib_simulate_ar1():
    fit = toy_fit()
    ours = bt.simulate_paths(fit, 100, np.random.default_rng(3))
    ref = macrolib.simulate_ar1(fit, fit["x0"], bt.H, 100, np.random.default_rng(3))
    assert np.array_equal(ours, ref)


def test_vectorised_statistics_equal_the_reference_recursions():
    paths = np.random.default_rng(1).integers(-50_000, 150_000, size=(200, bt.H))
    d, a = bt.path_stats(paths)
    for row, dv, av in zip(paths, d, a):
        r = mv.run_recursions([int(v) for v in row])
        assert (dv, av) == (r["D"], r["A"])


def test_contract_statistics_reset_for_every_simulated_path():
    fit = toy_fit(x0=1_000.0, b=0.0, sd=0.1)  # a huge previous month: a peak that must not count
    d, a = bt.forecast_stats(fit, 50, np.random.default_rng(2))
    paths = bt.quantize(bt.simulate_paths(fit, 50, np.random.default_rng(2)))
    d_ref, a_ref = bt.path_stats(paths)
    assert np.array_equal(d, d_ref) and np.array_equal(a, a_ref)
    with_x0 = np.hstack([np.full((50, 1), int(fit["x0"] * 1e4)), paths])
    assert (bt.path_stats(with_x0)[0] > d_ref).all()  # including x0 would have inflated D


# ---------------------------------------------------------------- exact contract maths


def test_scores_equal_make_vectors_score():
    rng = np.random.default_rng(6)
    for _ in range(500):
        stat, cap = int(rng.integers(0, 3_000_000)), int(rng.integers(1, 2_000_000))
        assert int(bt.scores(stat, cap)) == mv.score(stat, cap)


def test_realised_outcomes_match_make_vectors_summary(data):
    win_d, win_a = bt.window_stats(data.x)
    for s in np.random.default_rng(7).integers(0, len(win_d), 60):
        ref = mv.summary([int(v) for v in data.x[s:s + bt.H]])
        assert (win_d[s], win_a[s]) == (ref["D"], ref["A"])
        assert int(bt.scores(win_d[s], mv.DCAP)) == ref["s1"]
        assert int(bt.scores(win_a[s], mv.ACAP)) == ref["s2"]


def test_jan2021_matches_vectors_and_the_onchain_scores(data):
    vectors = json.loads((ROOT / "tests" / "vectors.json").read_text())
    i0 = data.idx(P("2021-01"))
    assert [int(v) for v in data.x[i0:i0 + bt.H]] == [r["x"] for r in vectors["rows"]]
    win_d, win_a = bt.window_stats(data.x)
    assert int(bt.scores(win_d[i0], bt.FIXED_CAPS["cooling"])) == 827387
    assert int(bt.scores(win_a[i0], bt.FIXED_CAPS["excess"])) == 863980


def test_quantile_cap_is_type7_rounded_half_up():
    assert bt.quantile_cap([0, 10]) == 9  # 9.0
    assert bt.quantile_cap([0, 5]) == 5  # 4.5 -> 5
    assert bt.quantile_cap([0, 1]) == 1  # 0.9 -> 1
    assert bt.quantile_cap([0, 0, 0]) == 0  # no valid cap


# ---------------------------------------------------------------- scoring rules and calibration


def test_efficient_crps_equals_direct_pairwise_formula():
    rng = np.random.default_rng(0)
    for n in range(1, 21):
        for _ in range(25):
            x = rng.random(n) if rng.random() < 0.5 else rng.integers(0, 3, n) / 2.0  # with ties
            y = float(rng.random())
            assert bt.crps_ensemble(x, y) == pytest.approx(bt.crps_pairwise(x, y), abs=1e-12)


@pytest.mark.parametrize("y", [0.0, 0.2, 0.5, 0.77, 1.0])
def test_point_forecast_crps_is_absolute_error(y):
    assert bt.crps_ensemble([0.5], y) == pytest.approx(abs(0.5 - y))
    assert bt.crps_ensemble([0.5], y, fair=True) == pytest.approx(abs(0.5 - y))


def test_crps_equals_the_integral_definition():
    x = np.random.default_rng(8).random(7)
    y = 0.3
    grid = np.linspace(-1.0, 2.0, 300_001)
    cdf = (x[None, :] <= grid[:, None]).mean(axis=1)
    integral = np.trapezoid((cdf - (grid >= y)) ** 2, grid)
    assert bt.crps_ensemble(x, y) == pytest.approx(integral, abs=1e-4)


def test_fair_crps_uses_n_times_n_minus_1():
    x = np.random.default_rng(9).random(12)
    y = 0.4
    n = x.size
    direct = np.abs(x - y).mean() - np.abs(x[:, None] - x[None, :]).sum() / (2 * n * (n - 1))
    assert bt.crps_ensemble(x, y, fair=True) == pytest.approx(direct, abs=1e-12)


def test_randomised_pit_is_uniform_with_mass_at_0_and_the_cap():
    rng = np.random.default_rng(4)
    sample = np.sort(np.concatenate([np.zeros(300, np.int64), np.full(200, bt.ONE),
                                     rng.integers(1, bt.ONE, 500)]))
    u = [bt.randomized_pit(sample, sample[rng.integers(0, sample.size)], rng.random()) for _ in range(5_000)]
    assert scipy.stats.kstest(u, "uniform").pvalue > 0.01
    point = np.array([bt.ONE // 2])
    assert bt.randomized_pit(point, 0, 0.3) == 0.0 and bt.randomized_pit(point, bt.ONE, 0.3) == 1.0


def test_block_bootstrap_is_deterministic_and_block_1_is_iid():
    d = np.random.default_rng(9).normal(size=100)
    a = bt.block_bootstrap_means(d, 12, 500, np.random.default_rng(1))
    b = bt.block_bootstrap_means(d, 12, 500, np.random.default_rng(1))
    assert np.array_equal(a, b)
    iid = bt.block_bootstrap_means(d, 1, 500, np.random.default_rng(2))
    ref = d[np.random.default_rng(2).integers(0, 100, size=(500, 100))].mean(axis=1)
    assert np.array_equal(iid, ref)


def test_asking_price_clamp():
    assert bt.asking_price(0.98, 0.02) == 0.95  # maths note 6.3 example: the clamp binds
    assert bt.asking_price(0.01, 0.0) == 0.05
    assert bt.asking_price(0.30, 0.10) == pytest.approx(0.35)
    assert bt.asking_price(0.30, 0.10, kappa=0.0) == pytest.approx(0.30)


# ---------------------------------------------------------------- reproducibility


def test_identical_inputs_and_seeds_reproduce_identical_reports(data):
    origins = bt.origins_between(P("2020-11"), P("2021-01"))
    r1 = bt.build_report(data, origins, 500, 7, 200, sensitivity=False)
    r2 = bt.build_report(data, origins, 500, 7, 200, sensitivity=False)
    assert json.dumps(r1, sort_keys=True) == json.dumps(r2, sort_keys=True)
    assert json.loads(bt.dumps_report(r1)) == json.loads(json.dumps(r1))  # the compact writer is valid JSON
    r3 = bt.build_report(data, origins, 500, 8, 200, sensitivity=False)
    assert r3["per_origin"][0]["A"]["cooling"]["ar1"]["E"] != r1["per_origin"][0]["A"]["cooling"]["ar1"]["E"]
    assert r1["cross_checks"]["jan2021"]["realised_fixed_caps"] == {"cooling": 827387, "excess": 863980}
    for row in r1["per_origin"]:
        for pol in bt.POLICIES:
            for prod in bt.PRODUCTS:
                q = row[pol][prod]["quote_kappa_0_5"]
                assert q["seller_result"] == pytest.approx(q["premium"] - q["payout"], abs=2e-7)
                assert q["buyer_net_cost"] == q["seller_result"]
                assert bt.QUOTE_MIN <= q["premium"] <= bt.QUOTE_MAX
