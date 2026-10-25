"""Rolling-origin backtest of the AR(1) score forecast for MacroPaths (research only, off-chain).

Question: does an AR(1) forecast of year-on-year CPI predict the terminal scores of the two
products (Inflation Cooling: capped largest decline from the running peak; Excess Inflation:
capped accumulated excess above 4%) better than historical climatology or a constant 0.5?

Specification: macropaths-maths.md section 5 (walk-forward origins, proper scoring rules,
coverage, randomised PIT; the Monte Carlo bound 1/(2 sqrt N) is for the expected score only)
and section 6.3 (the seller's price is a declared asking policy, evaluated separately here).
Nothing here touches the program, the keeper or any committed vector.

    pixi run python forecast/backtest.py           # full run: forecast/backtest.json + .md
    pixi run python forecast/backtest.py --quick   # smoke run: 3 origins, N=500, prints only
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import platform
import sys
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import pandas as pd
import scipy
import scipy.stats
import statsmodels
from statsmodels.stats.diagnostic import acorr_ljungbox
from statsmodels.tsa.stattools import acf

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "research"))
sys.path.insert(0, str(ROOT / "tests"))
import macrolib  # noqa: E402  OLS AR(1); fit_ou slices s[:Period(until)], which INCLUDES `until`
import make_vectors as mv  # noqa: E402  exact contract maths, eqs. (1)-(6)

SNAPSHOT = ROOT / "data" / "snapshots" / "CPIAUCNS.json"
OUT_JSON = ROOT / "forecast" / "backtest.json"
OUT_MD = ROOT / "forecast" / "backtest.md"

H = mv.N_OBS  # 48 contracted monthly observations
K = mv.K  # 40000 = 4% in 1e-4 pp
ONE = mv.ONE  # 10^6: scores in millionths
PRODUCTS = ("cooling", "excess")
POLICIES = ("A", "B")
MODELS = ("ar1", "clim", "const")
FIXED_CAPS = {"cooling": mv.DCAP, "excess": mv.ACAP}  # 8 pp, 80 pp-months: chosen after 2021-24
ORIGIN_FIRST = pd.Period("1965-01", "M")
ORIGIN_LAST = pd.Period("2021-01", "M")
HIST_START = pd.Period("1914-01", "M")  # first YoY value: fit and climatology start (primary)
CAP_RULE_START = pd.Period("1960-01", "M")
CAP_Q = 0.9
CAP_RULE = {
    "statistic": "90th percentile of the exact integer statistic over eligible 48-month windows",
    "eligible_windows": "start >= 1960-01 (declared post-1960 rule) and end <= t0 - 1",
    "interpolation": "linear between order statistics (Hyndman-Fan type 7; numpy 'linear', "
    "the pandas Series.quantile default used by research/build_notebook.py)",
    "rounding": "round half up to an integer in contract units (declared here: the repo has no "
    "integer rounding rule)",
    "no_valid_cap": "a percentile <= 0 gives no valid cap (the program needs cap > 0 and the notebook "
    "skips such products): that product is excluded from policy B at that origin and counted",
    "source": "research/README.md ('p90 ... post-1960 (or series-start) windows'), "
    "research/build_notebook.py (CAP_WINDOW_START = 1960-01, stats.quantile(0.9))",
}
KAPPA = 0.5  # team plan: p = clamp(V + 0.5 sigma, 0.05, 0.95)
KAPPAS = (0.0, 0.25, 0.5, 1.0)
QUOTE_MIN, QUOTE_MAX = 0.05, 0.95  # on-chain QUOTE_MIN / QUOTE_MAX
FIT_WINDOW = 288  # rolling-window variant: 24 years, i.e. 1997-01..2020-12 at the 2021-01 origin
BLOCKS = (12, 24, 48, 96)
DECISION_BLOCKS = (24, 48, 96)
DEFAULT_SEED = 20261025
INNOVATIONS = ("gaussian", "iid_resid", "block12_resid")
SELECTED_ORIGINS = ("1965-01", "1975-01", "1985-01", "1995-01", "2005-01", "2015-01", "2021-01")
STREAM_SIM, STREAM_PIT, STREAM_BOOT = 0, 1, 2

# ---------------------------------------------------------------------------
# Data


@dataclass(frozen=True)
class Data:
    periods: pd.PeriodIndex  # month of each x value
    x: np.ndarray  # exact contract YoY, int64, 1e-4 pp (eq. 1)
    provenance: dict

    @property
    def y(self) -> pd.Series:
        """The float view used by the model: percent."""
        return pd.Series(self.x / 1e4, index=self.periods, name="cpi_yoy_pct")

    def idx(self, p: pd.Period) -> int:
        return (p - self.periods[0]).n


def load_data(path: Path = SNAPSHOT) -> Data:
    """Exact YoY from the frozen FRED snapshot: x_t = floor(10^6 (P_t - P_{t-12}) / P_{t-12})."""
    raw = path.read_bytes()
    snap = json.loads(raw)
    # Use the contiguous run of published levels up to the first missing value. FRED's CPIAUCNS has
    # an empty cell for 2025-10 (that month's CPI was not published); nothing after it is needed.
    rows, first_missing = [], None
    expect = snap["rows"][0]["date"]
    for r in snap["rows"]:
        if r["date"] != expect:
            raise ValueError(f"gap or disorder at {r['date']} (expected {expect})")
        if r["value_str"] in ("", "."):
            first_missing = r["date"][:7]
            break
        rows.append(r)
        expect = mv.next_month(expect)
    scale = max(mv.frac_digits(r["value_str"]) for r in rows)
    p = [mv.to_scaled_int(r["value_str"], scale) for r in rows]
    x = np.array([mv.yoy(p[i], p[i - 12]) for i in range(12, len(p))], dtype=np.int64)
    periods = pd.period_range(rows[12]["date"][:7], periods=len(x), freq="M")
    try:
        shown = str(path.resolve().relative_to(ROOT))
    except ValueError:
        shown = str(path)
    prov = {
        "series_id": snap.get("id"),
        "snapshot": shown,
        "source_url": snap.get("source_url"),
        "retrieved_at": snap.get("retrieved_at"),
        "sha256_of_raw": snap.get("sha256_of_raw"),
        "sha256_of_snapshot_json": hashlib.sha256(raw).hexdigest(),
        "levels": f"{rows[0]['date'][:7]}..{rows[-1]['date'][:7]}",
        "first_missing_value": first_missing,
        "rows_in_snapshot": len(snap["rows"]),
        "yoy": f"{periods[0]}..{periods[-1]}",
        "n_yoy": int(len(x)),
        "level_decimal_scale": scale,
    }
    return Data(periods, x, prov)


# ---------------------------------------------------------------------------
# Contract statistics and scores (exact, integer)


def path_stats(paths, k: int = K) -> tuple[np.ndarray, np.ndarray]:
    """Eqs. (2)-(4) from a fresh state on every row (M_{-1} = -inf, D = A = 0).
    Returns (D, A) as int64: largest decline from the running peak, accumulated excess above k."""
    paths = np.asarray(paths, dtype=np.int64)
    if paths.ndim == 1:
        paths = paths[None, :]
    peak = np.maximum.accumulate(paths, axis=1)
    return (peak - paths).max(axis=1), np.maximum(paths - k, 0).sum(axis=1)


def window_stats(x, h: int = H, k: int = K) -> tuple[np.ndarray, np.ndarray]:
    """D and A of every window x[s:s+h]; index = window start."""
    return path_stats(np.lib.stride_tricks.sliding_window_view(np.asarray(x, dtype=np.int64), h), k)


def scores(stat, cap: int) -> np.ndarray:
    """Eq. (6): floor(10^6 min(stat, cap) / cap) in millionths, as make_vectors.score / math::score."""
    if cap <= 0:
        raise ValueError("cap must be positive")
    s = np.clip(np.asarray(stat, dtype=np.int64), 0, cap)
    return (ONE * s) // cap


def quantile_cap(stats, q: float = CAP_Q) -> int:
    """Type-7 (linear) percentile, rounded half up to an integer cap."""
    v = float(np.quantile(np.asarray(stats, dtype=np.float64), q, method="linear"))
    return int(math.floor(v + 0.5))


def climatology_slice(i0: int, hist_idx: int, h: int = H) -> slice:
    """Window starts s with hist_idx <= s and s + h - 1 <= i0 - 1: every window ended before t0."""
    return slice(hist_idx, max(hist_idx, i0 - h + 1))


def pre_origin_caps(win_d, win_a, i0: int, rule_idx: int, h: int = H) -> dict:
    """Policy B caps from windows that start >= 1960-01 and ended before t0. 0 = no valid cap."""
    sl = climatology_slice(i0, rule_idx, h)
    n = sl.stop - sl.start
    if n <= 0:
        return {"cooling": 0, "excess": 0, "n_windows": 0}
    return {"cooling": quantile_cap(win_d[sl]), "excess": quantile_cap(win_a[sl]), "n_windows": n}


# ---------------------------------------------------------------------------
# AR(1): fit strictly before t0, simulate 48 months


def fit_ar1(y: pd.Series, t0: pd.Period, hist_start: pd.Period = HIST_START, window: int | None = None) -> dict:
    """OLS AR(1) on observations dated hist_start .. t0 - 1 via macrolib.fit_ou(until = t0 - 1).
    fit_ou slices s[:Period(until)], which includes `until`, so passing t0 - 1 uses exactly the
    observations dated strictly before t0 (tested). window = n restricts the fit to the last n
    months before t0 (a rolling window)."""
    s = y[hist_start:]
    if window is not None:
        s = s[t0 - window:]
    until = t0 - 1
    fit = macrolib.fit_ou(s, until=str(until))
    v = s[:until].to_numpy()
    if len(v) != fit["n"]:
        raise AssertionError("fit_ou cut-off differs from s[:t0-1]")
    resid = v[1:] - (fit["a"] + fit["b"] * v[:-1])
    return {
        "a": float(fit["a"]),
        "b": float(fit["b"]),
        "resid_sd": float(fit["resid_sd"]),
        "n": int(fit["n"]),
        "first_obs": str(s.index[0]),
        "last_obs": str(until),
        "x0": float(v[-1]),
        "resid": resid,
    }


def simulate_paths(fit: dict, n_paths: int, rng, innovation: str = "gaussian", h: int = H) -> np.ndarray:
    """n_paths x h future YoY values (percent). x0 starts the recursion but is not in the output.
    Gaussian draws are taken exactly as macrolib.simulate_ar1 takes them (tested equal)."""
    if innovation == "gaussian":
        e = rng.normal(0.0, fit["resid_sd"], size=(n_paths, h))
    elif innovation == "iid_resid":
        e = rng.choice(fit["resid"], size=(n_paths, h), replace=True)
    elif innovation == "block12_resid":
        r = fit["resid"]
        starts = rng.integers(0, len(r) - 12 + 1, size=(n_paths, h // 12))
        e = r[starts[:, :, None] + np.arange(12)].reshape(n_paths, h)
    else:
        raise ValueError(f"unknown innovation {innovation!r}")
    out = np.empty((n_paths, h))
    x = np.full(n_paths, fit["x0"])
    for t in range(h):
        x = fit["a"] + fit["b"] * x + e[:, t]
        out[:, t] = x
    return out


def quantize(paths_pct: np.ndarray) -> np.ndarray:
    """Percent -> contract units (1e-4 pp), floored like eq. (1)."""
    return np.floor(paths_pct * 1e4).astype(np.int64)


def forecast_stats(fit: dict, n_paths: int, rng, innovation: str = "gaussian") -> tuple[np.ndarray, np.ndarray]:
    """(D, A) of every simulated path, computed from a fresh state at the first forecast month."""
    return path_stats(quantize(simulate_paths(fit, n_paths, rng, innovation)))


def origin_rng(base_seed: int, stream: int, t0: pd.Period) -> np.random.Generator:
    """One independent, subset-invariant stream per (seed, purpose, origin month)."""
    return np.random.default_rng(np.random.SeedSequence([base_seed, stream, t0.year * 12 + t0.month]))


# ---------------------------------------------------------------------------
# Scoring rules and calibration


def crps_ensemble(samples, y: float, fair: bool = False) -> float:
    """CRPS of the empirical distribution of `samples` at outcome y:
    mean|X - y| - (1 / (2 n^2)) sum_ij |X_i - X_j|, with the pair term from the sorted sample as
    sum_i (2i - n - 1) X_(i) / n^2. fair=True uses 1 / (2 n (n - 1)) instead (unbiased for the
    distribution the sample was drawn from)."""
    x = np.sort(np.asarray(samples, dtype=np.float64))
    n = x.size
    half_pairs = float(np.dot(2.0 * np.arange(1, n + 1) - n - 1, x))  # = (1/2) sum_ij |X_i - X_j|
    mae = float(np.abs(x - y).mean())
    if fair:
        return mae - half_pairs / (n * (n - 1)) if n > 1 else mae
    return mae - half_pairs / (n * n)


def crps_pairwise(samples, y: float) -> float:
    """Direct O(n^2) reference."""
    x = np.asarray(samples, dtype=np.float64)
    return float(np.abs(x - y).mean() - 0.5 * np.abs(x[:, None] - x[None, :]).mean())


def randomized_pit(sorted_samples: np.ndarray, y, v: float) -> float:
    """u = F(y-) + v (F(y) - F(y-)): uniform under calibration even with mass points."""
    n = sorted_samples.size
    lo = np.searchsorted(sorted_samples, y, side="left") / n
    hi = np.searchsorted(sorted_samples, y, side="right") / n
    return float(lo + v * (hi - lo))


def block_bootstrap_means(d, block: int, n_boot: int, rng) -> np.ndarray:
    """Moving-block bootstrap of the mean of a time-ordered series (block = 1: i.i.d. bootstrap)."""
    d = np.asarray(d, dtype=np.float64)
    t = d.size
    block = max(1, min(block, t))
    nb = -(-t // block)
    starts = rng.integers(0, t - block + 1, size=(n_boot, nb))
    idx = (starts[:, :, None] + np.arange(block)).reshape(n_boot, nb * block)[:, :t]
    return d[idx].mean(axis=1)


def asking_price(v: float, sigma: float, kappa: float = KAPPA) -> float:
    """Declared asking policy (maths note 6.3, team plan): clamp(V + kappa sigma, 0.05, 0.95)."""
    return float(np.clip(v + kappa * sigma, QUOTE_MIN, QUOTE_MAX))


# ---------------------------------------------------------------------------
# The backtest


def origins_between(first: pd.Period, last: pd.Period) -> list[pd.Period]:
    return list(pd.period_range(first, last, freq="M"))


def residual_diagnostics(resid: np.ndarray, sd: float) -> dict:
    a = acf(resid, nlags=12, fft=True)
    lb = acorr_ljungbox(resid, lags=[12], model_df=1, return_df=True)
    jb = scipy.stats.jarque_bera(resid)
    return {
        "acf": [float(v) for v in a[1:13]],
        "ljung_box_q12": float(lb["lb_stat"].iloc[0]),
        "ljung_box_p12": float(lb["lb_pvalue"].iloc[0]),
        "skew": float(scipy.stats.skew(resid)),
        "excess_kurtosis": float(scipy.stats.kurtosis(resid)),
        "jarque_bera_p": float(jb.pvalue),
        "share_abs_z_gt_3": float(np.mean(np.abs(resid / sd) > 3.0)),
    }


def run_backtest(
    data: Data,
    origins: list[pd.Period],
    n_paths: int,
    base_seed: int,
    innovation: str = "gaussian",
    hist_start: pd.Period = HIST_START,
    full: bool = True,
    fit_window: int | None = None,
) -> dict:
    """One pass over the origins. Returns per-policy/product arrays (NaN where policy B has no
    valid cap) and, when full, per-origin rows with fit parameters and diagnostics.
    fit_window = n fits the AR(1) on the last n months only (climatology is unchanged)."""
    win_d, win_a = window_stats(data.x)
    hist_idx, rule_idx = data.idx(hist_start), data.idx(CAP_RULE_START)
    n = len(origins)
    arr = {
        (pol, prod): {
            key: np.full(n, np.nan)
            for key in ("y", "crps_ar1", "crps_clim", "crps_const", "crps_ar1_fair", "crps_clim_fair",
                        "E_ar1", "sd_ar1", "E_clim", "P0_ar1", "P1_ar1", "pit_ar1", "pit_clim",
                        "pit_const", "q05", "q95", "cap")
        }
        for pol in POLICIES
        for prod in PRODUCTS
    }
    fits = {key: np.full(n, np.nan) for key in ("a", "b", "resid_sd", "n_fit", "n_clim", "capB_cooling",
                                                 "capB_excess", "n_capB")}
    rows = []
    for k, t0 in enumerate(origins):
        i0 = data.idx(t0)
        if i0 + H > len(data.x):
            raise ValueError(f"origin {t0}: the data do not supply 48 observations")
        fit = fit_ar1(data.y, t0, hist_start, fit_window)
        d_sim, a_sim = forecast_stats(fit, n_paths, origin_rng(base_seed, STREAM_SIM, t0), innovation)
        sim_stat = {"cooling": d_sim, "excess": a_sim}
        real_stat = {"cooling": int(win_d[i0]), "excess": int(win_a[i0])}
        cs = climatology_slice(i0, hist_idx)
        clim_stat = {"cooling": win_d[cs], "excess": win_a[cs]}
        caps_b = pre_origin_caps(win_d, win_a, i0, rule_idx)
        v = origin_rng(base_seed, STREAM_PIT, t0).random((2, 2, 3))
        fits["a"][k], fits["b"][k], fits["resid_sd"][k] = fit["a"], fit["b"], fit["resid_sd"]
        fits["n_fit"][k], fits["n_clim"][k] = fit["n"], cs.stop - cs.start
        fits["capB_cooling"][k], fits["capB_excess"][k], fits["n_capB"][k] = (
            caps_b["cooling"], caps_b["excess"], caps_b["n_windows"])
        row = {
            "t0": str(t0),
            "fit": {"n": fit["n"], "first_obs": fit["first_obs"], "last_obs": fit["last_obs"], "a": fit["a"],
                    "b": fit["b"], "resid_sd": fit["resid_sd"], "x0_pct": fit["x0"]},
            "realised_stats": {"D": real_stat["cooling"], "A": real_stat["excess"]},
            "climatology_windows": cs.stop - cs.start,
            "caps_B": caps_b,
        } if full else None
        if full:
            row["fit"]["diagnostics"] = residual_diagnostics(fit["resid"], fit["resid_sd"])
        for pi, (pol, caps) in enumerate((("A", FIXED_CAPS), ("B", caps_b))):
            for qi, prod in enumerate(PRODUCTS):
                cap = int(caps[prod])
                a = arr[(pol, prod)]
                if cap <= 0:
                    if full:
                        row.setdefault(pol, {})[prod] = None
                    continue
                s_sim = np.sort(scores(sim_stat[prod], cap))
                s_clim = np.sort(scores(clim_stat[prod], cap))
                y = int(scores(real_stat[prod], cap))
                sim_f, clim_f, yf = s_sim / ONE, s_clim / ONE, y / ONE
                a["cap"][k] = cap
                a["y"][k] = yf
                a["crps_ar1"][k] = crps_ensemble(sim_f, yf)
                a["crps_ar1_fair"][k] = crps_ensemble(sim_f, yf, fair=True)
                a["crps_clim"][k] = crps_ensemble(clim_f, yf) if clim_f.size else np.nan
                a["crps_clim_fair"][k] = crps_ensemble(clim_f, yf, fair=True) if clim_f.size else np.nan
                a["crps_const"][k] = abs(0.5 - yf)
                a["E_ar1"][k], a["sd_ar1"][k] = sim_f.mean(), sim_f.std()
                a["E_clim"][k] = clim_f.mean() if clim_f.size else np.nan
                if not full:
                    continue
                a["P0_ar1"][k] = float(np.mean(s_sim == 0))
                a["P1_ar1"][k] = float(np.mean(s_sim == ONE))
                a["pit_ar1"][k] = randomized_pit(s_sim, y, v[pi, qi, 0])
                a["pit_clim"][k] = randomized_pit(s_clim, y, v[pi, qi, 1]) if s_clim.size else np.nan
                a["pit_const"][k] = randomized_pit(np.array([ONE // 2]), y, v[pi, qi, 2])
                a["q05"][k], a["q95"][k] = np.quantile(sim_f, [0.05, 0.95])
                p = asking_price(a["E_ar1"][k], a["sd_ar1"][k])
                row.setdefault(pol, {})[prod] = {
                    "cap": cap,
                    "realised_score": y,
                    "ar1": {"E": a["E_ar1"][k], "sd": a["sd_ar1"][k], "mc_se_of_E": a["sd_ar1"][k] / math.sqrt(n_paths),
                            "P_score_0": a["P0_ar1"][k], "P_score_1": a["P1_ar1"][k], "q05": a["q05"][k],
                            "q95": a["q95"][k], "crps": a["crps_ar1"][k], "crps_fair": a["crps_ar1_fair"][k],
                            "pit": a["pit_ar1"][k]},
                    "clim": {"n": int(clim_f.size), "E": a["E_clim"][k], "crps": a["crps_clim"][k],
                             "crps_fair": a["crps_clim_fair"][k], "pit": a["pit_clim"][k]},
                    "const": {"crps": a["crps_const"][k], "pit": a["pit_const"][k]},
                    "d_ar1_minus_clim": a["crps_ar1"][k] - a["crps_clim"][k],
                    "quote_kappa_0_5": {"premium": p, "payout": yf, "seller_result": p - yf, "buyer_net_cost": p - yf},
                }
        if full:
            rows.append(row)
    return {"origins": [str(t) for t in origins], "arr": arr, "fits": fits, "rows": rows,
            "n_paths": n_paths, "seed": base_seed, "innovation": innovation, "hist_start": str(hist_start),
            "fit_window": fit_window}


# ---------------------------------------------------------------------------
# Summaries, uncertainty, decision


def _ci(means: np.ndarray) -> dict:
    lo95, hi95, lo90, hi90 = np.percentile(means, [2.5, 97.5, 5, 95])
    return {"ci95": [float(lo95), float(hi95)], "ci90": [float(lo90), float(hi90)]}


def summarize_product(res: dict, pol: str, prod: str, n_boot: int, base_seed: int) -> dict:
    a = res["arr"][(pol, prod)]
    origins = res["origins"]
    valid = ~np.isnan(a["crps_ar1"]) & ~np.isnan(a["crps_clim"])
    idx = np.flatnonzero(valid)
    out = {"n_origins": int(valid.sum()), "n_excluded": int((~valid).sum())}
    if not idx.size:
        return out
    out["evaluated"] = f"{origins[idx[0]]}..{origins[idx[-1]]}"
    out["contiguous"] = bool(idx[-1] - idx[0] + 1 == idx.size)
    mean = {m: float(np.mean(a[f"crps_{m}"][valid])) for m in MODELS}
    out["mean_crps"] = mean
    out["mean_crps_fair"] = {"ar1": float(np.mean(a["crps_ar1_fair"][valid])),
                             "clim": float(np.mean(a["crps_clim_fair"][valid]))}
    out["skill_vs_clim"] = {m: 1.0 - mean[m] / mean["clim"] for m in ("ar1", "const")}
    out["mae_of_ar1_expected_score"] = float(np.mean(np.abs(a["E_ar1"][valid] - a["y"][valid])))
    out["mae_of_clim_mean"] = float(np.mean(np.abs(a["E_clim"][valid] - a["y"][valid])))
    d = a["crps_ar1"][valid] - a["crps_clim"][valid]
    out["d"] = {"mean": float(d.mean()), "median": float(np.median(d)), "share_ar1_better": float(np.mean(d < 0))}
    boot = {}
    for b in BLOCKS:
        rng = np.random.default_rng(np.random.SeedSequence([base_seed, STREAM_BOOT, b, POLICIES.index(pol),
                                                            PRODUCTS.index(prod)]))
        boot[str(b)] = _ci(block_bootstrap_means(d, b, n_boot, rng))
    out["d"]["block_bootstrap"] = boot
    pos = np.arange(len(origins))[valid]
    phase = pos % H
    non = d[phase == 0]
    out["d"]["non_overlapping"] = {"origins": [origins[i] for i in pos[phase == 0]], "n": int(non.size),
                                   "mean": float(non.mean()) if non.size else None,
                                   "ar1_better": int(np.sum(non < 0)), "clim_better": int(np.sum(non > 0))}
    by_phase = [float(d[phase == o].mean()) for o in range(H) if np.any(phase == o)]
    out["d"]["all_48_phase_offsets"] = {"min_mean": float(np.min(by_phase)), "median_mean": float(np.median(by_phase)),
                                        "max_mean": float(np.max(by_phase)),
                                        "share_offsets_ar1_better": float(np.mean(np.array(by_phase) < 0))}
    # calibration
    cal = {}
    for m in MODELS:
        u = a[f"pit_{m}"][valid]
        u = u[~np.isnan(u)]
        if not u.size:
            continue
        hist, _ = np.histogram(u, bins=10, range=(0.0, 1.0))
        cal[m] = {"pit_hist_10": [int(h) for h in hist], "coverage_central_50": float(np.mean((u >= 0.25) & (u <= 0.75))),
                  "coverage_central_90": float(np.mean((u >= 0.05) & (u <= 0.95)))}
    yv = a["y"][valid]
    cal["ar1"]["quantile_interval_90_coverage"] = float(np.mean((a["q05"][valid] <= yv) & (yv <= a["q95"][valid])))
    cal["point_masses"] = {
        "forecast_P_score_0": float(np.mean(a["P0_ar1"][valid])), "observed_share_score_0": float(np.mean(yv == 0.0)),
        "forecast_P_score_1": float(np.mean(a["P1_ar1"][valid])), "observed_share_score_1": float(np.mean(yv == 1.0)),
    }
    out["calibration"] = cal
    return out


def verdict(summary: dict, seed_sd: float | None) -> dict:
    """Declared before running: a winner needs the 95% block-bootstrap CI of the mean CRPS
    difference to exclude 0 on the same side for every L in (24, 48, 96), seed-to-seed spread of
    the mean difference below 10% of its size, and the same sign in the non-overlapping origins."""
    d = summary["d"]
    cis = [d["block_bootstrap"][str(b)]["ci95"] for b in DECISION_BLOCKS]
    below = all(hi < 0 for _, hi in cis)
    above = all(lo > 0 for lo, _ in cis)
    some = any(hi < 0 or lo > 0 for lo, hi in cis)
    mc_ok = seed_sd is not None and seed_sd < 0.10 * abs(d["mean"])
    non = d["non_overlapping"]["mean"]
    if below and mc_ok and non is not None and non < 0:
        label = "AR(1) beats climatology"
    elif above and mc_ok and non is not None and non > 0:
        label = "climatology beats AR(1)"
    elif some:
        label = "suggestive: " + ("AR(1) lower CRPS" if d["mean"] < 0 else "climatology lower CRPS")
    else:
        label = "inconclusive"
    return {"label": label, "ci95_by_block": {str(b): ci for b, ci in zip(DECISION_BLOCKS, cis)},
            "all_blocks_below_0": below, "all_blocks_above_0": above, "mc_spread_ok": mc_ok,
            "seed_sd_of_mean_d": seed_sd, "non_overlapping_mean_d": non}


def pricing_summary(res: dict, pol: str, prod: str, n_boot: int, base_seed: int) -> dict:
    """The asking policy evaluated per unit of cover, separately from forecast quality."""
    a = res["arr"][(pol, prod)]
    valid = ~np.isnan(a["E_ar1"])
    out = {}
    for kappa in KAPPAS:
        p = np.clip(a["E_ar1"][valid] + kappa * a["sd_ar1"][valid], QUOTE_MIN, QUOTE_MAX)
        y = a["y"][valid]
        seller = p - y
        rng = np.random.default_rng(np.random.SeedSequence([base_seed, STREAM_BOOT, 999, int(kappa * 100),
                                                            POLICIES.index(pol), PRODUCTS.index(prod)]))
        out[f"kappa_{kappa}"] = {
            "role": "declared policy" if kappa == KAPPA else "sensitivity, not used for selection",
            "mean_premium": float(p.mean()), "mean_payout": float(y.mean()),
            "mean_seller_result": float(seller.mean()), "mean_buyer_net_cost": float(seller.mean()),
            "share_origins_seller_wins": float(np.mean(seller > 0)), "worst_seller_result": float(seller.min()),
            "best_seller_result": float(seller.max()),
            "share_clamp_binding": float(np.mean((a["E_ar1"][valid] + kappa * a["sd_ar1"][valid] < QUOTE_MIN)
                                                 | (a["E_ar1"][valid] + kappa * a["sd_ar1"][valid] > QUOTE_MAX))),
            "seller_result_block48": _ci(block_bootstrap_means(seller, 48, n_boot, rng)),
        }
    return out


def light_metrics(res: dict) -> dict:
    out = {}
    for pol in POLICIES:
        for prod in PRODUCTS:
            a = res["arr"][(pol, prod)]
            valid = ~np.isnan(a["crps_ar1"]) & ~np.isnan(a["crps_clim"])
            d = a["crps_ar1"][valid] - a["crps_clim"][valid]
            out[f"{pol}/{prod}"] = {"mean_crps_ar1": float(np.mean(a["crps_ar1"][valid])),
                                    "mean_crps_clim": float(np.mean(a["crps_clim"][valid])),
                                    "mean_d": float(d.mean()), "n": int(valid.sum())}
    return out


def variant_summary(res: dict, n_boot: int, base_seed: int) -> dict:
    """Mean CRPS and the mean AR(1) - climatology difference with the decision-rule block-bootstrap
    CIs, per policy/product, for one specification (same bootstrap streams as the primary run)."""
    out = {}
    for pol in POLICIES:
        for prod in PRODUCTS:
            a = res["arr"][(pol, prod)]
            valid = ~np.isnan(a["crps_ar1"]) & ~np.isnan(a["crps_clim"])
            d = a["crps_ar1"][valid] - a["crps_clim"][valid]
            cis = {}
            for b in DECISION_BLOCKS:
                rng = np.random.default_rng(np.random.SeedSequence([base_seed, STREAM_BOOT, b, POLICIES.index(pol),
                                                                    PRODUCTS.index(prod)]))
                cis[str(b)] = _ci(block_bootstrap_means(d, b, n_boot, rng))["ci95"]
            pos = np.arange(len(res["origins"]))[valid]
            non = d[pos % H == 0]
            out[f"{pol}/{prod}"] = {
                "n": int(valid.sum()), "mean_crps_ar1": float(np.mean(a["crps_ar1"][valid])),
                "mean_crps_clim": float(np.mean(a["crps_clim"][valid])), "mean_d": float(d.mean()), "ci95": cis,
                "all_blocks_below_0": all(hi < 0 for _, hi in cis.values()),
                "all_blocks_above_0": all(lo > 0 for lo, _ in cis.values()),
                "non_overlapping_mean_d": float(non.mean()) if non.size else None,
            }
    return out


def robustness(verdicts: dict, variants: dict) -> dict:
    """For each primary verdict: in which specification variants does the 95% CI exclude 0 on the
    same side for every decision block length?"""
    out = {}
    for key, v in verdicts.items():
        direction = "below" if v["all_blocks_below_0"] else "above" if v["all_blocks_above_0"] else None
        agree, reverse, unclear = [], [], []
        for name, summ in variants.items():
            s = summ[key]
            if direction and s[f"all_blocks_{direction}_0"]:
                agree.append(name)
            elif s["all_blocks_below_0"] or s["all_blocks_above_0"]:
                reverse.append(name)
            else:
                unclear.append(name)
        n = len(variants)
        if not direction:
            status = "no primary winner"
        elif len(agree) == n:
            status = f"robust: holds in all {n} variants"
        elif agree:
            status = f"holds in {len(agree)} of {n} variants"
        else:
            status = f"holds in none of the {n} variants"
        out[key] = {"primary": v["label"], "status": status, "n_variants": n, "n_agree": len(agree), "agree": agree,
                    "reverse": reverse, "not_significant": unclear}
    return out


def compare_forecasts(base: dict, other: dict) -> dict:
    out = {}
    for pol in POLICIES:
        for prod in PRODUCTS:
            e0, e1 = base["arr"][(pol, prod)]["E_ar1"], other["arr"][(pol, prod)]["E_ar1"]
            c0, c1 = base["arr"][(pol, prod)]["crps_ar1"], other["arr"][(pol, prod)]["crps_ar1"]
            m = ~np.isnan(e0) & ~np.isnan(e1)
            out[f"{pol}/{prod}"] = {"mean_abs_change_E": float(np.mean(np.abs(e1[m] - e0[m]))),
                                    "max_abs_change_E": float(np.max(np.abs(e1[m] - e0[m]))),
                                    "mean_abs_change_crps": float(np.mean(np.abs(c1[m] - c0[m])))}
    return out


def diagnostics_summary(res: dict) -> dict:
    rows = {r["t0"]: r for r in res["rows"]}
    sel = {}
    for t in SELECTED_ORIGINS:
        if t in rows:
            f = rows[t]["fit"]
            dg = f["diagnostics"]
            sel[t] = {"n": f["n"], "a": f["a"], "b": f["b"], "resid_sd": f["resid_sd"], "acf1": dg["acf"][0],
                      "acf12": dg["acf"][11], "ljung_box_p12": dg["ljung_box_p12"], "skew": dg["skew"],
                      "excess_kurtosis": dg["excess_kurtosis"], "jarque_bera_p": dg["jarque_bera_p"],
                      "share_abs_z_gt_3": dg["share_abs_z_gt_3"]}
    b = res["fits"]["b"]
    acf12 = np.array([r["fit"]["diagnostics"]["acf"][11] for r in res["rows"]])
    acf1 = np.array([r["fit"]["diagnostics"]["acf"][0] for r in res["rows"]])
    lbp = np.array([r["fit"]["diagnostics"]["ljung_box_p12"] for r in res["rows"]])
    kurt = np.array([r["fit"]["diagnostics"]["excess_kurtosis"] for r in res["rows"]])
    return {
        "selected_origins": sel,
        "over_all_origins": {
            "b_min": float(b.min()), "b_max": float(b.max()), "share_b_ge_1": float(np.mean(b >= 1.0)),
            "a_min": float(res["fits"]["a"].min()), "a_max": float(res["fits"]["a"].max()),
            "resid_sd_min": float(res["fits"]["resid_sd"].min()), "resid_sd_max": float(res["fits"]["resid_sd"].max()),
            "acf1_range": [float(acf1.min()), float(acf1.max())], "acf12_range": [float(acf12.min()), float(acf12.max())],
            "share_ljung_box_p12_below_0_05": float(np.mean(lbp < 0.05)),
            "excess_kurtosis_range": [float(kurt.min()), float(kurt.max())],
        },
        "gaussian_share_abs_z_gt_3": 2 * float(scipy.stats.norm.sf(3.0)),
    }


def _round(o, nd: int = 7):
    if isinstance(o, dict):
        return {k: _round(v, nd) for k, v in o.items()}
    if isinstance(o, (list, tuple)):
        return [_round(v, nd) for v in o]
    if isinstance(o, np.bool_):
        return bool(o)
    if isinstance(o, (np.integer,)):
        return int(o)
    if isinstance(o, (float, np.floating)):
        f = float(o)
        return None if math.isnan(f) else round(f, nd)
    if isinstance(o, np.ndarray):
        return _round(o.tolist(), nd)
    return o


def dumps_report(rep: dict) -> str:
    """Readable top-level sections, then one compact JSON line per origin (valid JSON, smaller diffs)."""
    head = {k: v for k, v in rep.items() if k != "per_origin"}
    text = json.dumps(head, indent=1, ensure_ascii=False)
    if not text.endswith("\n}"):
        raise AssertionError("unexpected json.dumps layout")
    rows = ",\n".join("  " + json.dumps(row, ensure_ascii=False, separators=(",", ":")) for row in rep["per_origin"])
    return text[:-2] + ',\n "per_origin": [\n' + rows + "\n ]\n}\n"


def _sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def build_report(data: Data, origins: list[pd.Period], n_paths: int = 10_000, base_seed: int = DEFAULT_SEED,
                 n_boot: int = 10_000, sensitivity: bool = True) -> dict:
    main = run_backtest(data, origins, n_paths, base_seed)
    seed_runs, sens = [], {}
    if sensitivity:
        seed_runs = [run_backtest(data, origins, n_paths, base_seed + j, full=False) for j in range(1, 5)]
        n_small = run_backtest(data, origins, 1_000, base_seed, full=False)
        n_large = run_backtest(data, origins, 50_000, base_seed, full=False)
        innov = {name: run_backtest(data, origins, n_paths, base_seed, innovation=name, full=False)
                 for name in INNOVATIONS[1:]}
        hist60 = run_backtest(data, origins, n_paths, base_seed, hist_start=CAP_RULE_START, full=False)
        window = run_backtest(data, origins, n_paths, base_seed, full=False, fit_window=FIT_WINDOW)
        variant_runs = {"iid residuals": innov["iid_resid"], "12-month block residuals": innov["block12_resid"],
                        "history from 1960": hist60, f"fit window {FIT_WINDOW} months": window}
        per_seed = [light_metrics(main)] + [light_metrics(r) for r in seed_runs]
        sens = {
            "monte_carlo_seeds": {
                "seeds": [base_seed + j for j in range(5)], "n_paths": n_paths,
                "by_product": {key: {
                    "mean_d_per_seed": [m[key]["mean_d"] for m in per_seed],
                    "sd_of_mean_d": float(np.std([m[key]["mean_d"] for m in per_seed], ddof=1)),
                    "sd_of_mean_crps_ar1": float(np.std([m[key]["mean_crps_ar1"] for m in per_seed], ddof=1)),
                } for key in per_seed[0]},
                "forecast_change_vs_primary_seed": compare_forecasts(main, seed_runs[0]),
            },
            "monte_carlo_sample_size": {
                "1000": {"metrics": light_metrics(n_small), "vs_10000": compare_forecasts(main, n_small)},
                "10000": {"metrics": light_metrics(main)},
                "50000": {"metrics": light_metrics(n_large), "vs_10000": compare_forecasts(main, n_large)},
            },
            "variants": {"primary": variant_summary(main, n_boot, base_seed),
                         **{name: variant_summary(r, n_boot, base_seed) for name, r in variant_runs.items()}},
            "variant_notes": {
                "primary": "Gaussian innovations, AR(1) fit and climatology from 1914-01 (declared before running)",
                "iid residuals": "innovations resampled i.i.d. from the fitted residuals (fat tails kept)",
                "12-month block residuals": "innovations resampled in blocks of 12 consecutive residuals (keeps "
                                            "within-year residual dependence, the lag-12 check)",
                "history from 1960": "AR(1) fit and climatology both start at 1960-01; policy B caps unchanged",
                f"fit window {FIT_WINDOW} months": f"AR(1) fitted on the last {FIT_WINDOW} months before each origin "
                                                   "(1997-01..2020-12 at the 2021-01 origin); climatology from 1914. "
                                                   "Added after the 2021-01 cross-check showed the maths note's "
                                                   "reference V0 matches a 1997-2020 fit; not part of the declared rule",
            },
            "forecast_changes_vs_primary": {name: compare_forecasts(main, r) for name, r in variant_runs.items()},
        }
        k2021 = next((i for i, t in enumerate(origins) if str(t) == "2021-01"), None)
        if k2021 is not None:
            sens["jan2021_V0_at_50000_paths"] = {
                prod: float(n_large["arr"][("A", prod)]["E_ar1"][k2021]) for prod in PRODUCTS}
            sens["jan2021_V0_by_variant"] = {
                "primary (fit from 1914)": {prod: float(main["arr"][("A", prod)]["E_ar1"][k2021]) for prod in PRODUCTS},
                **{name: {prod: float(r["arr"][("A", prod)]["E_ar1"][k2021]) for prod in PRODUCTS}
                   for name, r in variant_runs.items()},
            }
    analyses, verdicts = {}, {}
    for pol in POLICIES:
        analyses[pol] = {}
        for prod in PRODUCTS:
            s = summarize_product(main, pol, prod, n_boot, base_seed)
            seed_sd = sens["monte_carlo_seeds"]["by_product"][f"{pol}/{prod}"]["sd_of_mean_d"] if sens else None
            if "d" in s:
                verdicts[f"{pol}/{prod}"] = verdict(s, seed_sd)
            analyses[pol][prod] = s
    robust = (robustness(verdicts, {k: v for k, v in sens["variants"].items() if k != "primary"})
              if sens else {})
    rows = {r["t0"]: r for r in main["rows"]}
    jan = rows.get("2021-01")
    cross = {}
    if jan:
        cross["jan2021"] = {
            "realised_fixed_caps": {prod: jan["A"][prod]["realised_score"] for prod in PRODUCTS},
            "expected_realised_fixed_caps": {"cooling": 827387, "excess": 863980},
            "V0_ar1_fixed_caps": {prod: jan["A"][prod]["ar1"]["E"] for prod in PRODUCTS},
            "maths_note_reference_V0": {"cooling": 0.32, "excess": 0.009, "note": "reviewer's run, 50,000 paths, "
                                        "AR(1) on pre-2021 data, macropaths-maths.md section 5"},
            "caps_B": jan["caps_B"],
            "declared_caps_pp": {"cooling": 7.697, "excess": 188.18},
        }
        if sens:
            cross["jan2021"]["V0_by_variant"] = sens["jan2021_V0_by_variant"]
            cross["jan2021"]["finding"] = (
                "The maths note's V0 (about 0.32 / 0.009) is not reproduced by the primary fit from 1914 "
                "(world-war volatility roughly doubles the residual sd). It is reproduced by an AR(1) fitted on "
                f"1997-01..2020-12, the '{FIT_WINDOW} months' variant. research/build_notebook.py fits on all "
                "history (fit_ou default), as the primary does, so 'pre-2021 data' is ambiguous in the sources.")
    report = {
        "schema": "macropaths-backtest-v1",
        "question": "Does AR(1) forecast the terminal Cooling and Excess scores better than climatology "
                    "and a constant 0.5? (forecast quality only; pricing evaluated separately)",
        "specification": {
            "source": "macropaths-maths.md section 5 (walk-forward, proper scoring rules, coverage, randomised "
                      "PIT) and section 6.3 (asking policy); research/README.md and research/build_notebook.py "
                      "(cap rule)",
            "origins": f"{origins[0]}..{origins[-1]} monthly ({len(origins)})",
            "horizon": H,
            "fit": "OLS y_{t+1} = a + b y_t + e on observations dated HIST_START .. t0-1 "
                   "(macrolib.fit_ou(until=t0-1); its slice includes `until`)",
            "simulation": f"{n_paths} paths x {H} months from x0 = y_(t0-1); Gaussian innovations with the "
                          "fitted residual sd (ddof=2); x0 not part of the contract path",
            "quantisation": "simulated percent -> floor(y * 1e4) contract units, then the exact integer "
                            "recursions and scores of eqs. (2)-(6)",
            "climatology": "realised scores of every 48-month window that ended <= t0-1, from HIST_START",
            "constant": "point mass at score 0.5 (CRPS = |0.5 - y|)",
            "crps": "empirical-distribution CRPS: mean|X-y| - sum_i (2i-n-1) X_(i) / n^2 (pair term "
                    "normalised 1/(2n^2)); 'fair' 1/(2n(n-1)) reported alongside",
            "pit": "randomised PIT u = F(y-) + v (F(y) - F(y-)), seeded v",
            "decision_rule": verdict.__doc__.strip(),
            "policy_A": "fixed caps 8 pp / 80 pp-months: RETROSPECTIVE DEMONSTRATION (caps chosen after "
                        "seeing 2021-24), not a pre-specified evaluation",
            "policy_B": "pre-origin percentile caps, rule below; applied to simulated, realised and "
                        "climatology scores at the same origin",
            "cap_rule": CAP_RULE,
            "kappa": KAPPA,
        },
        "settings": {"n_paths": n_paths, "base_seed": base_seed, "seed_streams": "SeedSequence([seed, purpose, "
                     "year*12+month]); purposes: 0 simulation, 1 PIT, 2 bootstrap", "innovation": "gaussian",
                     "history_start": str(HIST_START), "cap_rule_start": str(CAP_RULE_START), "cap_q": CAP_Q,
                     "bootstrap_replicates": n_boot, "block_lengths": list(BLOCKS),
                     "decision_block_lengths": list(DECISION_BLOCKS), "K": K, "fixed_caps": FIXED_CAPS,
                     "quote_bounds": [QUOTE_MIN, QUOTE_MAX], "kappas": list(KAPPAS)},
        "data": data.provenance,
        "software": {"python": sys.version.split()[0], "numpy": np.__version__, "pandas": pd.__version__,
                     "scipy": scipy.__version__, "statsmodels": statsmodels.__version__,
                     "rng": "numpy default_rng (PCG64)", "platform": platform.platform()},
        "code_sha256": {"forecast/backtest.py": _sha(Path(__file__)), "research/macrolib.py": _sha(ROOT / "research" / "macrolib.py"),
                        "tests/make_vectors.py": _sha(ROOT / "tests" / "make_vectors.py")},
        "analysis_A_fixed_caps": analyses["A"],
        "analysis_B_pre_origin_caps": analyses["B"],
        "verdicts": verdicts,
        "robustness": robust,
        "sensitivity": sens,
        "diagnostics": diagnostics_summary(main),
        "pricing_policy": {"policy": "p = clamp(V + kappa*sigma, 0.05, 0.95), V and sigma = AR(1) mean and sd of "
                           "the score at the origin; per unit of cover: buyer pays p, receives y; seller result "
                           "= buyer net cost = p - y (zero-sum per unit, collateral returned)",
                           **{pol: {prod: pricing_summary(main, pol, prod, n_boot, base_seed) for prod in PRODUCTS}
                              for pol in POLICIES}},
        "cross_checks": cross,
        "effective_sample": {"n_origins": len(origins), "horizon_months": H,
                             "non_overlapping_windows": len(origins[::H]),
                             "note": "consecutive origins share 47 of 48 months; the evaluation holds roughly "
                                     f"{len(origins) / H:.1f} independent 48-month blocks"},
        "per_origin": main["rows"],
    }
    report["conclusion"] = conclusion_lines(report)
    return _round(report)


def conclusion_lines(rep: dict) -> list[str]:
    v, rb = rep["verdicts"], rep.get("robustness") or {}
    lines = []
    for pol, name in (("B", "pre-origin caps (the honest test)"), ("A", "fixed caps 8/80 (retrospective)")):
        for prod in PRODUCTS:
            key = f"{pol}/{prod}"
            if key not in v:
                continue
            s = rep[f"analysis_{pol}_{'fixed_caps' if pol == 'A' else 'pre_origin_caps'}"][prod]
            ci = v[key]["ci95_by_block"]["48"]
            tail = ""
            r = rb.get(key)
            if r:
                tail = f" Specification variants: {r['status']}"
                parts = []
                if r["not_significant"]:
                    parts.append("not significant with " + ", ".join(r["not_significant"]))
                if r["reverse"]:
                    parts.append("reversed with " + ", ".join(r["reverse"]))
                if parts:
                    tail += " (" + "; ".join(parts) + ")"
                tail += "."
            lines.append(f"{prod.capitalize()}, {name}: {v[key]['label']}. Mean CRPS AR(1) {s['mean_crps']['ar1']:.4f} "
                         f"vs climatology {s['mean_crps']['clim']:.4f} vs constant {s['mean_crps']['const']:.4f}; "
                         f"mean difference {s['d']['mean']:+.4f}, 95% block-bootstrap CI (L=48) "
                         f"[{ci[0]:+.4f}, {ci[1]:+.4f}]; non-overlapping origins: AR(1) better in "
                         f"{s['d']['non_overlapping']['ar1_better']} of {s['d']['non_overlapping']['n']}.{tail}")
    # Headline per product, read from policy B (the honest test) and its robustness across variants.
    for prod in PRODUCTS:
        key = f"B/{prod}"
        if key not in v:
            continue
        label, r = v[key]["label"], rb.get(key)
        held = f" ({r['status']})" if r else ""
        if r and r["n_agree"] == 0 and label in ("AR(1) beats climatology", "climatology beats AR(1)"):
            lines.append(f"{prod.capitalize()}: no convincing winner. The primary specification gives '{label}', "
                         f"but it holds in none of the {r['n_variants']} specification variants, so the result depends "
                         "on modelling choices (Gaussian innovations, fit from 1914) rather than on a stable "
                         "difference in skill.")
        elif label == "AR(1) beats climatology":
            convincing = "moderately convincing" if r and r["n_agree"] >= r["n_variants"] - 1 else "weak"
            lines.append(f"{prod.capitalize()}: AR(1) beats climatology{held}; the evidence is {convincing} given about "
                         f"{rep['effective_sample']['n_origins'] / H:.0f} independent 48-month blocks.")
        elif label == "climatology beats AR(1)":
            lines.append(f"{prod.capitalize()}: climatology beats AR(1){held}.")
        else:
            lines.append(f"{prod.capitalize()}: {label}{held}.")
    for prod in PRODUCTS:
        c = rep["analysis_B_pre_origin_caps"][prod].get("calibration", {}).get("ar1")
        if not c:
            continue
        n_pit = max(1, sum(c["pit_hist_10"]))
        low, high = c["pit_hist_10"][0] / n_pit, c["pit_hist_10"][-1] / n_pit
        if low > 0.2 or high > 0.2:
            side = "over-forecasts" if low > high else "under-forecasts"
            lines.append(f"Calibration: the primary AR(1) {side} {prod.capitalize()} (policy B: {max(low, high):.0%} of "
                         f"randomised PITs fall in the {'lowest' if low > high else 'highest'} decile, against 10% for "
                         "a calibrated forecast).")
    cj = rep.get("cross_checks", {}).get("jan2021", {})
    if cj.get("finding"):
        lines.append("Specification finding: " + cj["finding"])
    seller = {prod: rep["pricing_policy"]["B"][prod][f"kappa_{KAPPA}"]["mean_seller_result"] for prod in PRODUCTS}
    lines.append("Pricing (separate from forecast quality): with κ = 0.5 under policy B the seller's mean result per "
                 "unit would have been " + ", ".join(f"{p} {v:+.3f}" for p, v in seller.items())
                 + (". A positive result here mostly reflects quotes set from a forecast that runs high, not a "
                    "validated policy" if all(v > 0 for v in seller.values()) else "")
                 + ". The policy needs re-evaluating with a calibrated forecast before any quote is called reliable.")
    blocks = rep["effective_sample"]["n_origins"] / H
    lines.append(f"The evidence rests on about {blocks:.1f} independent 48-month blocks, so even large average "
                 "differences carry wide uncertainty; the block-bootstrap intervals above are the honest measure.")
    lines.append("Next research step: fix the AR(1) fit window in the specification (all history vs a rolling "
                 "24 years), then evaluate the maths note's alternative 2 (a model of monthly inflation with "
                 "year-on-year reconstructed by summation, which respects the lag-12 overlap and the fat-tailed "
                 "residuals) on this same harness, and widen the evaluation set (other CPI measures or countries) to "
                 "raise the effective sample size.")
    return lines


# ---------------------------------------------------------------------------
# Markdown report (generated from the JSON; no number is typed by hand)


def _f(x, nd=4):
    return "n/a" if x is None else f"{x:.{nd}f}"


def render_markdown(r: dict) -> str:
    L = []
    w = L.append
    w("# MacroPaths AR(1) rolling-origin backtest")
    w("")
    w("Research only, off-chain. Generated by `forecast/backtest.py` from `forecast/backtest.json`; "
      "every number below comes from that file.")
    w("")
    w("## Conclusion")
    w("")
    for line in r["conclusion"]:
        w(f"- {line}")
    w("")
    w("| Policy / product | Verdict | 95% CI of mean CRPS difference, L = 24 / 48 / 96 | Seed sd of mean difference | Across specification variants |")
    w("|---|---|---|---|---|")
    for key, v in r["verdicts"].items():
        cis = " / ".join(f"[{c[0]:+.4f}, {c[1]:+.4f}]" for c in v["ci95_by_block"].values())
        rb = (r.get("robustness") or {}).get(key)
        rob = "n/a"
        if rb:
            rob = rb["status"]
            if rb["not_significant"]:
                rob += "; not significant: " + ", ".join(rb["not_significant"])
            if rb["reverse"]:
                rob += "; reversed: " + ", ".join(rb["reverse"])
        w(f"| {key} | {v['label']} | {cis} | {_f(v['seed_sd_of_mean_d'], 5)} | {rob} |")
    w("")
    w("A negative difference means AR(1) has the lower (better) CRPS. Policy B is the honest test; policy A is the "
      "retrospective demonstration.")
    w("")
    sp = r["specification"]
    w("## Question and method")
    w("")
    w(f"- **Question.** {r['question']}")
    w(f"- **Origins.** {sp['origins']}; each forecast covers the next {sp['horizon']} months.")
    w(f"- **Fit.** {sp['fit']}.")
    w(f"- **Simulation.** {sp['simulation']}.")
    w(f"- **Settlement maths.** {sp['quantisation']}. The contract statistics start afresh at the first "
      "forecast month; the previous month only starts the AR(1) recursion.")
    w(f"- **Climatology.** {sp['climatology']}.")
    w(f"- **Constant.** {sp['constant']}.")
    w(f"- **CRPS.** {sp['crps']}.")
    w(f"- **Calibration.** {sp['pit']}; coverage of central 50% / 90% ranges; point masses at 0 and at the cap.")
    w(f"- **Decision rule (declared before running).** {sp['decision_rule']}")
    w(f"- **Policy A.** {sp['policy_A']}.")
    w(f"- **Policy B.** {sp['policy_B']}.")
    for k, v in sp["cap_rule"].items():
        w(f"  - {k.replace('_', ' ')}: {v}")
    w("")
    d = r["data"]
    w("## Data and reproducibility")
    w("")
    w(f"- Series {d['series_id']}, snapshot `{d['snapshot']}`, retrieved {d['retrieved_at']}, raw sha256 "
      f"`{d['sha256_of_raw']}`; levels {d['levels']}, year-on-year {d['yoy']} ({d['n_yoy']} months).")
    s = r["settings"]
    w(f"- N = {s['n_paths']} paths, base seed {s['base_seed']} ({s['seed_streams']}); bootstrap "
      f"{s['bootstrap_replicates']} replicates, block lengths {s['block_lengths']}.")
    sw = r["software"]
    w(f"- Python {sw['python']}, numpy {sw['numpy']}, pandas {sw['pandas']}, scipy {sw['scipy']}, statsmodels "
      f"{sw['statsmodels']}; {sw['rng']}.")
    w(f"- Code sha256: " + ", ".join(f"`{k}` {v[:12]}…" for k, v in r["code_sha256"].items()) + ".")
    w("")
    for pol, title in (("A", "Analysis A: fixed caps 8 / 80 (retrospective demonstration)"),
                       ("B", "Analysis B: pre-origin percentile caps")):
        an = r[f"analysis_{pol}_{'fixed_caps' if pol == 'A' else 'pre_origin_caps'}"]
        w(f"## {title}")
        w("")
        if pol == "A":
            w("The caps were chosen after seeing 2021–24, so this is not a pre-specified historical evaluation. "
              "It reproduces the product as shown in the demo.")
            w("")
        else:
            cj = r["cross_checks"].get("jan2021", {})
            if cj:
                cb = cj["caps_B"]
                w(f"Caps at the 2021-01 origin: Cooling {cb['cooling']} ({cb['cooling'] / 1e4:.4f} pp), Excess "
                  f"{cb['excess']} ({cb['excess'] / 1e4:.4f} pp-months), from {cb['n_windows']} windows; "
                  f"declared values {cj['declared_caps_pp']['cooling']} pp and {cj['declared_caps_pp']['excess']} "
                  "pp-months.")
                w("")
        w("| Product | Origins | Mean CRPS AR(1) | Climatology | Constant 0.5 | Skill AR(1) vs clim | MAE of AR(1) E[s] | Mean diff | Share AR(1) better |")
        w("|---|---|---|---|---|---|---|---|---|")
        for prod in PRODUCTS:
            x = an[prod]
            if "mean_crps" not in x:
                w(f"| {prod} | 0 | n/a | n/a | n/a | n/a | n/a | n/a | n/a |")
                continue
            w(f"| {prod} | {x['n_origins']} ({x['evaluated']}; {x['n_excluded']} excluded) | {_f(x['mean_crps']['ar1'])} | "
              f"{_f(x['mean_crps']['clim'])} | {_f(x['mean_crps']['const'])} | {_f(x['skill_vs_clim']['ar1'], 3)} | "
              f"{_f(x['mae_of_ar1_expected_score'])} | {x['d']['mean']:+.4f} | {_f(x['d']['share_ar1_better'], 3)} |")
        w("")
        w("Fair-normalised CRPS (1/(2n(n−1))), as a check: " + "; ".join(
            f"{prod} AR(1) {_f(an[prod]['mean_crps_fair']['ar1'])}, climatology {_f(an[prod]['mean_crps_fair']['clim'])}"
            for prod in PRODUCTS if "mean_crps_fair" in an[prod]) + ".")
        w("")
        w("**Uncertainty of the mean CRPS difference (AR(1) − climatology).**")
        w("")
        w("| Product | " + " | ".join(f"95% CI, L = {b}" for b in BLOCKS) + " | Non-overlapping origins (every 48 months from 1965-01) | All 48 phase offsets: min / median / max mean |")
        w("|---|" + "---|" * (len(BLOCKS) + 2))
        for prod in PRODUCTS:
            x = an[prod]
            if "d" not in x:
                continue
            bb = x["d"]["block_bootstrap"]
            no = x["d"]["non_overlapping"]
            ph = x["d"]["all_48_phase_offsets"]
            w(f"| {prod} | " + " | ".join(f"[{bb[str(b)]['ci95'][0]:+.4f}, {bb[str(b)]['ci95'][1]:+.4f}]" for b in BLOCKS)
              + f" | mean {no['mean']:+.4f}; AR(1) better {no['ar1_better']} / {no['n']} | "
              f"{ph['min_mean']:+.4f} / {ph['median_mean']:+.4f} / {ph['max_mean']:+.4f} |")
        w("")
        w("**Calibration.**")
        w("")
        w("| Product | Model | PIT histogram (10 bins) | Central 50% coverage | Central 90% coverage |")
        w("|---|---|---|---|---|")
        for prod in PRODUCTS:
            x = an[prod]
            if "calibration" not in x:
                continue
            for m in MODELS:
                c = x["calibration"].get(m)
                if c:
                    w(f"| {prod} | {m} | {c['pit_hist_10']} | {_f(c['coverage_central_50'], 3)} | {_f(c['coverage_central_90'], 3)} |")
        w("")
        for prod in PRODUCTS:
            x = an[prod]
            if "calibration" not in x:
                continue
            pm = x["calibration"]["point_masses"]
            w(f"- {prod}: AR(1) forecast P(score = 0) {_f(pm['forecast_P_score_0'], 3)} vs observed "
              f"{_f(pm['observed_share_score_0'], 3)}; P(score = 1) {_f(pm['forecast_P_score_1'], 3)} vs observed "
              f"{_f(pm['observed_share_score_1'], 3)}; AR(1) 5–95% quantile interval coverage "
              f"{_f(x['calibration']['ar1']['quantile_interval_90_coverage'], 3)} (ties at 0 inflate it).")
        w("")
    w("## Effective sample size")
    w("")
    es = r["effective_sample"]
    w(f"{es['n_origins']} monthly origins, horizon {es['horizon_months']} months: {es['note']}. The planned "
      f"non-overlapping analysis uses the {es['non_overlapping_windows']} origins 1965-01, 1969-01, …, 2021-01. "
      "Neighbouring origins are not independent observations, so per-origin counts must not be read as sample "
      "size; the moving-block bootstrap resamples whole blocks of consecutive origins instead.")
    w("")
    sens = r["sensitivity"]
    if sens:
        w("## Sensitivity")
        w("")
        w("**Monte Carlo seeds** (N = 10,000; five base seeds). The spread of the mean CRPS difference across seeds is "
          "simulation error in the *evaluation*; it is a different quantity from the Monte Carlo standard error of "
          "an expected score (σ/√N, at most 1/(2√N) = 0.005 at N = 10,000).")
        w("")
        w("| Policy / product | Mean diff per seed | sd across seeds | sd of mean CRPS AR(1) |")
        w("|---|---|---|---|")
        for key, x in sens["monte_carlo_seeds"]["by_product"].items():
            w(f"| {key} | {', '.join(f'{v:+.5f}' for v in x['mean_d_per_seed'])} | {x['sd_of_mean_d']:.6f} | {x['sd_of_mean_crps_ar1']:.6f} |")
        w("")
        w("**Monte Carlo sample size** (seed fixed).")
        w("")
        w("| Policy / product | Mean CRPS AR(1), N = 1,000 / 10,000 / 50,000 | Mean diff, N = 1,000 / 10,000 / 50,000 | Max abs change of E[s] vs N = 10,000 (1,000 / 50,000) |")
        w("|---|---|---|---|")
        ms = sens["monte_carlo_sample_size"]
        for key in ms["10000"]["metrics"]:
            c = [ms[n]["metrics"][key] for n in ("1000", "10000", "50000")]
            w(f"| {key} | {' / '.join(f'{x['mean_crps_ar1']:.5f}' for x in c)} | {' / '.join(f'{x['mean_d']:+.5f}' for x in c)} | "
              f"{ms['1000']['vs_10000'][key]['max_abs_change_E']:.4f} / {ms['50000']['vs_10000'][key]['max_abs_change_E']:.4f} |")
        w("")
        w("**Specification variants.** Each is scored with the same block-bootstrap streams as the primary run, so "
          "the intervals are directly comparable. The 12-month block resampling is the lag-12 check.")
        w("")
        for name, note in sens["variant_notes"].items():
            w(f"- *{name}*: {note}.")
        w("")
        w("| Variant | Policy / product | Mean CRPS AR(1) | Mean CRPS climatology | Mean diff | 95% CI, L = 24 / 48 / 96 | All CIs exclude 0? | Non-overlapping mean diff | Mean abs change of E[s] vs primary |")
        w("|---|---|---|---|---|---|---|---|---|")
        for name, summ in sens["variants"].items():
            for key, x in summ.items():
                cis = " / ".join(f"[{c[0]:+.4f}, {c[1]:+.4f}]" for c in x["ci95"].values())
                excl = "below 0" if x["all_blocks_below_0"] else "above 0" if x["all_blocks_above_0"] else "no"
                chg = sens["forecast_changes_vs_primary"].get(name, {}).get(key, {}).get("mean_abs_change_E")
                w(f"| {name} | {key} | {x['mean_crps_ar1']:.4f} | {x['mean_crps_clim']:.4f} | {x['mean_d']:+.4f} | {cis} | "
                  f"{excl} | {_f(x['non_overlapping_mean_d'])} | {'—' if chg is None else f'{chg:.4f}'} |")
        w("")
    dg = r["diagnostics"]
    w("## AR(1) diagnostics")
    w("")
    w("| Origin | n | a | b | Residual sd | ACF(1) | ACF(12) | Ljung–Box p (12 lags, df 11) | Skew | Excess kurtosis | Jarque–Bera p | Share abs z > 3 |")
    w("|---|---|---|---|---|---|---|---|---|---|---|---|")
    for t, x in dg["selected_origins"].items():
        w(f"| {t} | {x['n']} | {x['a']:.4f} | {x['b']:.4f} | {x['resid_sd']:.4f} | {x['acf1']:+.3f} | {x['acf12']:+.3f} | "
          f"{x['ljung_box_p12']:.2g} | {x['skew']:+.2f} | {x['excess_kurtosis']:.1f} | {x['jarque_bera_p']:.2g} | {x['share_abs_z_gt_3']:.4f} |")
    o = dg["over_all_origins"]
    w("")
    w(f"Across all origins: b from {o['b_min']:.4f} to {o['b_max']:.4f} (share with b ≥ 1: {o['share_b_ge_1']:.3f}); "
      f"residual sd {o['resid_sd_min']:.4f}–{o['resid_sd_max']:.4f}; ACF(12) {o['acf12_range'][0]:+.3f} to "
      f"{o['acf12_range'][1]:+.3f}; Ljung–Box p < 0.05 at {o['share_ljung_box_p12_below_0_05']:.3f} of origins; "
      f"excess kurtosis {o['excess_kurtosis_range'][0]:.1f}–{o['excess_kurtosis_range'][1]:.1f} (Gaussian share of "
      f"abs z > 3: {dg['gaussian_share_abs_z_gt_3']:.4f}).")
    w("")
    w("What these diagnostics can establish: whether the one-step AR(1) residuals look like the i.i.d. Gaussian noise "
      "the simulation assumes (serial correlation, the lag-12 overlap of year-on-year inflation, fat tails). What they "
      "cannot establish: whether the misspecification matters for a 48-month score forecast. That is what the CRPS "
      "comparison and the innovation sensitivity measure.")
    w("")
    w("## Pricing: the asking policy, evaluated separately")
    w("")
    w(f"{r['pricing_policy']['policy']}. κ = 0.5 is the team's declared value. The other κ values are shown as "
      "sensitivity and were not used to choose anything. The AR(1) expected score is a forecast under the physical "
      "measure, not a market-fair price (maths note 6.3).")
    w("")
    w("| Policy / product | κ | Role | Mean premium | Mean payout | Mean seller result (= buyer net cost) | Seller wins | Worst seller result | Clamp binds | 95% CI of mean seller result (L = 48) |")
    w("|---|---|---|---|---|---|---|---|---|---|")
    for pol in POLICIES:
        for prod in PRODUCTS:
            for kk, x in r["pricing_policy"][pol][prod].items():
                ci = x["seller_result_block48"]["ci95"]
                w(f"| {pol}/{prod} | {kk.split('_')[1]} | {x['role']} | {x['mean_premium']:.4f} | {x['mean_payout']:.4f} | "
                  f"{x['mean_seller_result']:+.4f} | {x['share_origins_seller_wins']:.3f} | {x['worst_seller_result']:+.4f} | "
                  f"{x['share_clamp_binding']:.3f} | [{ci[0]:+.4f}, {ci[1]:+.4f}] |")
    w("")
    w("Per-origin premium, payout, seller result and buyer net cost for κ = 0.5 are in `per_origin[*].<policy>.<product>.quote_kappa_0_5`.")
    w("")
    cj = r["cross_checks"].get("jan2021")
    if cj:
        w("## Cross-checks at the 2021-01 origin")
        w("")
        w(f"- Realised scores, fixed caps: {cj['realised_fixed_caps']} (expected {cj['expected_realised_fixed_caps']}).")
        v50 = r["sensitivity"].get("jan2021_V0_at_50000_paths") if r["sensitivity"] else None
        w(f"- AR(1) V0, fixed caps, N = {r['settings']['n_paths']}: Cooling {cj['V0_ar1_fixed_caps']['cooling']:.4f}, "
          f"Excess {cj['V0_ar1_fixed_caps']['excess']:.4f}"
          + (f"; N = 50,000: Cooling {v50['cooling']:.4f}, Excess {v50['excess']:.4f}" if v50 else "")
          + f". Maths note reference: Cooling ≈ {cj['maths_note_reference_V0']['cooling']}, Excess ≈ "
          f"{cj['maths_note_reference_V0']['excess']} ({cj['maths_note_reference_V0']['note']}).")
        if cj.get("V0_by_variant"):
            w("")
            w("| Specification at 2021-01 | V0 Cooling (cap 8) | V0 Excess (cap 80) |")
            w("|---|---|---|")
            for name, x in cj["V0_by_variant"].items():
                w(f"| {name} | {x['cooling']:.4f} | {x['excess']:.4f} |")
            w("")
            w(f"**Finding.** {cj['finding']}")
        w("")
    w("## Limitations")
    w("")
    w(f"- About {r['effective_sample']['n_origins'] / H:.0f} independent 48-month blocks: average CRPS differences are "
      "noisy, and the bootstrap intervals are wide.")
    w(f"- The AR(1) fit window is not pinned down by the sources: the notebook fits on all history, the maths note's "
      f"reference on 1997–2020. The primary (declared) uses all history; the {FIT_WINDOW}-month variant shows the other "
      "reading.")
    w("- Policy A's caps were chosen after seeing 2021–24. Policy B's early origins rest on few eligible windows, and "
      "Excess has no valid B cap until enough post-1960 windows show any excess.")
    w("- Data timing: the forecast at t0 uses CPI for t0 − 1, which is published in the middle of month t0.")
    w("- The AR(1) is fitted to year-on-year inflation, an overlapping 12-month sum, so its residuals are serially "
      "correlated by construction. Gaussian innovations understate the tails seen in the residuals.")
    w("- Climatology starts in 1914, including both world wars and the 1920–21 and 1930s deflations. The 1960-start "
      "sensitivity shows how much that matters.")
    w("- The team's actual quote code (`forecast/ar1.py`) is not in the repository, so the pricing section evaluates "
      "the declared policy formula, not that code.")
    if r["data"].get("first_missing_value"):
        w(f"- The FRED snapshot has an empty value for {r['data']['first_missing_value']} (that month's CPI was not "
          "published). This backtest needs nothing after 2024-12, but any future 48-month window that spans that month "
          "cannot be computed from FRED as is.")
    w("")
    w("## Reproduce")
    w("")
    w("```bash")
    w("pixi run fetch                              # only if data/snapshots/CPIAUCNS.json is missing (it is gitignored)")
    w("pixi run pytest tests/research -q")
    w("pixi run python forecast/backtest.py        # writes forecast/backtest.json and forecast/backtest.md")
    w("```")
    w("")
    return "\n".join(L)


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--n-paths", type=int, default=10_000)
    ap.add_argument("--seed", type=int, default=DEFAULT_SEED)
    ap.add_argument("--boot", type=int, default=10_000, help="bootstrap replicates")
    ap.add_argument("--first", default=str(ORIGIN_FIRST))
    ap.add_argument("--last", default=str(ORIGIN_LAST))
    ap.add_argument("--no-sensitivity", action="store_true")
    ap.add_argument("--quick", action="store_true", help="3 origins, N=500, no sensitivity, print only")
    ap.add_argument("--out-json", default=None)
    ap.add_argument("--out-md", default=None)
    args = ap.parse_args(argv)
    data = load_data()
    if args.quick:
        origins = origins_between(pd.Period("2020-11", "M"), pd.Period("2021-01", "M"))
        rep = build_report(data, origins, 500, args.seed, 500, sensitivity=False)
    else:
        origins = origins_between(pd.Period(args.first, "M"), pd.Period(args.last, "M"))
        rep = build_report(data, origins, args.n_paths, args.seed, args.boot, sensitivity=not args.no_sensitivity)
    out_json = Path(args.out_json) if args.out_json else (None if args.quick else OUT_JSON)
    out_md = Path(args.out_md) if args.out_md else (None if args.quick else OUT_MD)
    if out_json:
        out_json.write_text(dumps_report(rep), encoding="utf-8")
        print(f"wrote {out_json}")
    if out_md:
        out_md.write_text(render_markdown(rep), encoding="utf-8")
        print(f"wrote {out_md}")
    for line in rep["conclusion"]:
        print(f"- {line}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
