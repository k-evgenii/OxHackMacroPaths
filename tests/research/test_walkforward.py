"""forecast/walkforward.py: origins, leakage controls, the random-walk model, binomial arithmetic and outputs.

Data-dependent tests need data/snapshots/CPIAUCNS.json (gitignored; `pixi run fetch`) and skip without it.
Run: pixi run pytest tests/research -q
"""
import json
import re
import sys
from pathlib import Path

import numpy as np
import pandas as pd
import pytest
import scipy.stats

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "forecast"))
import backtest as bt  # noqa: E402
import walkforward as wf  # noqa: E402

P = lambda s: pd.Period(s, "M")  # noqa: E731


@pytest.fixture(scope="module")
def data():
    if not bt.SNAPSHOT.exists():
        pytest.skip("needs data/snapshots/CPIAUCNS.json (pixi run fetch)")
    return bt.load_data()


@pytest.fixture(scope="module")
def small_report(data):
    return wf.build_report(data, 300, 7)


def shifted(data, from_idx, delta=50_000):
    """Same data, every observation from `from_idx` on moved by delta (1e-4 pp)."""
    x = data.x.copy()
    x[from_idx:] += delta
    return bt.Data(data.periods, x, data.provenance)


# ---------------------------------------------------------------- origins


def test_eleven_non_overlapping_origins_all_before_the_demo_window():
    o = wf.origins()
    assert len(o) == 11 and (str(o[0]), str(o[-1])) == ("1975-01", "2015-01")
    assert all((b - a).n == 48 for a, b in zip(o, o[1:]))  # tile the calendar: no overlap
    ends = [t + wf.H - 1 for t in o]
    assert all(e < b for e, b in zip(ends, o[1:]))
    assert str(ends[-1]) == "2018-12" and ends[-1] < P("2021-01")


def test_the_plan_range_cannot_hold_eleven_windows():
    months = (P("2017-12") - P("1975-01")).n + 1
    assert months == 516 < 11 * 48 == 528


def test_no_origin_window_reaches_the_empty_2025_10_value(data):
    assert data.provenance["first_missing_value"] == "2025-10"
    assert max(data.idx(t) + wf.H for t in wf.origins()) <= len(data.x)
    assert wf.origins()[-1] + wf.H - 1 < P("2025-10")


# ---------------------------------------------------------------- no look-ahead


@pytest.mark.parametrize("t0", wf.origins())
def test_fits_end_at_t0_minus_1(data, t0):
    a, o = bt.fit_ar1(data.y, t0), wf.fit_ao(data.y, t0)
    assert a["last_obs"] == o["last_obs"] == str(t0 - 1)
    assert (a["first_obs"], a["n"], a["x0"]) == (o["first_obs"], o["n"], o["x0"])
    assert o["n_changes"] == o["n"] - 1
    assert o["x0"] == data.y[: t0 - 1].iloc[-1]


def test_nothing_dated_t0_or_later_enters_any_forecast_input(data):
    n = 200
    for t0 in wf.origins():
        i0 = data.idx(t0)
        base = wf.evaluate(data, [t0], n, 3)
        win_d, win_a = bt.window_stats(data.x)
        rule = data.idx(bt.CAP_RULE_START)
        for start in (i0, i0 + 20):
            alt_data = shifted(data, start)
            alt = wf.evaluate(alt_data, [t0], n, 3)
            for key in ("fit_ar1", "fit_ao", "climatology_windows", "caps_B"):
                assert alt[0][0][key] == base[0][0][key], (t0, start, key)
            for pol in wf.POLICY_ORDER:
                for prod in wf.PRODUCTS:
                    a, b = base[1][pol][prod][0], alt[1][pol][prod][0]
                    assert a["cap"] == b["cap"]
                    for m in wf.MODELS:  # forecast side (V0, q90) unchanged; the realised outcome does change
                        assert a["models"][m]["V0"] == b["models"][m]["V0"], (t0, pol, prod, m)
                        assert a["models"][m]["q90"] == b["models"][m]["q90"]
            alt_d, alt_a = bt.window_stats(alt_data.x)
            assert bt.pre_origin_caps(alt_d, alt_a, i0, rule) == bt.pre_origin_caps(win_d, win_a, i0, rule)
        assert base[0][0]["climatology_windows"] == i0 - wf.H + 1  # every climatology window ended <= t0 - 1


