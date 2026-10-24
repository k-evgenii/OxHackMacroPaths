"""Build research/macro_paths.ipynb from cells defined here, then execute it in place."""
import nbformat as nbf
from pathlib import Path

nb = nbf.v4.new_notebook()
cells = []
md = lambda s: cells.append(nbf.v4.new_markdown_cell(s.strip()))
code = lambda s: cells.append(nbf.v4.new_code_cell(s.strip()))

md(r"""
# MacroPaths: which macro paths are worth a contract?

Exploratory, off-chain. The question this notebook answers: of the macro series we can commit to the chain, **which path statistics describe an economic event that someone would pay to hedge, who sits on each side, and what parameters (threshold, cap) make the contract meaningful?**

Everything the on-chain program can settle is a statistic of the form $S_t = f(S_{t-1}, x_t, t)$ with bounded state, over a committed monthly row $x_t$. The family we use:

| statistic | recursion | event it measures |
| --- | --- | --- |
| `max_decline` | $M_t=\max(M_{t-1},x_t),\ D_t=\max(D_{t-1},M_t-x_t)$ | how far the series fell from its running high |
| `max_rise` | same on $-x_t$ | how far it rose from its running low |
| `accumulated_excess` | $A_t=A_{t-1}+(x_t-K)^+$ | how much, for how long, it stayed above $K$ |
| `time_above` / `time_below` | $N_t=N_{t-1}+\mathbb 1[x_t>K]$ | how many months it stayed above / below $K$ |

Score $= \min(S_T, \text{cap})/\text{cap}$ in millionths. Each product is one sub-pool: two sides, side-level budgets, settled on the same committed data as every other sub-pool in the session. The maths is in `macropaths-maths.tex`; the program spec in `docs/program-spec.md`.

Data: FRED snapshots frozen by `data/fetch.py` (no key). Daily and weekly series are **month-averaged**, a declared rule that becomes part of the dataset id.
""")

code(r"""
import sys, pathlib, warnings
sys.path.insert(0, str(pathlib.Path.cwd()))
warnings.filterwarnings("ignore")
import numpy as np, pandas as pd, matplotlib.pyplot as plt
from macrolib import panel, fit_ou, rolling_windows, yoy, zscore, simulate_ar1, max_decline, max_rise, accumulated_excess, time_above, time_below, sahm_gap, load
from products import PRODUCTS, BY_KEY, PANEL_SPEC
pd.set_option("display.width", 200, "display.max_columns", 40, "display.float_format", lambda v: f"{v:,.3f}")
plt.rcParams["figure.dpi"] = 110
P = panel(PANEL_SPEC)
W = 48
REPLAY_START = pd.Period("2021-01", "M")
HIST_END = pd.Period("2020-12", "M")
CAP_WINDOW_START = pd.Period("1960-01", "M")   # declared: caps and quantiles use post-1960 windows
print("panel", P.shape, "months", P.index.min(), "..", P.index.max())
""")

md("## 1. What we have: coverage per series")
code(r"""
avail = pd.DataFrame({c: {"first": P[c].first_valid_index(), "last": P[c].last_valid_index(),
                          "months": int(P[c].notna().sum()), "aggregation": PANEL_SPEC[c]} for c in P}).T
avail["covers_2021_24"] = [(f <= REPLAY_START) and (l >= REPLAY_START + W - 1) for f, l in zip(avail["first"], avail["last"])]
avail.sort_values("first")
""")

