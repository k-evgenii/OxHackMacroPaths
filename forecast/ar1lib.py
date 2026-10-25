"""AR(1) = discrete Ornstein-Uhlenbeck, fitted and simulated for the advisory forecast.

x_{t+1} = a + b x_t + e,  e ~ N(0, resid_sd^2).  Fit by closed-form OLS (one regressor).
Floats are used for the fit and the shocks only; every simulated path is rounded to
integers and rolled through the exact integer recursions of tests/make_vectors.py, so
the simulated scores live in the same integer world as the chain.
"""
from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np

ONE = 1_000_000


@dataclass(frozen=True)
class Fit:
    a: float
    b: float
    resid_sd: float
    n: int
    first: str
    last: str

    @property
    def kappa(self) -> float:          # per month
        return -math.log(min(max(self.b, 1e-9), 1 - 1e-9))

    @property
    def half_life(self) -> float:      # months
        return math.log(2) / self.kappa

    def as_dict(self) -> dict:
        return {"a": self.a, "b": self.b, "resid_sd": self.resid_sd, "n": self.n,
                "fit_window": [self.first, self.last], "kappa_per_month": self.kappa,
                "half_life_months": self.half_life}


def fit_ar1(row: list[tuple[str, int]], start: str, end: str) -> Fit:
    pts = [(m, float(x)) for m, x in row if start <= m <= end]
    x = np.array([v for _, v in pts])
    x0, x1 = x[:-1], x[1:]
    mx, my = x0.mean(), x1.mean()
    b = float(np.sum((x0 - mx) * (x1 - my)) / np.sum((x0 - mx) ** 2))
    a = float(my - b * mx)
    resid = x1 - (a + b * x0)
    return Fit(a, b, float(resid.std(ddof=2)), len(x), pts[0][0], pts[-1][0])


def simulate(fit: Fit, x0: int, horizon: int, n_paths: int, rng: np.random.Generator) -> np.ndarray:
    """Integer paths, shape (n_paths, horizon). Each step rounds to the nearest integer."""
    out = np.empty((n_paths, horizon), dtype=np.int64)
    x = np.full(n_paths, float(x0))
    shocks = rng.normal(0.0, fit.resid_sd, size=(n_paths, horizon))
    for t in range(horizon):
        x = fit.a + fit.b * x + shocks[:, t]
        xi = np.rint(x).astype(np.int64)
        out[:, t] = xi
        x = xi.astype(float)        # the chain only ever sees integers; condition on them
    return out


# ---- exact integer recursions, vectorised over paths -------------------------

def roll_cooling(paths: np.ndarray, peak0: int | None, d0: int) -> np.ndarray:
    """Final max_decline per path, starting from state (peak0, d0). peak0=None means -inf."""
    peak = np.full(paths.shape[0], np.iinfo(np.int64).min if peak0 is None else peak0, dtype=np.int64)
    d = np.full(paths.shape[0], d0, dtype=np.int64)
    for t in range(paths.shape[1]):
        x = paths[:, t]
        peak = np.maximum(peak, x)
        d = np.maximum(d, peak - x)
    return d


def roll_excess(paths: np.ndarray, a0: int, k: int) -> np.ndarray:
    a = np.full(paths.shape[0], a0, dtype=np.int64)
    for t in range(paths.shape[1]):
        a = a + np.maximum(paths[:, t] - k, 0)
    return a


def score_millionths(stat: np.ndarray, cap: int) -> np.ndarray:
    return (np.minimum(stat, cap).astype(np.int64) * ONE) // cap


QUOTE_KAPPA = 0.5
QUOTE_LO = 50_000
QUOTE_HI = 950_000
QUOTE_FORMULA = "clamp(V0 + 0.5*sigma0, 0.05, 0.95)"


def clamp_quote(v: float, sigma: float, kappa: float = QUOTE_KAPPA, lo: int = QUOTE_LO, hi: int = QUOTE_HI) -> int:
    """The one seller-quote formula (millionths). Imported by ar1.py and export_artifact.py."""
    p = int(math.floor((v + kappa * sigma) * ONE))
    return max(lo, min(hi, p))


def forecast_from(origin_state: dict, row_name: str, n_months: int, *, fit: Fit, stat: str,
                  k: int | None, cap: int, rng: np.random.Generator | None = None,
                  n_paths: int = 10_000, seed: int = 2026) -> dict:
    """Expected score V and sigma for one product from an observed state.

    origin_state: {"x": last observed value, "M": running peak (None=-inf), "D": running
    max decline, "A": running excess}. row_name is "cooling" (max_decline) or "excess"/"fuel"
    (excess); `stat` selects the recursion. With n_months == 0 the score is the realised one.
    Pass `rng` to share a stream (reproduces ar1.py's table); otherwise a fresh seeded one.
    """
    if rng is None:
        rng = np.random.default_rng(seed)
    if n_months > 0:
        paths = simulate(fit, origin_state["x"], n_months, n_paths, rng)
        vals = (roll_cooling(paths, origin_state["M"], origin_state["D"]) if stat == "max_decline"
                else roll_excess(paths, origin_state["A"], k))
    else:
        vals = np.array([origin_state["D"] if stat == "max_decline" else origin_state["A"]])
    sc = score_millionths(vals, cap) / 1e6
    v, s = float(sc.mean()), float(sc.std())
    return {"row": row_name, "V": v, "sigma": s, "se": s / math.sqrt(len(sc)), "p_cap": float((sc >= 1).mean())}


RW_LABEL = "Random-walk benchmark (Atkeson-Ohanian): every future month equals the last observed value. Advisory; settlement uses the realised path only."


def random_walk_v(origin_state: dict, n_months: int, *, stat: str, k: int | None, cap: int) -> float:
    """Score of the flat path at the last observed value, rolled through the exact recursions."""
    path = np.full((1, n_months), int(origin_state["x"]), dtype=np.int64)
    vals = (roll_cooling(path, origin_state["M"], origin_state["D"]) if stat == "max_decline"
            else roll_excess(path, origin_state["A"], k))
    return float(score_millionths(vals, cap)[0]) / 1e6