def test_pre_origin_caps_use_only_windows_that_ended_before_t0(data):
    infos, _ = wf.evaluate(data, wf.origins(), 100, 1)
    rule = data.idx(bt.CAP_RULE_START)
    for t0, info in zip(wf.origins(), infos):
        i0 = data.idx(t0)
        assert info["caps_B"]["n_windows"] == i0 - wf.H + 1 - rule  # last eligible window starts at i0 - 48
        assert info["caps_B"]["cooling"] > 0 and info["caps_B"]["excess"] > 0


def test_the_last_pre_origin_observation_does_enter_the_forecast(data):
    t0 = P("1991-01")
    x = data.x.copy()
    x[data.idx(t0) - 1] += 50_000
    alt = bt.Data(data.periods, x, data.provenance)
    assert wf.fit_ao(alt.y, t0)["x0"] != wf.fit_ao(data.y, t0)["x0"]
    assert wf.fit_ao(alt.y, t0)["resid_sd"] != wf.fit_ao(data.y, t0)["resid_sd"]


# ---------------------------------------------------------------- the random-walk model


def test_ao_sigma_is_the_sample_sd_of_monthly_changes(data):
    t0 = P("1999-01")
    v = data.y[: t0 - 1].to_numpy()
    assert wf.fit_ao(data.y, t0)["resid_sd"] == pytest.approx(np.std(np.diff(v), ddof=1), rel=1e-12)
    w = wf.fit_ao(data.y, P("2021-01"), window=288)
    assert (w["n"], w["first_obs"], w["last_obs"]) == (288, "1997-01", "2020-12")


def test_ao_paths_are_ar1_with_a_0_and_b_1():
    fit = {"a": 0.0, "b": 1.0, "resid_sd": 0.3, "x0": 2.5}
    paths = bt.simulate_paths(fit, 40, np.random.default_rng(5))
    e = np.random.default_rng(5).normal(0.0, 0.3, size=(40, bt.H))
    walk = np.cumsum(np.hstack([np.full((40, 1), 2.5), e]), axis=1)[:, 1:]  # x0 + e_1, then + e_2, ...
    assert np.array_equal(paths, walk)  # driftless random walk from x0, x0 itself not in the output
    assert paths.shape == (40, bt.H)
    ar1 = bt.simulate_paths({**fit, "a": 0.0, "b": 1.0}, 40, np.random.default_rng(5))
    assert np.array_equal(paths, ar1)


def test_ao_row_is_the_random_walk_run_through_the_same_exact_maths(data):
    t0, seed, n = P("2007-01"), 11, 400
    info, out = wf.evaluate_origin(data, t0, n, seed, *_ctx(data))
    fit = wf.fit_ao(data.y, t0)
    d, a = bt.forecast_stats({"a": 0.0, "b": 1.0, "resid_sd": fit["resid_sd"], "x0": fit["x0"]}, n,
                             bt.origin_rng(seed, wf.STREAM_SIM_AO, t0))
    for pol, caps in (("A", bt.FIXED_CAPS), ("B", info["caps_B"])):
        for prod, stat in (("cooling", d), ("excess", a)):
            ref = bt.scores(stat, int(caps[prod])) / bt.ONE
            assert out[pol][prod]["models"]["ao"]["V0"] == pytest.approx(float(ref.mean()), abs=1e-15)


def test_streams_are_distinct_per_model():
    assert len({bt.STREAM_SIM, bt.STREAM_PIT, bt.STREAM_BOOT, wf.STREAM_SIM_AO, wf.STREAM_PIT_AO}) == 5
    t0 = P("2015-01")
    a = bt.origin_rng(1, bt.STREAM_SIM, t0).normal(size=5)
    b = bt.origin_rng(1, wf.STREAM_SIM_AO, t0).normal(size=5)
    assert not np.array_equal(a, b)


def _ctx(data):
    win_d, win_a = bt.window_stats(data.x)
    return win_d, win_a, data.idx(bt.HIST_START), data.idx(bt.CAP_RULE_START)