md("""
Every series covers the 2021–2024 replay. The high-yield credit spread (`BAMLH0A0HYM2`) is excluded: FRED's CSV endpoint returns it only from October 2023.

## 2. The rows the products are built on

Each product transforms one or two series into a monthly row $x_t$. These are the paths the contracts would settle on.
""")
code(r"""
rows = {p.key: p.series(P) for p in PRODUCTS}
R = pd.DataFrame(rows)
view = R[pd.Period("2015-01","M"):pd.Period("2025-06","M")]
fig, axes = plt.subplots(5, 3, figsize=(15, 14), sharex=True)
for ax, (k, s) in zip(axes.ravel(), view.items()):
    p = BY_KEY[k]
    ax.plot(s.index.to_timestamp(), s.values, lw=1.4)
    ax.axvspan(pd.Timestamp("2021-01-01"), pd.Timestamp("2024-12-31"), color="0.9")
    if p.k is not None:
        ax.axhline(p.k, color="C3", lw=0.8, ls="--")
    ax.set_title(f"{p.name}  [{p.row}]", fontsize=9)
    ax.grid(alpha=.3)
fig.suptitle("Product rows, 2015–2025. Grey = the 48-month replay window; dashed = threshold K", y=1.0)
plt.tight_layout(); plt.show()
""")

md(r"""
## 3. The SDE view: every row as a discrete Ornstein–Uhlenbeck process

The advisory forecast model is AR(1), $x_{t+1} = a + b\,x_t + \varepsilon_{t+1}$, which is the exact monthly discretisation of OU, $dX = \kappa(\theta - X)\,dt + \sigma\,dW$, with $b = e^{-\kappa}$. Fitted on data to December 2020 only.

What matters for path products is the **half-life** $\ln 2/\kappa$:

- slow reversion (half-life of years): the series wanders, so `max_decline`, `max_rise` and `accumulated_excess` have fat right tails and the cap binds rarely. Inflation, policy rate, mortgage rate.
- fast reversion (months): spikes are short, so `time_above` and `accumulated_excess` are the natural products, and the cap can be tight. Housing starts, VIX.
""")
code(r"""
fits = pd.DataFrame([fit_ou(R[k].rename(k)) for k in R]).set_index("series")
fits = fits[["n", "b", "kappa_per_month", "half_life_months", "theta", "stationary_sd", "resid_sd"]]
fits.sort_values("half_life_months", ascending=False)
""")
code(r"""
fig, ax = plt.subplots(figsize=(9, 4.5))
hl = fits["half_life_months"].clip(upper=120).sort_values()
ax.barh(hl.index, hl.values, color=["C3" if v >= 120 else "C0" for v in hl.values])
ax.set_xlabel("AR(1) half-life, months (clipped at 120)"); ax.set_title("Mean-reversion speed of each product row, fit to 2020-12")
ax.grid(axis="x", alpha=.3); plt.tight_layout(); plt.show()
""")

md(r"""
## 4. How unusual was 2021–2024? Path statistics over every historical 48-month window

For each product: compute its statistic over every 48-month window ending by December 2020 (post-1960 only, so wartime inflation does not set the scale), then the realised 2021–2024 value and its percentile rank. The 90th percentile of history is the **cap candidate**: a declared, pre-2021 quantile, which the maths note names as the defensible way to choose it.
""")
code(r"""
rows_out, hist_stats = [], {}
for p in PRODUCTS:
    s = R[p.key].dropna()
    hist = s[max(CAP_WINDOW_START, s.index.min()): HIST_END]
    stats = pd.Series({st: p.stat_value(v) for st, v in rolling_windows(hist, W)})
    real = s[REPLAY_START: REPLAY_START + W - 1]
    realised = p.stat_value(real.to_numpy()) if len(real) == W else np.nan
    q = stats.quantile([0.5, 0.9, 0.99])
    rows_out.append({"product": p.name, "statistic": p.stat, "K": p.k, "windows": len(stats), "history_from": str(stats.index.min()),
                     "p50": q[0.5], "p90 (cap candidate)": q[0.9], "p99": q[0.99], "realised 2021-24": realised,
                     "percentile": (stats < realised).mean(), "score at p90 cap": min(realised / q[0.9], 1.0) if q[0.9] > 0 else np.nan})
    hist_stats[p.key] = stats
T = pd.DataFrame(rows_out).set_index("product")
T
""")
code(r"""
fig, ax = plt.subplots(figsize=(9, 5))
pc = T["percentile"].sort_values()
ax.barh(pc.index, pc.values, color=["C3" if v > 0.9 else "C0" for v in pc.values])
ax.axvline(0.9, color="k", ls="--", lw=.8)
ax.set_xlabel("percentile of the 2021–24 statistic among post-1960 48-month windows")
ax.set_title("Which paths were historically extreme in 2021–24 (red: above the 90th percentile)")
ax.grid(axis="x", alpha=.3); plt.tight_layout(); plt.show()
""")

