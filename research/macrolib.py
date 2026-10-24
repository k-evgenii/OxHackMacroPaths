"""Shared helpers for the macro-paths research notebook.

Everything here is exploratory and off-chain. Floats are fine. The on-chain
program only ever sees integer rows; the transforms below say which integer
row each product would need.
"""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
SNAP = ROOT / "data" / "snapshots"

# ---------------------------------------------------------------------------
# Loading and monthly alignment


def load(series_id: str) -> pd.Series:
    """One FRED snapshot as a float series indexed by date. '.' rows dropped."""
    snap = json.loads((SNAP / f"{series_id}.json").read_text())
    rows = [(r["date"], r["value_str"]) for r in snap["rows"] if r["value_str"] not in ("", ".")]
    s = pd.Series([float(v) for _, v in rows], index=pd.to_datetime([d for d, _ in rows]), name=series_id)
    s.attrs["frequency"] = snap.get("frequency")
    return s


def monthly(s: pd.Series, how: str = "mean") -> pd.Series:
    """Daily/weekly to calendar-month. `how` is the declared aggregation rule
    (it becomes part of the dataset id on-chain). Monthly series pass through."""
    if s.attrs.get("frequency") == "monthly":
        out = s.copy()
        out.index = out.index.to_period("M")
        return out
    g = s.groupby(s.index.to_period("M"))
    out = g.mean() if how == "mean" else g.last()
    out.name = s.name
    return out


def panel(spec: dict[str, str]) -> pd.DataFrame:
    """spec: {series_id: aggregation}. Returns a monthly DataFrame."""
    cols = [monthly(load(k), how) for k, how in spec.items()]
    out = pd.concat(cols, axis=1).sort_index()
    assert out.index.is_monotonic_increasing and out.index.is_unique
    return out


# ---------------------------------------------------------------------------
# Transforms (these define what the integer row x_t would be)


def yoy(s: pd.Series) -> pd.Series:
    """Year-on-year percent change, the CPI transform of the maths note eq. (1)."""
    return 100.0 * (s / s.shift(12) - 1.0)


def mom_diff(s: pd.Series) -> pd.Series:
    return s.diff()


def zscore(s: pd.Series, fit_until: str = "2020-12") -> pd.Series:
    """Standardise with mean/sd fitted strictly before `fit_until` (inclusive).
    On-chain these two numbers are fixed integers on the session."""
    hist = s[: pd.Period(fit_until, "M")].dropna()
    return (s - hist.mean()) / hist.std(ddof=1)


# ---------------------------------------------------------------------------
# Path statistics, exact mirrors of the on-chain recursions


def max_decline(x: np.ndarray) -> float:
    """Largest peak-to-later-trough decline. Section 2 of the maths note."""
    peak, d = -np.inf, 0.0
    for v in x:
        peak = max(peak, v)
        d = max(d, peak - v)
    return d


def max_rise(x: np.ndarray) -> float:
    """Largest trough-to-later-peak rise (the mirror image)."""
    return max_decline(-x)


def accumulated_excess(x: np.ndarray, k: float) -> float:
    return float(np.sum(np.maximum(x - k, 0.0)))


def time_above(x: np.ndarray, k: float) -> int:
    return int(np.sum(x > k))


def time_below(x: np.ndarray, k: float) -> int:
    return int(np.sum(x < k))


def sahm_gap(u: np.ndarray) -> np.ndarray:
    """3-month mean of unemployment minus the minimum of that mean over the
    previous 12 months. Needs 14 months of history before the first value."""
    s = pd.Series(u)
    m3 = s.rolling(3).mean()
    low12 = m3.shift(1).rolling(12).min()
    return (m3 - low12).to_numpy()


STATS = {
    "max_decline": max_decline,
    "max_rise": max_rise,
}


def rolling_windows(s: pd.Series, window: int = 48, step: int = 1):
    """Yield (start_period, values) for every full window of length `window`."""
    v = s.dropna()
    idx = v.index
    arr = v.to_numpy()
    for i in range(0, len(arr) - window + 1, step):
        yield idx[i], arr[i : i + window]


def window_stats(s: pd.Series, fn, window: int = 48, **kw) -> pd.Series:
    out = {start: fn(vals, **kw) for start, vals in rolling_windows(s, window)}
    return pd.Series(out, name=f"{s.name}:{fn.__name__}")


# ---------------------------------------------------------------------------
# AR(1) = discrete Ornstein-Uhlenbeck


def fit_ou(s: pd.Series, until: str = "2020-12") -> dict:
    """x_{t+1} = a + b x_t + e, fitted by OLS on data up to `until`.
    OU mapping on a monthly grid: kappa = -ln(b), theta = a/(1-b),
    sigma_OU = sd(e) * sqrt(2 kappa / (1 - b^2)), half-life = ln2/kappa months."""
    v = s[: pd.Period(until, "M")].dropna()
    x0, x1 = v.to_numpy()[:-1], v.to_numpy()[1:]
    # Closed-form OLS for one regressor: b = cov/var, a = mean(y) - b mean(x).
    # (Run with the pixi env activated: numpy's BLAS needs Library/bin on PATH.)
    mx, my = x0.mean(), x1.mean()
    b = float(np.sum((x0 - mx) * (x1 - my)) / np.sum((x0 - mx) ** 2))
    a = float(my - b * mx)
    resid = x1 - (a + b * x0)
    sd = resid.std(ddof=2)
    b_c = min(max(b, 1e-6), 0.999999)
    kappa = -np.log(b_c)
    theta = a / (1 - b_c)
    sigma = sd * np.sqrt(2 * kappa / (1 - b_c**2))
    return {
        "series": s.name, "n": len(v), "a": a, "b": b, "resid_sd": sd,
        "kappa_per_month": kappa, "theta": theta, "sigma_ou": sigma,
        "half_life_months": np.log(2) / kappa if kappa > 0 else np.inf,
        "stationary_sd": sd / np.sqrt(1 - b_c**2),
    }


def simulate_ar1(fit: dict, x0: float, horizon: int, n_paths: int, rng=None) -> np.ndarray:
    rng = rng or np.random.default_rng(0)
    e = rng.normal(0.0, fit["resid_sd"], size=(n_paths, horizon))
    out = np.empty((n_paths, horizon))
    x = np.full(n_paths, x0)
    for t in range(horizon):
        x = fit["a"] + fit["b"] * x + e[:, t]
        out[:, t] = x
    return out


def forecast_score(fit: dict, x0: float, stat_fn, cap: float, horizon: int = 48,
                   n_paths: int = 10_000, **kw) -> tuple[float, float, np.ndarray]:
    """V = E[min(stat, cap)/cap], sigma, and the raw stat samples."""
    paths = simulate_ar1(fit, x0, horizon, n_paths)
    stats = np.array([stat_fn(p, **kw) for p in paths])
    score = np.minimum(stats, cap) / cap
    return float(score.mean()), float(score.std()), stats