# ---------------------------------------------------------------- binomial and sign-test arithmetic


def test_binomial_probabilities_are_exact_and_support_the_label():
    t = wf.binom_table()
    ref = scipy.stats.binom(11, 0.1)
    assert t["pmf"] == pytest.approx([ref.pmf(k) for k in range(12)], abs=1e-7)
    assert sum(t["pmf"]) == pytest.approx(1.0, abs=1e-6)
    assert t["P_at_least"][4] == pytest.approx(ref.sf(3), abs=1e-7)
    assert t["P_at_most"][3] == pytest.approx(ref.cdf(3), abs=1e-7)
    assert t["expected_exceedances"] == pytest.approx(1.1)
    assert t["counts_with_pmf_above_5pct"] == [0, 1, 2, 3]  # each of 0, 1, 2, 3 has probability > 5%
    assert min(t["pmf"][:4]) > 0.05 > t["pmf"][4]
    assert t["P_at_least"][3] > 0.05 >= t["P_at_least"][4]
    assert t["smallest_count_with_upper_tail_at_most_5pct"] == 4
    assert t["label"] == "n = 11: cannot validate a 10% tail"
    assert wf.TAIL_LABEL == t["label"]
    assert float(wf.binom_pmf(11, 0, wf.TAIL_P)) == pytest.approx(0.9**11)


def test_sign_test_p_values():
    assert wf.sign_test_p(8, 3) == pytest.approx(2 * scipy.stats.binom(11, 0.5).cdf(3))
    assert wf.sign_test_p(10, 1) == pytest.approx(2 * scipy.stats.binom(11, 0.5).cdf(1))
    assert wf.sign_test_p(5, 5) == 1.0 and wf.sign_test_p(0, 0) is None
    assert wf.sign_test_p(3, 8) == wf.sign_test_p(8, 3)


# ---------------------------------------------------------------- report structure and reproducibility


def test_json_has_eleven_rows_per_policy_and_product(small_report):
    rows = small_report["rows"]
    assert list(rows) == ["B", "A"] and len(small_report["origins"]) == 11
    for pol in rows:
        assert list(rows[pol]) == ["cooling", "excess"]
        for prod in rows[pol]:
            assert [r["t0"] for r in rows[pol][prod]] == [str(t) for t in wf.origins()]
            for r in rows[pol][prod]:
                assert set(r["models"]) == {"ar1", "ao", "clim"} and r["cap"] > 0
                for m in r["models"].values():
                    assert 0.0 <= m["V0"] <= 1.0 and 0.0 <= m["pit"] <= 1.0 and m["crps"] >= 0.0
                    assert isinstance(m["above_q90"], bool) and isinstance(m["pit_above_0_9"], bool)
    assert {r["cap"] for r in rows["A"]["cooling"]} == {80_000} and {r["cap"] for r in rows["A"]["excess"]} == {800_000}


def test_policies_are_labelled_and_never_mixed(small_report):
    text = json.dumps(small_report, ensure_ascii=False)
    assert wf.RETRO == "retrospective: chosen after seeing 2021–24"
    assert wf.RETRO in small_report["summary"]["A"]["label"] and "retrospective" not in small_report["summary"]["B"]["label"]
    assert text.count(wf.RETRO) >= 3
    # policy B caps differ by origin; policy A caps are the same 8 / 80 at every origin
    caps_b = {r["cap"] for r in small_report["rows"]["B"]["cooling"]}
    assert len(caps_b) > 1 and 80_000 not in caps_b


def test_summary_counts_are_consistent_with_the_rows(small_report):
    for pol in wf.POLICY_ORDER:
        for prod in wf.PRODUCTS:
            rows = small_report["rows"][pol][prod]
            s = small_report["summary"][pol][prod]
            assert s["n_origins"] == 11
            for m in wf.MODELS:
                assert s["mean_crps"][m] == pytest.approx(np.mean([r["models"][m]["crps"] for r in rows]), abs=1e-6)
                assert s["tail_exceedances"]["pit_above_0_9"][m]["count"] == sum(r["models"][m]["pit_above_0_9"] for r in rows)
                assert s["tail_exceedances"]["above_q90"][m]["count"] == sum(r["models"][m]["above_q90"] for r in rows)
                assert s["tail_exceedances"]["pit_above_0_9"][m]["expected"] == pytest.approx(1.1)
            best = s["lowest_crps_of_three"]["origins_with_lowest_crps"]
            assert sum(best.values()) >= 11  # every origin has a lowest model; exact ties would count twice
            if s["lowest_crps_of_three"]["origins_with_tied_lowest"] == 0:
                assert sum(best.values()) == 11
            for pair in s["pairwise"].values():
                vals = list(pair.values())
                assert vals[0] + vals[1] + pair["equal"] == 11