md("""
Reading: the **real-rate shock, fuel pass-through, hiring freeze, curve inversion and mortgage lock-in** were top-decile events. Headline inflation's excess (80th percentile post-1960) was large but not unprecedented, because the 1970s are in the comparison set. The stagflation composite never fired at +1 sd, because unemployment stayed low: 2022 was an inflation and rates shock, not a stagflation. That is itself a finding worth stating on stage, and the reason the composite threshold is revisited in section 6.

## 5. Which products hedge *different* events? Correlation of the window statistics

Two products whose statistics move together across history are the same hedge in different clothes. Low correlation means separate risks, and that is what justifies separate sub-pools.
""")
code(r"""
S = pd.DataFrame(hist_stats); S.index = pd.PeriodIndex(S.index, freq="M")
S = S[pd.Period("1990-01","M"):]        # common window where most series exist
C = S.corr(min_periods=60)
fig, ax = plt.subplots(figsize=(10, 8))
im = ax.imshow(C.values, cmap="RdBu_r", vmin=-1, vmax=1)
ax.set_xticks(range(len(C))); ax.set_xticklabels(C.columns, rotation=60, ha="right"); ax.set_yticks(range(len(C))); ax.set_yticklabels(C.index)
for i in range(len(C)):
    for j in range(len(C)):
        v = C.values[i, j]
        if not np.isnan(v): ax.text(j, i, f"{v:.1f}", ha="center", va="center", fontsize=7, color="w" if abs(v) > .6 else "k")
plt.colorbar(im, ax=ax, shrink=.8); ax.set_title("Correlation of 48-month window statistics, windows starting 1990+")
plt.tight_layout(); plt.show()
""")
code(r"""
# A crude clustering: average-linkage on 1 - corr, by hand (no scipy.linalg needed).
keys = list(C.columns); D = 1 - C.fillna(0).values
clusters = [[k] for k in keys]
def dist(a, b): return np.mean([D[keys.index(i), keys.index(j)] for i in a for j in b])
while len(clusters) > 5:
    best = min(((dist(a, b), i, j) for i, a in enumerate(clusters) for j, b in enumerate(clusters) if i < j))
    _, i, j = best; clusters[i] = clusters[i] + clusters[j]; del clusters[j]
for n, c in enumerate(clusters, 1):
    print(f"cluster {n}: " + ", ".join(BY_KEY[k].name for k in c))
""")

md(r"""
What the heatmap and the crude clustering agree on, and what they don't:

1. **The labour-break cluster is robust**: Sahm trigger, hiring freeze and the stagflation composite (which is driven by its unemployment leg) move together and are nearly uncorrelated with every inflation or rates product. That is the one unambiguous second risk factor in the data, and the strongest case for a separate sub-pool.
2. **The inflation and rates products are one family seen through different balance sheets**, but the family splits by what drives the window: price-level products (excess inflation, real-wage squeeze, sticky core) correlate with each other at 0.6–0.9; policy-rate products (hiking cost, mortgage lock-in) pair off; the curve and real-rate products sit between. Offer one or two of these per session, not six, or the sub-pools are the same bet.
3. **Short histories mislead**: real-rate shock (2003+), dollar (2007+) and hiring freeze (2001+) have under 200 windows, so their 0.9 correlations with cooling rest on two cycles. Treat them as unproven.
4. **Fuel, housing and volatility are weakly related to everything else** (the clustering pairs fuel with housing only because they are each far from the rest). Any of the three adds a genuinely different sub-pool.

## 6. The sub-pool menu

Each row below is one two-sided sub-pool. The "more" side buys protection against the event; the "less" side is the natural party on the other side of that exposure, or a funded seller. All of them settle on the same committed monthly row, in one session, by the same side-budget rule.
""")
code(r"""
menu = pd.DataFrame([{
    "product": p.name, "row x_t": p.row, "statistic": p.stat, "K": p.k,
    "event (pays the MORE side)": p.event,
    "MORE side (hedger)": p.more_side, "LESS side (natural counterparty)": p.less_side,
    "cap rule": p.cap_rule,
    "realised score @p90 cap": T.loc[p.name, "score at p90 cap"],
} for p in PRODUCTS]).set_index("product")
with pd.option_context("display.max_colwidth", 60):
    display(menu)
""")

