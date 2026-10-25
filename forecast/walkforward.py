"""Walk-forward forecast-honesty evaluation for MacroPaths (research only, off-chain).

Eleven non-overlapping 48-month windows (origins 1975-01, 1979-01, ..., 2015-01), three forecasts of the
terminal Cooling and Excess scores at every origin (AR(1), an Atkeson-Ohanian random walk, climatology),
two cap policies that are never mixed, and an honest statement of what 11 origins can and cannot show.
It reuses the functions of forecast/backtest.py (fit, simulation, exact integer settlement maths, CRPS,
randomised PIT, pre-origin caps, seed streams) and re-implements none of the maths. Nothing here touches
the program, the keeper or any committed vector.

    pixi run python forecast/walkforward.py            # forecast/walkforward.json + .md
    pixi run python forecast/walkforward.py --check    # recompute and compare with the committed files
    pixi run python forecast/walkforward.py --paths 2000 --seed 7 --out-json /tmp/w.json --out-md /tmp/w.md
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import platform
import subprocess
import sys
from fractions import Fraction
from pathlib import Path

import numpy as np
import pandas as pd
import scipy

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "forecast"))
import backtest as bt  # noqa: E402  (puts research/ and tests/ on sys.path)

OUT_JSON = ROOT / "forecast" / "walkforward.json"
OUT_MD = ROOT / "forecast" / "walkforward.md"

H, ONE, K = bt.H, bt.ONE, bt.K
PRODUCTS = bt.PRODUCTS  # ("cooling", "excess")
MODELS = ("ar1", "ao", "clim")
MODEL_NAMES = {"ar1": "AR(1)", "ao": "Atkeson-Ohanian random walk (AO)", "clim": "climatology"}
POLICY_ORDER = ("B", "A")  # the honest policy first
PIT_POLICY_INDEX = {"A": 0, "B": 1}  # the (policy, product, model) layout of backtest.py's PIT draws
PIT_PRODUCT_INDEX = {"cooling": 0, "excess": 1}

ORIGIN_FIRST = pd.Period("1975-01", "M")
ORIGIN_STEP = H  # 48 months: windows tile the calendar without overlap
N_ORIGINS = 11
DEMO_START = pd.Period("2021-01", "M")
REFERENCE_ORIGIN = DEMO_START
REFERENCE_WINDOW = bt.FIT_WINDOW  # 288 months: 1997-01..2020-12 at the 2021-01 origin

STREAM_SIM_AO = 3  # backtest.py uses 0 (simulation), 1 (PIT), 2 (bootstrap)
STREAM_PIT_AO = 4
TAIL_Q = 0.9
LOWER_Q = 0.1  # lower-tail check: a forecast that runs high puts the realised score below its 10th percentile
TAIL_P = Fraction(1, 10)  # nominal probability of exceeding the model's 90th percentile
TAIL_LABEL = "n = 11: cannot validate a 10% tail"
RETRO = "retrospective: chosen after seeing 2021–24"
POLICY_LABELS = {
    "B": "pre-origin p90 caps (honest)",
    "A": f"fixed caps 8 pp / 80 pp-months ({RETRO})",
}
POLICY_SHORT = {"B": "B (pre-origin p90 caps)", "A": f"A ({RETRO})"}
PAIRS = (("ar1", "ao"), ("ar1", "clim"), ("ao", "clim"))

# ---------------------------------------------------------------------------
# Origins, fits and the random-walk model


def origins(n: int = N_ORIGINS, first: pd.Period = ORIGIN_FIRST, step: int = ORIGIN_STEP) -> list[pd.Period]:
    return [first + step * i for i in range(n)]


def fit_ao(y: pd.Series, t0: pd.Period, hist_start: pd.Period = bt.HIST_START, window: int | None = None) -> dict:
    """Atkeson-Ohanian random-walk fit on the same sample as bt.fit_ar1: observations dated
    hist_start .. t0 - 1 (the last `window` months before t0 when window is given). The forecast is
    AR(1) with a = 0 and b = 1 and innovation sd sigma_delta = the sample sd (ddof = 1) of the monthly
    changes of the year-on-year series over that sample."""
    s = y[hist_start:]
    if window is not None:
        s = s[t0 - window:]
    until = t0 - 1
    v = s[:until].to_numpy()
    dv = np.diff(v)
    return {
        "a": 0.0,
        "b": 1.0,
        "resid_sd": float(np.std(dv, ddof=1)),
        "n": int(len(v)),
        "n_changes": int(len(dv)),
        "first_obs": str(s.index[0]),
        "last_obs": str(until),
        "x0": float(v[-1]),
    }


# ---------------------------------------------------------------------------
# Binomial and sign-test arithmetic (exact rationals, converted to float at the end)


def binom_pmf(n: int, k: int, p: Fraction = TAIL_P) -> Fraction:
    return Fraction(math.comb(n, k)) * p**k * (1 - p) ** (n - k)


def binom_table(n: int = N_ORIGINS, p: Fraction = TAIL_P) -> dict:
    pmf = [binom_pmf(n, k, p) for k in range(n + 1)]
    upper = [sum(pmf[k:], Fraction(0)) for k in range(n + 1)]  # P(X >= k)
    lower = [sum(pmf[: k + 1], Fraction(0)) for k in range(n + 1)]  # P(X <= k)
    five = Fraction(1, 20)
    ok = [k for k in range(n + 1) if pmf[k] > five]
    first_reject = next((k for k in range(n + 1) if upper[k] <= five), None)
    power = {}
    if first_reject is not None:
        for q in (Fraction(1, 5), Fraction(3, 10), Fraction(1, 2)):
            # chance that a forecast whose true exceedance probability is q still gives fewer than first_reject exceedances
            power[str(float(q))] = float(sum((binom_pmf(n, k, q) for k in range(first_reject)), Fraction(0)))
    label_probs = ", ".join(f"{k}: {float(pmf[k]):.3f}" for k in ok)
    if first_reject is None or len(ok) < 2:
        explanation = f"With p = {float(p):g} and n = {n} the exceedance count is too small to test a tail."
    else:
        explanation = (
            f"With p = {float(p):g} and n = {n}, each of {', '.join(str(k) for k in ok[:-1])} and {ok[-1]} exceedances has "
            f"probability above 5% under calibration ({label_probs}), so no count from {ok[0]} to {ok[-1]} can be told "
            f"apart from a calibrated forecast, and the upper tail only reaches P(X >= k) <= 5% at k = {first_reject} "
            f"(P(X >= {first_reject}) = {float(upper[first_reject]):.4f}); a count of {ok[-1] + 1} or more is needed "
            "to question the 90th percentile at all, and nothing here can show it is right."
        )
    return {
        "n": n, "p": float(p), "expected_exceedances": float(n * p),
        "pmf": [float(v) for v in pmf], "P_at_least": [float(v) for v in upper], "P_at_most": [float(v) for v in lower],
        "counts_with_pmf_above_5pct": ok, "smallest_count_with_upper_tail_at_most_5pct": first_reject,
        "chance_of_staying_below_that_count_if_true_exceedance_probability_is": power,
        "label": TAIL_LABEL, "explanation": explanation,
    }


def sign_test_p(wins_a: int, wins_b: int) -> float | None:
    """Two-sided exact sign test (p = 1/2) on the origins where the two models differ."""
    n = wins_a + wins_b
    if n == 0:
        return None
    k = min(wins_a, wins_b)
    tail = sum((Fraction(math.comb(n, i), 2**n) for i in range(k + 1)), Fraction(0))
    return float(min(Fraction(1), 2 * tail))


# ---------------------------------------------------------------------------
# One origin


def model_row(sorted_scores: np.ndarray, y_int: int, v: float) -> dict:
    """V0 (expected score), CRPS, randomised PIT and the two tail flags of one score distribution.
    q90 is the smallest score with F >= 0.9 (inverted CDF), so `y > q90` is the literal 'above the 90th
    percentile'. With mass at the cap that can never fire when q90 is the cap, so the randomised
    PIT u > 0.9 (exactly 10% under calibration, mass points included) is reported next to it."""
    f = sorted_scores / ONE
    q90 = int(np.quantile(sorted_scores, TAIL_Q, method="inverted_cdf"))
    u = bt.randomized_pit(sorted_scores, y_int, v)
    return {
        "V0": float(f.mean()),
        "crps": bt.crps_ensemble(f, y_int / ONE),
        "pit": u,
        "q90": q90 / ONE,
        "above_q90": bool(y_int > q90),
        "pit_above_0_9": bool(u > TAIL_Q),
        "pit_below_0_1": bool(u < LOWER_Q),
    }


def evaluate_origin(data: bt.Data, t0: pd.Period, n_paths: int, seed: int, win_d: np.ndarray, win_a: np.ndarray,
                    hist_idx: int, rule_idx: int) -> tuple[dict, dict]:
    """(origin info, {policy: {product: row}}) with every input restricted to observations dated <= t0 - 1."""
    i0 = data.idx(t0)
    if i0 + H > len(data.x):
        raise ValueError(f"origin {t0}: the data do not supply 48 observations")
    fit_a, fit_o = bt.fit_ar1(data.y, t0), fit_ao(data.y, t0)
    cs = bt.climatology_slice(i0, hist_idx)
    caps_b = bt.pre_origin_caps(win_d, win_a, i0, rule_idx)
    # leakage guards: fits end at t0 - 1, every climatology / cap window ended <= t0 - 1
    if fit_a["last_obs"] != str(t0 - 1) or fit_o["last_obs"] != str(t0 - 1):
        raise AssertionError("a fit uses observations at or after t0")
    if cs.stop > cs.start and cs.stop - 1 + H - 1 > i0 - 1:
        raise AssertionError("climatology holds a window that ends at or after t0")
    if caps_b["n_windows"] != max(0, i0 - H + 1 - rule_idx):
        raise AssertionError("pre-origin caps hold a window that ends at or after t0")
    sims = {
        "ar1": bt.forecast_stats(fit_a, n_paths, bt.origin_rng(seed, bt.STREAM_SIM, t0)),
        "ao": bt.forecast_stats(fit_o, n_paths, bt.origin_rng(seed, STREAM_SIM_AO, t0)),
    }
    real = {"cooling": int(win_d[i0]), "excess": int(win_a[i0])}
    clim = {"cooling": win_d[cs], "excess": win_a[cs]}
    if cs.stop <= cs.start:
        raise ValueError(f"origin {t0}: no completed window for climatology")
    v = bt.origin_rng(seed, bt.STREAM_PIT, t0).random((2, 2, 3))  # as backtest.py: [policy A/B, product, ar1/clim/const]
    v_ao = bt.origin_rng(seed, STREAM_PIT_AO, t0).random((2, 2))
    info = {
        "t0": str(t0),
        "window": f"{t0}..{t0 + H - 1}",
        "fit_ar1": {"n": fit_a["n"], "first_obs": fit_a["first_obs"], "last_obs": fit_a["last_obs"], "a": fit_a["a"],
                    "b": fit_a["b"], "resid_sd": fit_a["resid_sd"], "x0_pct": fit_a["x0"]},
        "fit_ao": {"n": fit_o["n"], "n_changes": fit_o["n_changes"], "first_obs": fit_o["first_obs"],
                   "last_obs": fit_o["last_obs"], "sigma_delta": fit_o["resid_sd"], "x0_pct": fit_o["x0"]},
        "climatology_windows": int(cs.stop - cs.start),
        "caps_B": caps_b,
        "realised_stats": {"D": real["cooling"], "A": real["excess"]},
    }
    out: dict = {}
    for pol, caps in (("A", bt.FIXED_CAPS), ("B", caps_b)):
        out[pol] = {}
        for prod in PRODUCTS:
            cap = int(caps[prod])
            if cap <= 0:
                out[pol][prod] = {"t0": str(t0), "cap": cap, "excluded": "no valid cap (percentile <= 0)"}
                continue
            pi, qi = PIT_POLICY_INDEX[pol], PIT_PRODUCT_INDEX[prod]
            y_int = int(bt.scores(real[prod], cap))
            sim_stat = {"ar1": sims["ar1"][qi], "ao": sims["ao"][qi]}
            models = {
                "ar1": model_row(np.sort(bt.scores(sim_stat["ar1"], cap)), y_int, v[pi, qi, 0]),
                "ao": model_row(np.sort(bt.scores(sim_stat["ao"], cap)), y_int, v_ao[pi, qi]),
                "clim": model_row(np.sort(bt.scores(clim[prod], cap)), y_int, v[pi, qi, 1]),
            }
            out[pol][prod] = {"t0": str(t0), "cap": cap, "realised_stat": real[prod],
                              "realised_score": y_int / ONE, "models": models}
    return info, out


def evaluate(data: bt.Data, origin_list: list[pd.Period], n_paths: int, seed: int) -> tuple[list[dict], dict]:
    win_d, win_a = bt.window_stats(data.x)
    hist_idx, rule_idx = data.idx(bt.HIST_START), data.idx(bt.CAP_RULE_START)
    infos = []
    rows = {pol: {prod: [] for prod in PRODUCTS} for pol in POLICY_ORDER}
    for t0 in origin_list:
        info, out = evaluate_origin(data, t0, n_paths, seed, win_d, win_a, hist_idx, rule_idx)
        infos.append(info)
        for pol in POLICY_ORDER:
            for prod in PRODUCTS:
                rows[pol][prod].append(out[pol][prod])
    return infos, rows


# ---------------------------------------------------------------------------
# Summary per policy / product


def summarize(rows: list[dict]) -> dict:
    valid = [r for r in rows if "models" in r]
    n = len(valid)
    out: dict = {"n_origins": n, "n_excluded": len(rows) - n}
    if not n:
        return out
    crps = {m: np.array([r["models"][m]["crps"] for r in valid]) for m in MODELS}
    best = np.min(np.stack([crps[m] for m in MODELS]), axis=0)
    is_best = {m: crps[m] == best for m in MODELS}
    tied = np.sum(np.stack([is_best[m] for m in MODELS]), axis=0) > 1
    out["mean_crps"] = {m: float(crps[m].mean()) for m in MODELS}
    out["mean_V0"] = {m: float(np.mean([r["models"][m]["V0"] for r in valid])) for m in MODELS}
    out["mean_realised_score"] = float(np.mean([r["realised_score"] for r in valid]))
    out["mean_pit"] = {m: float(np.mean([r["models"][m]["pit"] for r in valid])) for m in MODELS}
    out["lowest_crps_of_three"] = {"origins_with_lowest_crps": {m: int(is_best[m].sum()) for m in MODELS},
                                   "origins_with_tied_lowest": int(tied.sum())}
    pair = {}
    for a, b in PAIRS:
        wa, wb = int(np.sum(crps[a] < crps[b])), int(np.sum(crps[b] < crps[a]))
        pair[f"{a}_vs_{b}"] = {f"{a}_lower_crps": wa, f"{b}_lower_crps": wb, "equal": int(n - wa - wb),
                               "sign_test_p_two_sided": sign_test_p(wa, wb),
                               "mean_crps_difference": float(np.mean(crps[a] - crps[b]))}
    out["pairwise"] = pair
    tail = binom_table(n)
    ex = {}
    for kind, key in (("above_q90", "above_q90"), ("pit_above_0_9", "pit_above_0_9")):
        ex[kind] = {}
        for m in MODELS:
            c = int(sum(r["models"][m][key] for r in valid))
            ex[kind][m] = {"count": c, "expected": tail["expected_exceedances"], "P_at_least": tail["P_at_least"][c],
                           "P_at_most": tail["P_at_most"][c],
                           "inconsistent_with_calibration_at_5pct": bool(tail["smallest_count_with_upper_tail_at_most_5pct"] is not None
                                                                  and c >= tail["smallest_count_with_upper_tail_at_most_5pct"])}
    out["tail_exceedances"] = ex
    low = {}
    for m in MODELS:
        c = int(sum(r["models"][m]["pit_below_0_1"] for r in valid))
        low[m] = {"count": c, "expected": tail["expected_exceedances"], "P_at_least": tail["P_at_least"][c],
                  "P_at_most": tail["P_at_most"][c]}
    out["lower_tail_pit_below_0_1"] = low
    out["origins_with_q90_at_cap"] = {m: int(sum(r["models"][m]["q90"] == 1.0 for r in valid)) for m in MODELS}
    return out


# ---------------------------------------------------------------------------
# The 2021-01 reference origin: V0 under several fits and both cap policies, side by side


def reference_origin(data: bt.Data, n_paths: int, seed: int) -> dict:
    t0 = REFERENCE_ORIGIN
    i0 = data.idx(t0)
    win_d, win_a = bt.window_stats(data.x)
    caps_b = bt.pre_origin_caps(win_d, win_a, i0, data.idx(bt.CAP_RULE_START))
    caps = {"fixed_caps_retrospective": {prod: int(bt.FIXED_CAPS[prod]) for prod in PRODUCTS},
            "pre_origin_caps": {prod: int(caps_b[prod]) for prod in PRODUCTS}}
    real = {"cooling": int(win_d[i0]), "excess": int(win_a[i0])}
    lo = str(t0 - REFERENCE_WINDOW)
    specs = (
        ("ar1_all_history", "AR(1), fitted on all history", "ar1", bt.fit_ar1(data.y, t0)),
        ("ar1_1997_2020", f"AR(1), fitted on {lo}..{t0 - 1} ({REFERENCE_WINDOW} months)", "ar1",
         bt.fit_ar1(data.y, t0, window=REFERENCE_WINDOW)),
        ("ao_all_history", "Atkeson-Ohanian random walk, fitted on all history", "ao", fit_ao(data.y, t0)),
        ("ao_1997_2020", f"Atkeson-Ohanian random walk, fitted on {lo}..{t0 - 1} ({REFERENCE_WINDOW} months)", "ao",
         fit_ao(data.y, t0, window=REFERENCE_WINDOW)),
    )
    fits = []
    for key, name, model, fit in specs:
        stream = bt.STREAM_SIM if model == "ar1" else STREAM_SIM_AO
        sim = dict(zip(PRODUCTS, bt.forecast_stats(fit, n_paths, bt.origin_rng(seed, stream, t0))))
        v0, se = {}, {}
        for cname, cset in caps.items():
            v0[cname], se[cname] = {}, {}
            for prod in PRODUCTS:
                s = bt.scores(sim[prod], cset[prod]) / ONE
                v0[cname][prod], se[cname][prod] = float(s.mean()), float(s.std() / math.sqrt(n_paths))
        fits.append({
            "key": key, "name": name, "model": model, "fit_sample": f"{fit['first_obs']}..{fit['last_obs']}", "n": fit["n"],
            "parameters": ({"a": fit["a"], "b": fit["b"], "resid_sd": fit["resid_sd"]} if model == "ar1"
                           else {"a": 0.0, "b": 1.0, "sigma_delta": fit["resid_sd"]}),
            "x0_pct": fit["x0"], "V0": v0, "mc_se_of_V0": se,
        })
    return {
        "note": "V0 at the 2021-01 origin (the demo window 2021-01..2024-12) under four fits and both cap sets, side by "
                "side. No fit is chosen as 'the' answer. The 2021-01 window is not one of the 11 evaluated origins. Fixed "
                f"caps are {RETRO}.",
        "t0": str(t0), "n_paths": n_paths,
        "caps": {"fixed_caps_retrospective": {**caps["fixed_caps_retrospective"], "label": RETRO},
                 "pre_origin_caps": {**caps["pre_origin_caps"], "n_windows": caps_b["n_windows"]}},
        "realised_stats": {"D": real["cooling"], "A": real["excess"]},
        "realised_scores_informational": {
            cname: {prod: int(bt.scores(real[prod], cset[prod])) / ONE for prod in PRODUCTS} for cname, cset in caps.items()},
        "fits": fits,
    }


# ---------------------------------------------------------------------------
# Report


def _fmt(x, nd=3):
    return "n/a" if x is None else f"{x:.{nd}f}"


def method_block(n_paths: int, seed: int) -> dict:
    first, last = origins()[0], origins()[-1]
    return {
        "question": "How do three forecasts of the terminal Cooling and Excess scores (AR(1), an Atkeson-Ohanian "
                    "random walk, climatology) score on 11 non-overlapping 48-month windows, and what can 11 windows "
                    "show about the calibration of a 90th-percentile tail?",
        "origins": {
            "list": [str(t) for t in origins()],
            "windows": [f"{t}..{t + H - 1}" for t in origins()],
            "spacing_months": ORIGIN_STEP,
            "declared_choice": f"11 origins {first}, {origins()[1]}, ..., {last}; the last window ends {last + H - 1}; "
                               f"none overlaps the {DEMO_START}..{DEMO_START + H - 1} demo window.",
            "plan_note": "The plan said '1975-2017'. 11 non-overlapping 48-month windows span 528 months, but 1975-01..2017-12 "
                         "holds 516, so that range cannot contain 11 windows with both endpoints. Starting at 1975-01 and "
                         "stepping 48 months is the declared choice.",
        },
        "no_look_ahead": {
            "fits": "every fit uses observations dated up to t0 - 1 (bt.fit_ar1 calls macrolib.fit_ou(until = t0 - 1), "
                    "which includes `until`); the AO sigma_delta uses the same sample",
            "caps_B": "only windows that start >= 1960-01 and ended <= t0 - 1",
            "climatology": "only windows (from 1914-01) that ended <= t0 - 1",
            "guards": "evaluate_origin raises if a fit, a climatology window or a cap window reaches t0 or later",
            "release_timing": "as in backtest.py, the forecast at t0 uses CPI for t0 - 1, which BLS publishes in the "
                              "middle of month t0; the release lag is not otherwise modelled, and the values are "
                              "FRED's current ones, not first-release vintages",
        },
        "models": {
            "ar1": "exactly the primary specification of forecast/backtest.py: OLS y_{t+1} = a + b y_t + e on "
                   "1914-01..t0-1, Gaussian innovations with the fitted residual sd (ddof = 2), 48 months from "
                   "x0 = y_(t0-1)",
            "ao": "Atkeson-Ohanian (2001, 'Are Phillips curves useful for forecasting inflation?', Federal Reserve Bank of "
                  "Minneapolis Quarterly Review 25(1)) use the four-quarter random walk as their benchmark: next year's "
                  "inflation is forecast to equal last year's. This is its natural path extension: the 48 forecast "
                  "values start at x_(t0-1) and follow a driftless Gaussian random walk x_{t+1} = x_t + e, "
                  "e ~ N(0, sigma_delta^2), with sigma_delta the sample sd (ddof = 1) of the monthly changes of the "
                  "year-on-year series over the same sample as the AR(1) fit. It is AR(1) with a = 0 and b = 1 "
                  "(simulated by bt.simulate_paths). The path extension, not the point-forecast rule, is this "
                  "analysis's choice",
            "clim": "as forecast/backtest.py: realised scores of every 48-month window that ended <= t0 - 1, from 1914-01",
        },
        "simulation": {
            "n_paths": n_paths, "seed": seed, "horizon": H,
            "streams": "numpy SeedSequence([seed, stream, year*12+month]) via bt.origin_rng; stream 0 AR(1) simulation "
                       "and stream 1 PIT draws (ar1, clim) as in backtest.py, so AR(1) and climatology rows reproduce "
                       "backtest.py's at the same seed and origin; stream 3 AO simulation, stream 4 AO PIT draws",
            "quantisation": "simulated percent -> floor(y * 1e4) contract units, then the exact integer recursions and "
                            "scores of eqs. (2)-(6) (bt.forecast_stats, bt.scores); contract statistics start afresh at "
                            "the first forecast month",
        },
        "cap_policies": {
            "B": {"label": POLICY_LABELS["B"], "rule": bt.CAP_RULE,
                  "use": "applied to simulated, realised and climatology scores of the same origin"},
            "A": {"label": POLICY_LABELS["A"], "caps": dict(bt.FIXED_CAPS), "units": "1e-4 pp and 1e-4 pp-months",
                  "use": "shown as a retrospective demonstration only; never mixed with policy B"},
        },
        "per_origin_and_product": "realised score, V0 (mean forecast score) per model, CRPS per model, randomised PIT per "
                                  "model, and the two 90th-percentile tail flags",
        "metrics": {
            "V0": "mean of the model's score distribution, in [0, 1]; a forecast, not a price",
            "crps": "empirical-distribution CRPS of the score (bt.crps_ensemble, pair term 1/(2n^2))",
            "pit": "randomised PIT u = F(y-) + v (F(y) - F(y-)), seeded v (bt.randomized_pit)",
            "above_q90": f"literal tail exceedance: the realised score is above the model's {TAIL_Q:.0%} quantile "
                         "(inverted-CDF quantile of the model's integer scores). With probability mass at the cap this can "
                         "never fire when that quantile is the cap, so it undercounts for a model that puts more than 10% "
                         "of its mass at the cap",
            "pit_above_0_9": "randomised tail exceedance u > 0.9; probability exactly 10% under calibration, including "
                             "mass points. It is the count compared with Binomial(11, 0.1)",
            "pit_below_0_1": "randomised lower-tail count u < 0.1, also exactly 10% under calibration; a forecast that "
                             "runs high puts the realised score in its lowest decile too often. Read against the same "
                             "binomial",
            "lowest_crps_of_three": "per origin, the model with the lowest CRPS of AR(1), AO and climatology; exact ties "
                                    "count for each tied model and are reported",
            "sign_test": "per pair of models, two-sided exact sign test (p = 1/2) on the origins where the CRPS differs; "
                         "descriptive, 12 comparisons that are not independent",
            "binomial": "exceedance counts are read against Binomial(n = 11, p = 0.1), assuming independent origins",
        },
        "tail_label": TAIL_LABEL,
        "reference_origin_2021_01": "V0 of both products at 2021-01 from AR(1) and AO, each fitted on all history and on "
                                    f"the last {REFERENCE_WINDOW} months (1997-01..2020-12), under fixed caps 8/80 "
                                    f"({RETRO}) and under the 2021-01 pre-origin caps; reported side by side",
        "data_note": "FRED's CPIAUCNS has an empty value at 2025-10; the series is used only up to the first missing value "
                     "and nothing here needs any month after 2024-12",
        "vocabulary": "forecast, position, cover; V0 is a forecast under the physical measure, not a price",
    }


def _git_commit_of(path: str) -> str | None:
    try:
        r = subprocess.run(["git", "log", "-1", "--format=%H", "--", path], cwd=ROOT, capture_output=True, text=True,
                           check=True)
        return r.stdout.strip() or None
    except (OSError, subprocess.CalledProcessError):
        return None


def _sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def command_string(n_paths: int, seed: int) -> str:
    return f"pixi run python forecast/walkforward.py --paths {n_paths} --seed {seed}"


def build_report(data: bt.Data, n_paths: int = 10_000, seed: int = bt.DEFAULT_SEED) -> dict:
    origin_list = origins()
    infos, rows = evaluate(data, origin_list, n_paths, seed)
    summary = {pol: {"label": POLICY_LABELS[pol], **{prod: summarize(rows[pol][prod]) for prod in PRODUCTS}}
               for pol in POLICY_ORDER}
    d = data.provenance
    report = {
        "schema": "macropaths-walkforward-v1",
        "method": method_block(n_paths, seed),
        "provenance": {
            "data": {"series_id": d["series_id"], "snapshot": d["snapshot"], "source_url": d["source_url"],
                     "retrieved_at": d["retrieved_at"], "sha256_of_raw": d["sha256_of_raw"],
                     "snapshot_sha256": d["sha256_of_snapshot_json"], "levels": d["levels"],
                     "first_missing_value": d["first_missing_value"], "yoy": d["yoy"], "n_yoy": d["n_yoy"]},
            "command": command_string(n_paths, seed),
            "seed": seed,
            "n_paths": n_paths,
            "code_sha256": {name: _sha(ROOT / name) for name in
                            ("forecast/walkforward.py", "forecast/backtest.py", "research/macrolib.py",
                             "tests/make_vectors.py")},
            "environment": {  # not compared by --check
                "git_commit_of_forecast_backtest_py": _git_commit_of("forecast/backtest.py"),
                "python": sys.version.split()[0], "numpy": np.__version__, "pandas": pd.__version__,
                "scipy": scipy.__version__, "rng": "numpy default_rng (PCG64)", "platform": platform.platform(),
            },
        },
        "tail_test": binom_table(),
        "summary": summary,
        "reference_origin_2021_01": reference_origin(data, n_paths, seed),
        "origins": infos,
    }
    report["conclusions"] = conclusion_lines(report)
    report["rows"] = {pol: {prod: rows[pol][prod] for prod in PRODUCTS} for pol in POLICY_ORDER}
    return bt._round(report)


def conclusion_lines(rep: dict) -> list[str]:
    L: list[str] = []
    short = {"ar1": "AR(1)", "ao": "AO", "clim": "climatology"}
    n_cmp, sig, capped = 0, [], []
    cells = [(pol, prod) for pol in POLICY_ORDER for prod in PRODUCTS if "mean_crps" in rep["summary"][pol][prod]]
    best = [f"{prod} policy {pol}: {short[min(MODELS, key=lambda k: rep['summary'][pol][prod]['mean_crps'][k])]}"
            for pol, prod in cells]
    gap = max(abs(rep["summary"][pol][prod]["mean_crps"]["ar1"] - rep["summary"][pol][prod]["mean_crps"]["ao"])
              for pol, prod in cells)
    b_all = [o["fit_ar1"]["b"] for o in rep["origins"]]
    high = sum(rep["summary"][pol][prod]["mean_V0"][m] > rep["summary"][pol][prod]["mean_realised_score"]
               for pol, prod in cells for m in MODELS)
    low_txt = "; ".join(
        f"{prod} policy {pol}: AR(1) {rep['summary'][pol][prod]['lower_tail_pit_below_0_1']['ar1']['count']}, AO "
        f"{rep['summary'][pol][prod]['lower_tail_pit_below_0_1']['ao']['count']}, climatology "
        f"{rep['summary'][pol][prod]['lower_tail_pit_below_0_1']['clim']['count']}" for pol, prod in cells)
    k_rej = rep["tail_test"]["smallest_count_with_upper_tail_at_most_5pct"]
    L.append("Lowest mean CRPS of the three models: " + "; ".join(best) + ". These are averages over 11 origins.")
    L.append(f"AR(1) and AO score almost alike: their mean CRPS differ by at most {gap:.4f} in any of the {len(cells)} "
             f"policy/product cells, and the fitted AR(1) coefficient b is {min(b_all):.4f} to {max(b_all):.4f} across "
             "origins, close to the random walk's 1.")
    L.append(f"In {high} of the {len(cells) * len(MODELS)} policy/product/model cells the mean V0 is above the mean "
             "realised score, i.e. the score forecasts ran high on average. Origins whose randomised PIT is below 0.1 "
             f"(11 origins, 1.1 expected per model; a count of {k_rej} or more has probability "
             f"{rep['tail_test']['P_at_least'][k_rej]:.4f} under calibration): " + low_txt + ".")
    for pol in POLICY_ORDER:
        for prod in PRODUCTS:
            x = rep["summary"][pol][prod]
            if "mean_crps" not in x:
                continue
            m, v0, wins, n = x["mean_crps"], x["mean_V0"], x["lowest_crps_of_three"]["origins_with_lowest_crps"], x["n_origins"]
            low = min(MODELS, key=lambda k: m[k])
            L.append(
                f"{prod.capitalize()}, policy {POLICY_SHORT[pol]}: mean CRPS AR(1) {m['ar1']:.4f}, AO {m['ao']:.4f}, "
                f"climatology {m['clim']:.4f}; lowest mean CRPS: {short[low]}. Lowest CRPS of the three at AR(1) "
                f"{wins['ar1']}, AO {wins['ao']}, climatology {wins['clim']} of {n} origins. Mean V0 AR(1) "
                f"{v0['ar1']:.3f}, AO {v0['ao']:.3f}, climatology {v0['clim']:.3f} against a mean realised score of "
                f"{x['mean_realised_score']:.3f}.")
            parts = []
            for a, b in PAIRS:
                p = x["pairwise"][f"{a}_vs_{b}"]
                n_cmp += 1
                if p["sign_test_p_two_sided"] is not None and p["sign_test_p_two_sided"] <= 0.05:
                    sig.append(f"{prod} policy {pol}, {short[a]} vs {short[b]}")
                parts.append(f"{short[a]} lower than {short[b]} at {p[f'{a}_lower_crps']} of {n} (p = "
                             f"{_fmt(p['sign_test_p_two_sided'], 2)})")
            L.append("  Pairwise CRPS, exact two-sided sign test: " + "; ".join(parts) + ".")
            ex = x["tail_exceedances"]["pit_above_0_9"]
            lit = x["tail_exceedances"]["above_q90"]
            L.append(
                f"  Tail: randomised exceedances of the 90th percentile AR(1) {ex['ar1']['count']}, AO {ex['ao']['count']}, "
                f"climatology {ex['clim']['count']} (expected {ex['ar1']['expected']:.1f}); literal 'realised above the "
                f"90th percentile' AR(1) {lit['ar1']['count']}, AO {lit['ao']['count']}, climatology {lit['clim']['count']}.")
            at_cap = x["origins_with_q90_at_cap"]
            if any(at_cap.values()):
                capped.append(f"{prod} policy {pol}: AR(1) {at_cap['ar1']}, AO {at_cap['ao']}, climatology "
                              f"{at_cap['clim']} of {n}")
    L.append("Where a model's 90th percentile of the score equals the cap (more than 10% of its mass at the cap) the "
             "literal 'realised above the 90th percentile' flag cannot fire, because no score exceeds the cap. Origins "
             "with that property: " + "; ".join(capped) + ". The randomised exceedance is the usable count there.")
    sig_txt = ("none of them reaches p <= 0.05" if not sig else
               f"{len(sig)} {'reaches' if len(sig) == 1 else 'reach'} p <= 0.05 (" + "; ".join(sig) + ")")
    L.append(f"Of {n_cmp} pairwise sign tests, {sig_txt}. With {n_cmp} comparisons that are not independent, about "
             f"{n_cmp * 0.05:.1f} would cross 5% by chance alone, so a single small p-value here is not evidence that an "
             "ordering persists.")
    L.append(f"{TAIL_LABEL}. {rep['tail_test']['explanation']}")
    ref = rep["reference_origin_2021_01"]
    spread = []
    for prod in PRODUCTS:
        for cname, cl in (("fixed_caps_retrospective", f"fixed caps 8/80 ({RETRO})"), ("pre_origin_caps", "2021-01 pre-origin caps")):
            vals = [f["V0"][cname][prod] for f in ref["fits"]]
            spread.append(f"{prod} with {cl}, {min(vals):.3f} to {max(vals):.3f}")
    L.append("At the 2021-01 origin the four fits (AR(1) and AO, each on all history and on 1997-01..2020-12) give V0 of: "
             + "; ".join(spread) + ". They are shown side by side and none is chosen as the answer: the spread is the "
             "effect of the fit window and the model, before any question of which one is right.")
    L.append("These are descriptive results for 11 historical 48-month windows between 1975 and 2018. They show how the "
             "three forecasts scored on those windows. They do not show that any model forecasts the 2021–24 window, or "
             "any future window, better than another, and they do not validate a 90th-percentile tail.")
    return L


# ---------------------------------------------------------------------------
# Output


def dumps_report(rep: dict) -> str:
    """Fixed key order; readable top-level sections, then one compact JSON line per origin row."""
    head = {k: v for k, v in rep.items() if k != "rows"}
    text = json.dumps(head, indent=1, ensure_ascii=False)
    if not text.endswith("\n}"):
        raise AssertionError("unexpected json.dumps layout")
    lines = []
    for pi, pol in enumerate(POLICY_ORDER):
        block = []
        for prod in PRODUCTS:
            rows = ",\n".join("    " + json.dumps(r, ensure_ascii=False, separators=(",", ":"))
                              for r in rep["rows"][pol][prod])
            block.append(f'   "{prod}": [\n{rows}\n   ]')
        lines.append(f'  "{pol}": {{\n' + ",\n".join(block) + "\n  }")
    return text[:-2] + ',\n "rows": {\n' + ",\n".join(lines) + "\n }\n}\n"


def _ms(vals, nd=3) -> str:
    return " / ".join(_fmt(v, nd) for v in vals)


def _yn(flags) -> str:
    return " / ".join("Y" if f else "-" for f in flags)


def render_markdown(r: dict) -> str:
    L: list[str] = []
    w = L.append
    sm, tail, ref, mt = r["summary"], r["tail_test"], r["reference_origin_2021_01"], r["method"]
    w("# MacroPaths walk-forward forecast-honesty evaluation")
    w("")
    w("Research only, off-chain. Generated by `forecast/walkforward.py` from `forecast/walkforward.json`; every number "
      "below comes from that file.")
    w("")
    w("## Conclusions")
    w("")
    for line in r["conclusions"]:
        w(f"- {line.strip()}" if not line.startswith("  ") else f"  - {line.strip()}")
    w("")
    w(f"## {TAIL_LABEL}")
    w("")
    w(tail["explanation"])
    w("")
    w("| Exceedances k | P(X = k) | P(X >= k) | P(X <= k) |")
    w("|---|---|---|---|")
    for k in range(tail["n"] + 1):
        w(f"| {k} | {tail['pmf'][k]:.4f} | {tail['P_at_least'][k]:.4f} | {tail['P_at_most'][k]:.4f} |")
    w("")
    pw = tail["chance_of_staying_below_that_count_if_true_exceedance_probability_is"]
    k_rej = tail["smallest_count_with_upper_tail_at_most_5pct"]
    w(f"Power is just as poor: a forecast whose true exceedance probability is 0.2, 0.3 or 0.5 (twice, three times or "
      f"five times nominal) still gives fewer than {k_rej} exceedances with probability "
      f"{pw['0.2']:.3f}, {pw['0.3']:.3f} and {pw['0.5']:.3f}. Zero exceedances is itself unremarkable "
      f"(P = {tail['pmf'][0]:.3f}), so a 90th percentile that is too high cannot be detected either. The count that is "
      "compared with the binomial is the randomised one (u > 0.9), which is exactly 10% under calibration. A count of "
      f"{k_rej} or more is visible even with 11 origins (P = {tail['P_at_least'][k_rej]:.4f} under calibration), so "
      "gross departures can be flagged; what 11 origins cannot do is confirm that a 10% tail is right.")
    w("")
    w("## Summary by cap policy and product")
    w("")
    w(f"Policy B uses {POLICY_LABELS['B']}. Policy A uses {POLICY_LABELS['A']}. The two are never mixed.")
    w("")
    w("| Policy | Product | Origins | Mean CRPS: AR(1) / AO / clim | Lowest CRPS of three: AR(1) / AO / clim | "
      "Upper tail, randomised u > 0.9: AR(1) / AO / clim (expected 1.1) | Realised above q90: AR(1) / AO / clim | "
      "Lower tail, randomised u < 0.1: AR(1) / AO / clim (expected 1.1) |")
    w("|---|---|---|---|---|---|---|---|")
    for pol in POLICY_ORDER:
        for prod in PRODUCTS:
            x = sm[pol][prod]
            if "mean_crps" not in x:
                w(f"| {POLICY_SHORT[pol]} | {prod} | 0 | n/a | n/a | n/a | n/a | n/a |")
                continue
            ex, lit = x["tail_exceedances"]["pit_above_0_9"], x["tail_exceedances"]["above_q90"]
            lo = x["lower_tail_pit_below_0_1"]
            w(f"| {POLICY_SHORT[pol]} | {prod} | {x['n_origins']} | {_ms([x['mean_crps'][m] for m in MODELS], 4)} | "
              f"{' / '.join(str(x['lowest_crps_of_three']['origins_with_lowest_crps'][m]) for m in MODELS)} | "
              f"{' / '.join(str(ex[m]['count']) for m in MODELS)} | {' / '.join(str(lit[m]['count']) for m in MODELS)} | "
              f"{' / '.join(str(lo[m]['count']) for m in MODELS)} |")
    w("")
    w("Pairwise CRPS comparisons (number of origins with the lower CRPS, then the two-sided exact sign-test p):")
    w("")
    w("| Policy | Product | AR(1) vs AO | AR(1) vs clim | AO vs clim |")
    w("|---|---|---|---|---|")
    for pol in POLICY_ORDER:
        for prod in PRODUCTS:
            x = sm[pol][prod]
            if "pairwise" not in x:
                continue
            cells = []
            for a, b in PAIRS:
                p = x["pairwise"][f"{a}_vs_{b}"]
                cells.append(f"{p[f'{a}_lower_crps']} vs {p[f'{b}_lower_crps']} (p = {_fmt(p['sign_test_p_two_sided'], 2)})")
            w(f"| {POLICY_SHORT[pol]} | {prod} | " + " | ".join(cells) + " |")
    w("")
    w("Randomised tail counts read against Binomial(11, 0.1); P(X >= k) is the probability of a count at least as large as "
      "the one observed under calibration:")
    w("")
    w("| Policy | Product | Model | Upper tail count (u > 0.9) | P(X >= k) | Lower tail count (u < 0.1) | P(X >= k) |")
    w("|---|---|---|---|---|---|---|")
    for pol in POLICY_ORDER:
        for prod in PRODUCTS:
            x = sm[pol][prod]
            if "tail_exceedances" not in x:
                continue
            for m in MODELS:
                e, lo = x["tail_exceedances"]["pit_above_0_9"][m], x["lower_tail_pit_below_0_1"][m]
                w(f"| {POLICY_SHORT[pol]} | {prod} | {MODEL_NAMES[m]} | {e['count']} | {e['P_at_least']:.4f} | "
                  f"{lo['count']} | {lo['P_at_least']:.4f} |")
    w("")
    w("Mean forecast and realised scores (V0 is a forecast, not a price):")
    w("")
    w("| Policy | Product | Mean V0: AR(1) / AO / clim | Mean realised score | Mean PIT: AR(1) / AO / clim |")
    w("|---|---|---|---|---|")
    for pol in POLICY_ORDER:
        for prod in PRODUCTS:
            x = sm[pol][prod]
            if "mean_V0" not in x:
                continue
            w(f"| {POLICY_SHORT[pol]} | {prod} | {_ms([x['mean_V0'][m] for m in MODELS])} | "
              f"{_fmt(x['mean_realised_score'])} | {_ms([x['mean_pit'][m] for m in MODELS])} |")
    w("")
    w("## The 11 origins")
    w("")
    w("| Origin | Window | AR(1) fit: n, b, resid sd | AO sigma_delta | Climatology windows | Realised D | Realised A | "
      "Pre-origin cap B: Cooling / Excess |")
    w("|---|---|---|---|---|---|---|---|")
    for o in r["origins"]:
        f, a = o["fit_ar1"], o["fit_ao"]
        w(f"| {o['t0']} | {o['window']} | {f['n']}, {f['b']:.4f}, {f['resid_sd']:.4f} | {a['sigma_delta']:.4f} | "
          f"{o['climatology_windows']} | {o['realised_stats']['D']} | {o['realised_stats']['A']} | "
          f"{o['caps_B']['cooling']} / {o['caps_B']['excess']} ({o['caps_B']['n_windows']} windows) |")
    w("")
    w("D and A are the realised contract statistics in 1e-4 pp and 1e-4 pp-months. Triples below read AR(1) / AO / clim.")
    w("")
    for pol in POLICY_ORDER:
        for prod in PRODUCTS:
            w(f"### Policy {POLICY_SHORT[pol]}, {prod}")
            w("")
            if pol == "A":
                w(f"Caps 8 pp and 80 pp-months were {RETRO}.")
                w("")
            w("| Origin | Cap | Realised | V0 | CRPS | PIT | Above q90 | PIT > 0.9 |")
            w("|---|---|---|---|---|---|---|---|")
            for row in r["rows"][pol][prod]:
                if "models" not in row:
                    w(f"| {row['t0']} | {row['cap']} | n/a | excluded: {row['excluded']} | | | | |")
                    continue
                mo = row["models"]
                w(f"| {row['t0']} | {row['cap']} | {row['realised_score']:.3f} | {_ms([mo[m]['V0'] for m in MODELS])} | "
                  f"{_ms([mo[m]['crps'] for m in MODELS])} | {_ms([mo[m]['pit'] for m in MODELS], 2)} | "
                  f"{_yn([mo[m]['above_q90'] for m in MODELS])} | {_yn([mo[m]['pit_above_0_9'] for m in MODELS])} |")
            w("")
    w("## Reference origin 2021-01")
    w("")
    w(ref["note"])
    w("")
    cb = ref["caps"]["pre_origin_caps"]
    w(f"Pre-origin caps at 2021-01: Cooling {cb['cooling']} ({cb['cooling'] / 1e4:.4f} pp), Excess {cb['excess']} "
      f"({cb['excess'] / 1e4:.4f} pp-months), from {cb['n_windows']} windows. Fixed caps: Cooling "
      f"{ref['caps']['fixed_caps_retrospective']['cooling']}, Excess {ref['caps']['fixed_caps_retrospective']['excess']} "
      f"({RETRO}).")
    w("")
    w(f"| Fit | Sample | Parameters | V0 Cooling, fixed caps 8/80 ({RETRO}) | V0 Excess, fixed caps 8/80 ({RETRO}) | "
      "V0 Cooling, 2021-01 pre-origin caps | V0 Excess, 2021-01 pre-origin caps |")
    w("|---|---|---|---|---|---|---|")
    for f in ref["fits"]:
        p = f["parameters"]
        par = (f"a {p['a']:.4f}, b {p['b']:.4f}, sd {p['resid_sd']:.4f}" if "resid_sd" in p
               else f"a 0, b 1, sigma_delta {p['sigma_delta']:.4f}")
        v, se = f["V0"], f["mc_se_of_V0"]
        fx, pb = "fixed_caps_retrospective", "pre_origin_caps"
        w(f"| {f['name']} | {f['fit_sample']} (n {f['n']}) | {par} | {v[fx]['cooling']:.4f} ± {se[fx]['cooling']:.4f} | "
          f"{v[fx]['excess']:.4f} ± {se[fx]['excess']:.4f} | {v[pb]['cooling']:.4f} ± {se[pb]['cooling']:.4f} | "
          f"{v[pb]['excess']:.4f} ± {se[pb]['excess']:.4f} |")
    rs = ref["realised_scores_informational"]
    w(f"| Realised score of 2021-01..2024-12 (informational; outside the 11 evaluated origins) | | | "
      f"{rs['fixed_caps_retrospective']['cooling']:.4f} | {rs['fixed_caps_retrospective']['excess']:.4f} | "
      f"{rs['pre_origin_caps']['cooling']:.4f} | {rs['pre_origin_caps']['excess']:.4f} |")
    w("")
    w("± is the Monte Carlo standard error of V0. The AR(1) rows use the same seed and stream as `forecast/backtest.py`'s "
      "primary and 288-month variant, so they reproduce its 2021-01 numbers.")
    w("")
    w("## Method")
    w("")
    o = mt["origins"]
    w(f"- **Origins.** {o['declared_choice']} {o['plan_note']}")
    w(f"- **No look-ahead.** Fits: {mt['no_look_ahead']['fits']}. Pre-origin caps use {mt['no_look_ahead']['caps_B']}. "
      f"Climatology uses {mt['no_look_ahead']['climatology']}. {mt['no_look_ahead']['guards']}.")
    w(f"- **Release timing.** {mt['no_look_ahead']['release_timing'][0].upper()}{mt['no_look_ahead']['release_timing'][1:]}.")
    for m in MODELS:
        w(f"- **{MODEL_NAMES[m]}.** {mt['models'][m]}.")
    w(f"- **Simulation.** {mt['simulation']['n_paths']} paths, {mt['simulation']['horizon']} months, base seed "
      f"{mt['simulation']['seed']}. {mt['simulation']['streams']}. {mt['simulation']['quantisation']}.")
    rule = mt["cap_policies"]["B"]["rule"]
    w(f"- **Cap policy B.** {mt['cap_policies']['B']['label']}: {rule['statistic']}; eligible windows: "
      f"{rule['eligible_windows']}; rounding: {rule['rounding']}.")
    w(f"- **Cap policy A.** {mt['cap_policies']['A']['label']}.")
    titles = {"V0": "V0", "crps": "CRPS", "pit": "Randomised PIT", "above_q90": "Literal tail exceedance",
              "pit_above_0_9": "Randomised upper-tail count", "pit_below_0_1": "Randomised lower-tail count",
              "lowest_crps_of_three": "Lowest CRPS of three", "sign_test": "Sign test", "binomial": "Binomial reading"}
    for key, text in mt["metrics"].items():
        w(f"- **{titles[key]}.** {text}.")
    w("")
    d = r["provenance"]["data"]
    pv = r["provenance"]
    w("## Data and reproducibility")
    w("")
    w(f"- Series {d['series_id']}, snapshot `{d['snapshot']}` (sha256 `{d['snapshot_sha256']}`), retrieved "
      f"{d['retrieved_at']}, raw sha256 `{d['sha256_of_raw']}`; levels {d['levels']}, year-on-year {d['yoy']} "
      f"({d['n_yoy']} months). {mt['data_note']}.")
    w(f"- Command `{pv['command']}`; seed {pv['seed']}, {pv['n_paths']} paths.")
    w("- Code sha256: " + ", ".join(f"`{k}` {v[:12]}…" for k, v in pv["code_sha256"].items()) + ".")
    w("- The JSON also records the git commit of `forecast/backtest.py` and the Python, numpy, pandas and scipy versions "
      "(`provenance.environment`; not compared by `--check`).")
    w("")
    w("```bash")
    w("pixi run fetch                                  # only if data/snapshots/CPIAUCNS.json is missing (gitignored)")
    w("pixi run pytest tests/research -q")
    w("pixi run python forecast/walkforward.py         # writes forecast/walkforward.json and forecast/walkforward.md")
    w("pixi run python forecast/walkforward.py --check # recompute and compare with the committed files")
    w("```")
    w("")
    return "\n".join(L)


# ---------------------------------------------------------------------------
# --check


def _diff(a, b, path="", tol=2e-7) -> list[str]:
    """Paths where two parsed JSON values differ; floats may differ by `tol` (the rounding unit is 1e-7)."""
    if isinstance(a, dict) and isinstance(b, dict):
        out = []
        if list(a) != list(b):
            out.append(f"{path or '/'}: keys {list(a)[:6]} != {list(b)[:6]}")
        for k in a:
            if k in b:
                out += _diff(a[k], b[k], f"{path}/{k}", tol)
        return out
    if isinstance(a, list) and isinstance(b, list):
        if len(a) != len(b):
            return [f"{path}: length {len(a)} != {len(b)}"]
        return [d for i, (x, y) in enumerate(zip(a, b)) for d in _diff(x, y, f"{path}[{i}]", tol)]
    if isinstance(a, bool) or isinstance(b, bool) or a is None or b is None:
        return [] if a is b else [f"{path}: {a!r} != {b!r}"]
    if isinstance(a, (int, float)) and isinstance(b, (int, float)):
        return [] if abs(a - b) <= tol else [f"{path}: {a!r} != {b!r}"]
    return [] if a == b else [f"{path}: {str(a)[:60]!r} != {str(b)[:60]!r}"]


def check(rep: dict, json_path: Path, md_path: Path) -> list[str]:
    problems = []
    if not json_path.exists():
        return [f"{json_path} is missing"]
    committed = json.loads(json_path.read_text(encoding="utf-8"))
    fresh = json.loads(json.dumps(rep, ensure_ascii=False))
    for doc in (committed, fresh):
        doc.get("provenance", {}).pop("environment", None)
    problems += _diff(committed, fresh)
    if not md_path.exists():
        problems.append(f"{md_path} is missing")
    elif md_path.read_text(encoding="utf-8") != render_markdown(rep):
        problems.append(f"{md_path} differs from the Markdown rendered from the recomputed report")
    return problems


def write_text_lf(path: Path, text: str) -> None:
    with open(path, "w", encoding="utf-8", newline="\n") as fh:
        fh.write(text)


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--paths", type=int, default=10_000, help="simulated paths per origin and model")
    ap.add_argument("--seed", type=int, default=bt.DEFAULT_SEED)
    ap.add_argument("--check", action="store_true",
                    help="recompute and compare with the committed JSON and Markdown (writes nothing; exit 1 on a mismatch)")
    ap.add_argument("--out-json", default=None)
    ap.add_argument("--out-md", default=None)
    args = ap.parse_args(argv)
    data = bt.load_data()
    rep = build_report(data, args.paths, args.seed)
    out_json = Path(args.out_json) if args.out_json else OUT_JSON
    out_md = Path(args.out_md) if args.out_md else OUT_MD
    if args.check:
        problems = check(rep, out_json, out_md)
        if problems:
            print(f"MISMATCH between the recomputed report and {out_json.name} / {out_md.name}:")
            for p in problems[:20]:
                print(f"  {p}")
            return 1
        print(f"OK: {out_json.name} and {out_md.name} match the recomputed report ({args.paths} paths, seed {args.seed})")
        return 0
    default_run = args.paths == 10_000 and args.seed == bt.DEFAULT_SEED
    if default_run or args.out_json or args.out_md:
        write_text_lf(out_json, dumps_report(rep))
        write_text_lf(out_md, render_markdown(rep))
        print(f"wrote {out_json}")
        print(f"wrote {out_md}")
    else:
        print("non-default --paths/--seed: not overwriting the committed files (pass --out-json and --out-md to write)")
    for line in rep["conclusions"]:
        print(f"- {line.strip()}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