def test_reference_origin_block_reports_both_cap_sets_side_by_side(small_report):
    ref = small_report["reference_origin_2021_01"]
    assert ref["t0"] == "2021-01"
    assert [f["key"] for f in ref["fits"]] == ["ar1_all_history", "ar1_1997_2020", "ao_all_history", "ao_1997_2020"]
    assert ref["fits"][1]["fit_sample"] == ref["fits"][3]["fit_sample"] == "1997-01..2020-12"
    assert ref["fits"][0]["fit_sample"] == "1914-01..2020-12"
    assert ref["caps"]["fixed_caps_retrospective"]["cooling"] == 80_000 and ref["caps"]["fixed_caps_retrospective"]["excess"] == 800_000
    assert ref["caps"]["fixed_caps_retrospective"]["label"] == wf.RETRO
    assert ref["caps"]["pre_origin_caps"]["cooling"] != 80_000
    for f in ref["fits"]:
        assert set(f["V0"]) == {"fixed_caps_retrospective", "pre_origin_caps"}
        assert all(set(v) == {"cooling", "excess"} for v in f["V0"].values())
    assert ref["realised_scores_informational"]["fixed_caps_retrospective"] == {"cooling": 0.827387, "excess": 0.86398}


def test_same_inputs_give_byte_identical_output_and_a_different_seed_does_not(data, small_report):
    again = wf.build_report(data, 300, 7)
    assert wf.dumps_report(again) == wf.dumps_report(small_report)
    assert wf.render_markdown(again) == wf.render_markdown(small_report)
    other = wf.build_report(data, 300, 8)
    assert wf.dumps_report(other) != wf.dumps_report(small_report)
    text = wf.dumps_report(small_report)
    assert text.endswith("}\n") and "\r" not in text
    parsed = json.loads(text)
    assert parsed["schema"] == "macropaths-walkforward-v1"
    assert wf.render_markdown(parsed) == wf.render_markdown(small_report)  # the Markdown is generated from the JSON


def test_label_and_provenance_are_written(small_report):
    text = wf.dumps_report(small_report)
    md = wf.render_markdown(small_report)
    assert "n = 11: cannot validate a 10% tail" in text and "## n = 11: cannot validate a 10% tail" in md
    assert wf.RETRO in md
    pv = small_report["provenance"]
    d = pv["data"]
    assert re.fullmatch(r"[0-9a-f]{64}", d["snapshot_sha256"]) and re.fullmatch(r"[0-9a-f]{64}", d["sha256_of_raw"])
    assert d["retrieved_at"] and (pv["seed"], pv["n_paths"]) == (7, 300)
    assert pv["command"] == "pixi run python forecast/walkforward.py --paths 300 --seed 7"
    assert "git_commit_of_forecast_backtest_py" in pv["environment"]
    assert set(pv["code_sha256"]) == {"forecast/walkforward.py", "forecast/backtest.py", "research/macrolib.py",
                                      "tests/make_vectors.py"}
    assert small_report["method"]["origins"]["plan_note"].startswith("The plan said '1975-2017'")
    assert "Atkeson-Ohanian (2001" in small_report["method"]["models"]["ao"]


def test_forbidden_vocabulary_is_absent(small_report):
    words = ["fair" + " value", "be" + "t", "be" + "ts", "be" + "tting", "opti" + "on", "opti" + "ons",
             "insur" + "ance", "opti" + "on-implied"]
    pattern = re.compile(r"\b(" + "|".join(re.escape(w) for w in words) + r")\b", re.IGNORECASE)
    texts = {
        "walkforward.py": (ROOT / "forecast" / "walkforward.py").read_text(encoding="utf-8"),
        "test_walkforward.py": Path(__file__).read_text(encoding="utf-8"),
        "json": wf.dumps_report(small_report),
        "md": wf.render_markdown(small_report),
    }
    for name, text in texts.items():
        assert not pattern.search(text), (name, pattern.search(text).group(0))