md(r"""
### Fixing the composite

With pre-2021 standardisation, the stagflation composite needs a threshold set from its own history. The table shows the realised time-above at several thresholds against the historical 90th percentile; the one to declare is the lowest threshold at which history is informative (p90 strictly between 0 and 48) and 2021–24 is distinguishable.
""")
code(r"""
comp = R["stagflation"].dropna()
out = []
for k in [0.0, 0.25, 0.5, 0.75, 1.0]:
    hist = comp[CAP_WINDOW_START:HIST_END]
    st = pd.Series({s0: time_above(v, k) for s0, v in rolling_windows(hist, W)})
    real = time_above(comp[REPLAY_START:REPLAY_START + W - 1].to_numpy(), k)
    out.append({"threshold (sd)": k, "p50": st.quantile(.5), "p90": st.quantile(.9), "realised 2021-24": real, "percentile": (st < real).mean()})
pd.DataFrame(out).set_index("threshold (sd)")
""")

md(r"""
## 7. Forecast at the start of the replay, per product (advisory, never executed against)

AR(1) fitted to December 2020, 10,000 paths from the December 2020 value, exact recursions on each path, score with the p90 cap. $V_0$ is what a seller quoting at session start would have believed; the realised score is what the chain paid. The gap is the product.
""")
code(r"""
rng = np.random.default_rng(42)
fc = []
for p in PRODUCTS:
    s = R[p.key].dropna()
    if s.index.max() < REPLAY_START + W - 1 or p.key == "sahm":   # sahm gap is derived; forecasting it needs the u path, skipped here
        continue
    fit = fit_ou(s.rename(p.key))
    x0 = float(s[:HIST_END].iloc[-1])
    cap = T.loc[p.name, "p90 (cap candidate)"]
    if not cap > 0: continue
    paths = simulate_ar1(fit, x0, W, 10_000, rng)
    stats = np.array([p.stat_value(path) for path in paths])
    score = np.minimum(stats, cap) / cap
    fc.append({"product": p.name, "x0 (Dec 2020)": x0, "cap": cap, "V0 = E[score]": score.mean(), "sigma": score.std(),
               "P(score=1)": (score >= 1).mean(), "realised score": T.loc[p.name, "score at p90 cap"]})
F = pd.DataFrame(fc).set_index("product")
F["realised - V0"] = F["realised score"] - F["V0 = E[score]"]
F.sort_values("realised - V0", ascending=False)
""")
code(r"""
fig, ax = plt.subplots(figsize=(9, 5))
Fs = F.sort_values("realised - V0")
ax.scatter(Fs["V0 = E[score]"], Fs.index, label="AR(1) forecast V0", zorder=3)
ax.scatter(Fs["realised score"], Fs.index, marker="x", color="C3", label="realised 2021-24", zorder=3)
for name, r in Fs.iterrows(): ax.plot([r["V0 = E[score]"], r["realised score"]], [name, name], color="0.6", lw=1)
ax.set_xlim(-0.02, 1.02); ax.set_xlabel("score (cap = post-1960 p90)"); ax.legend(); ax.grid(alpha=.3)
ax.set_title("What a baseline seller would have expected vs what the path paid")
plt.tight_layout(); plt.show()
""")