# ---------------------------------------------------------------- agreement with backtest.py and the committed outputs


def test_ar1_and_climatology_rows_reproduce_backtest_json_at_the_same_seed(data):
    path = ROOT / "forecast" / "backtest.json"
    if not path.exists():
        pytest.skip("forecast/backtest.json not present")
    bj = json.loads(path.read_text(encoding="utf-8"))
    if bj["settings"]["n_paths"] != 10_000 or bj["settings"]["base_seed"] != bt.DEFAULT_SEED:
        pytest.skip("backtest.json was generated with other settings")
    rows = {r["t0"]: r for r in bj["per_origin"]}
    t0 = P("2015-01")
    _, out = wf.evaluate_origin(data, t0, 10_000, bt.DEFAULT_SEED, *_ctx(data))
    for pol in wf.POLICY_ORDER:
        for prod in wf.PRODUCTS:
            ref = rows[str(t0)][pol][prod]
            mine = bt._round(out[pol][prod]["models"])
            for m in ("ar1", "clim"):
                assert mine[m]["V0"] == pytest.approx(ref[m]["E"], abs=2e-7)
                assert mine[m]["crps"] == pytest.approx(ref[m]["crps"], abs=2e-7)
                assert mine[m]["pit"] == pytest.approx(ref[m]["pit"], abs=2e-7)


def test_committed_outputs_match_a_recomputation(data):
    if not (wf.OUT_JSON.exists() and wf.OUT_MD.exists()):
        pytest.skip("forecast/walkforward.json / .md not generated yet")
    committed = json.loads(wf.OUT_JSON.read_text(encoding="utf-8"))
    rep = wf.build_report(data, committed["provenance"]["n_paths"], committed["provenance"]["seed"])
    assert wf.check(rep, wf.OUT_JSON, wf.OUT_MD) == []
    assert wf.OUT_MD.read_bytes() == wf.render_markdown(rep).encode("utf-8")
    assert b"\r" not in wf.OUT_JSON.read_bytes() and wf.OUT_JSON.read_bytes().endswith(b"}\n")


def test_diff_detects_changes_and_tolerates_rounding_noise():
    a = {"x": [1.0, {"y": 2}], "z": "s"}
    assert wf._diff(a, json.loads(json.dumps(a))) == []
    assert wf._diff(a, {"x": [1.0000001, {"y": 2}], "z": "s"}) == []
    assert wf._diff(a, {"x": [1.001, {"y": 2}], "z": "s"}) != []
    assert wf._diff(a, {"x": [1.0, {"y": 2}], "z": "t"}) != []
    assert wf._diff(a, {"x": [1.0], "z": "s"}) != []


def test_cli_check_and_write_guard(data, tmp_path, monkeypatch, capsys):
    monkeypatch.setattr(wf, "OUT_JSON", tmp_path / "default.json")
    monkeypatch.setattr(wf, "OUT_MD", tmp_path / "default.md")
    assert wf.main(["--paths", "100", "--seed", "3"]) == 0  # non-default settings: nothing is overwritten
    assert not (tmp_path / "default.json").exists()
    j, m = tmp_path / "w.json", tmp_path / "w.md"
    assert wf.main(["--paths", "100", "--seed", "3", "--out-json", str(j), "--out-md", str(m)]) == 0
    assert wf.main(["--paths", "100", "--seed", "3", "--out-json", str(j), "--out-md", str(m), "--check"]) == 0
    assert wf.main(["--paths", "100", "--seed", "4", "--out-json", str(j), "--out-md", str(m), "--check"]) == 1
    j.write_text(j.read_text(encoding="utf-8").replace('"cooling"', '"cooling "', 1), encoding="utf-8")
    assert wf.main(["--paths", "100", "--seed", "3", "--out-json", str(j), "--out-md", str(m), "--check"]) == 1
    assert "MISMATCH" in capsys.readouterr().out