md(r"""
## 8. Dependence between sub-pools: a joint simulation

Expected payouts add regardless of dependence; the joint distribution matters for a seller's variance and for the tail where several sub-pools pay at once. A quick joint model: independent AR(1) dynamics per row, residuals correlated as in the pre-2021 residual correlation matrix (a small hand-written Cholesky keeps the notebook dependency-free).
""")
code(r"""
keys = [k for k in ["excess", "hiking", "inversion", "mortgage", "real_wage", "gasoline", "vol", "housing"] if k in R]
fits_j = {k: fit_ou(R[k].rename(k)) for k in keys}
resid = pd.DataFrame({k: (R[k].shift(-1) - (fits_j[k]["a"] + fits_j[k]["b"] * R[k]))[:HIST_END] for k in keys}).dropna()
Rc = resid.corr().values
def chol(A):
    n = len(A); L = np.zeros_like(A)
    for i in range(n):
        for j in range(i + 1):
            s = A[i, j] - L[i, :j] @ L[j, :j]
            L[i, j] = np.sqrt(max(s, 1e-12)) if i == j else s / L[j, j]
    return L
L = chol(Rc)
n_paths = 5000
z = rng.normal(size=(n_paths, W, len(keys))) @ L.T
scores = {}
for c, k in enumerate(keys):
    f = fits_j[k]; x = np.full(n_paths, float(R[k][:HIST_END].dropna().iloc[-1])); st = []
    paths = np.empty((n_paths, W))
    for t in range(W):
        x = f["a"] + f["b"] * x + f["resid_sd"] * z[:, t, c]; paths[:, t] = x
    p = BY_KEY[k]; cap = T.loc[p.name, "p90 (cap candidate)"]
    scores[k] = np.minimum(np.array([p.stat_value(pt) for pt in paths]), cap) / cap
Sc = pd.DataFrame(scores)
print("residual correlation (pre-2021):"); display(pd.DataFrame(Rc, index=keys, columns=keys).round(2))
print("score correlation under the joint model:"); display(Sc.corr().round(2))
tot = Sc.sum(axis=1)
print(f"sum of {len(keys)} scores: mean {tot.mean():.2f}, sd {tot.std():.2f}, 99th pct {tot.quantile(.99):.2f} (independent-legs sd would be {np.sqrt(Sc.var().sum()):.2f})")
""")

md(r"""
## 9. What this means for the contract

1. **The program already supports a menu.** A product on-chain is a statistic family, a leg (which row), a threshold `K` and a cap. The two built products are instances. Generalising `Session` to hold up to eight `(stat, leg, K, cap)` tuples and `observe` to accept a row vector is the only program change; settlement, claims, cover and the seller are untouched.
2. **Integer rows per product.** Rates and spreads in 1e-4 pp as now; price indices via the YoY transform; dollars-per-gallon in 1e-4 dollars; the v/u ratio in millionths; the composite in millionths of a standard deviation with the pre-2021 mean and sd stored as integers on the session.
3. **Caps are declared quantiles.** Post-1960 (or series start) 48-month windows, 90th percentile, rounded. The table in section 4 gives them. This replaces the "illustrative" caps with a stated rule.
4. **Aggregation rule is part of the dataset id.** Month-mean for daily and weekly series, stated in `docs/commitment-chain.md`.
5. **One session, several sub-pools, one data row.** The demo story becomes: the same committed inflation and rates history settles a tenant's rent hedge, a bank's curve hedge and a fleet's fuel hedge at once, each against its own natural counterparty.

## 10. Open questions for the team

- Which two or three sub-pools go in the demo session? My pick: Excess Inflation (tightening cluster), Sahm Trigger (labour cluster), Fuel Pass-through (standalone), because they are uncorrelated and each has an obvious hedger.
- Keep the chain monthly (48 rows, 2-second replay fits the demo) rather than weekly (209 rows)?
- Does the Sahm product need the 14-month pre-history in the committed row, or do we commit the gap itself as the row? Committing the gap is simpler and keeps `observe` O(1).
""")

nb["cells"] = cells
nb["metadata"]["kernelspec"] = {"name": "python3", "display_name": "Python 3", "language": "python"}
out = Path(__file__).parent / "macro_paths.ipynb"
nbf.write(nb, out)
print("wrote", out, len(cells), "cells")
