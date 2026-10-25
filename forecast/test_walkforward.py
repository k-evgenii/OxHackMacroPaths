"""Independent check of forecast/walkforward.json. Plain numpy/decimal, no use of ar1lib, manifest or walkforward.

Run: python forecast/test_walkforward.py   (exit 1 with a list of mismatches)
"""
from __future__ import annotations

import json
import math
import sys
from decimal import Decimal
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
WF = json.loads((ROOT / "forecast" / "walkforward.json").read_text(encoding="utf-8"))
TABLE = json.loads((ROOT / "forecast" / "table.json").read_text(encoding="utf-8"))
SNAP = json.loads((ROOT / "data" / "snapshots" / "CPIAUCNS.json").read_text(encoding="utf-8"))
K, CAP, ONE = 40_000, 1_883_141, 1_000_000

checks = 0
bad: list[str] = []


def eq(label, expected, found, tol=0.0):
    global checks
    checks += 1
    ok = (expected == found) if tol == 0 else abs(expected - found) <= tol
    if not ok:
        bad.append(f"{label}: expected {expected!r} found {found!r}")


def mnum(m):
    return int(m[:4]) * 12 + int(m[5:7]) - 1


def mstr(n):
    return f"{n // 12:04d}-{n % 12 + 1:02d}"


# raw integer YoY row: floor(1e6 * (P_t - P_{t-12}) / P_{t-12}), exact on Decimal values scaled to integers
vals = {r["date"][:7]: Decimal(r["value_str"]) for r in SNAP["rows"] if r["value_str"] not in ("", ".")}
scale = 10 ** max(-v.as_tuple().exponent for v in vals.values())
iv = {m: int(v * scale) for m, v in vals.items()}
X = {}
for m, p in iv.items():
    lag = mstr(mnum(m) - 12)
    if lag in iv:
        X[m] = (ONE * (p - iv[lag])) // iv[lag]


def ols(start, end):
    ms = [mstr(i) for i in range(mnum(start), mnum(end) + 1)]
    x = np.array([float(X[m]) for m in ms])
    x0, x1 = x[:-1], x[1:]
    b = np.sum((x0 - x0.mean()) * (x1 - x1.mean())) / np.sum((x0 - x0.mean()) ** 2)
    a = x1.mean() - b * x0.mean()
    r = x1 - (a + b * x0)
    return float(a), float(b), float(math.sqrt(np.sum(r * r) / (len(x1) - 2)))


def excess_a(origin):
    return sum(max(X[mstr(mnum(origin) + i)] - K, 0) for i in range(48))


def score(a, cap):
    return min(a, cap) * ONE // cap


rows = WF["rows"]
eq("n rows", 11, len(rows))
eq("origins", [mstr(mnum("1975-01") + 48 * i) for i in range(11)], WF["origins"])
eq("file cap", CAP, WF["cap"])
eq("file k", K, WF["k"])

# 1. fits at origins 1, 6, 11
for i in (0, 5, 10):
    r = rows[i]
    prev = mstr(mnum(r["origin"]) - 1)
    a, b, sd = ols("1960-01", prev)
    eq(f"{r['origin']} fit_window", ["1960-01", prev], r["fit_window"])
    # a, b, resid_sd are not stored per row, so the fit is checked through what it drives: an independent
    # re-simulation (fresh seed-2026 stream, 10000 paths, integer rounding each step) must give the row's V0/sigma0/quote.
    rng = np.random.default_rng(WF["seed"])
    sh = rng.normal(0.0, sd, size=(WF["n_paths"], 48))
    x = np.full(WF["n_paths"], float(X[prev]))
    acc = np.zeros(WF["n_paths"], dtype=np.int64)
    for t in range(48):
        xi = np.rint(a + b * x + sh[:, t]).astype(np.int64)
        acc += np.maximum(xi - K, 0)
        x = xi.astype(float)
    sc = (np.minimum(acc, CAP) * ONE // CAP) / 1e6
    eq(f"{r['origin']} V0 (own fit+sim)", float(sc.mean()), r["V0"], 1e-9)
    eq(f"{r['origin']} sigma0 (own fit+sim)", float(sc.std()), r["sigma0"], 1e-9)
    eq(f"{r['origin']} quote (own fit+sim)", min(max(int(math.floor((sc.mean() + 0.5 * sc.std()) * ONE)), 50_000), 950_000), r["quote"])
    flat = sum(max(X[prev] - K, 0) for _ in range(48))
    eq(f"{r['origin']} rw_V0", score(flat, CAP), r["rw_V0"])

# 2. realised score for all 11 origins, exact integers
for r in rows:
    a = excess_a(r["origin"])
    eq(f"{r['origin']} realised_score", score(a, CAP), r["realised_score"])
    eq(f"{r['origin']} error", r["V0"] - r["realised_score"] / ONE, r["error"], 1e-12)
    eq(f"{r['origin']} seller_pnl", r["quote"] - r["realised_score"], r["seller_pnl"])
    eq(f"{r['origin']} rw_seller_pnl", r["rw_quote"] - r["realised_score"], r["rw_seller_pnl"])
    eq(f"{r['origin']} inside_band", abs(r["V0"] - r["realised_score"] / ONE) <= r["sigma0"], r["inside_band"])
    q = min(max(round(r["V0"] * ONE + 0.5 * r["sigma0"] * ONE), 50_000), 950_000)
    eq(f"{r['origin']} quote ~ clamp(V0+0.5 sigma0) (+-1)", q, r["quote"], 1)

# 3. windows
data_first, data_last = min(X), max(X)
prev_end = None
for r in rows:
    o = mnum(r["origin"])
    s, e = r["fit_window"]
    eq(f"{r['origin']} fit ends before origin", True, mnum(e) < o)
    eq(f"{r['origin']} fit ends month before origin", o - 1, mnum(e))
    eq(f"{r['origin']} fit inside data", True, mnum(s) >= mnum(data_first) and mnum(e) <= mnum(data_last))
    eq(f"{r['origin']} 48m window inside data and <= 2020-12", True, o + 47 <= mnum("2020-12") and mstr(o + 47) in X)
    if prev_end is not None:
        eq(f"{r['origin']} window starts after previous window end", True, o > prev_end)
    prev_end = o + 47

# 4. cross-check
cc = WF["cross_check"]
a21, b21, sd21 = ols("1960-01", "2020-12")
fit = TABLE["fit"]["cpi"]
eq("2021 a vs table fit", a21, fit["a"], 1e-9)
eq("2021 b vs table fit", b21, fit["b"], 1e-9)
eq("2021 resid_sd vs table fit", sd21, fit["resid_sd"], 1e-9)
eq("cross_check table quotes", [384852, 57153], cc["table_quotes"])
eq("cross_check table quotes == table.json", TABLE["quotes"]["p"], cc["table_quotes"])
eq("cross_check reproduced", cc["table_quotes"], cc["reproduced"])
eq("cross_check fit window", ["1960-01", "2020-12"], cc["fit_window"])
eq("excess fresh-stream quote", 56035, cc["excess_fresh_stream_quote"])
note = cc["note"].lower()
eq("cross_check note: 384852 is cooling, 57153 excess", True,
   "384852 is the cooling" in note and "57153 the excess" in note)

# 5. summary arithmetic
s = WF["summary"]
err = [r["error"] for r in rows]
pnl = [r["seller_pnl"] for r in rows]
rpnl = [r["rw_seller_pnl"] for r in rows]
rwerr = [(r["rw_V0"] - r["realised_score"]) / ONE for r in rows]
eq("n", 11, s["n"])
eq("mean_error", sum(err) / 11, s["mean_error"], 1e-12)
eq("rmse", math.sqrt(sum(e * e for e in err) / 11), s["rmse"], 1e-12)
eq("share_inside_band", sum(1 for r in rows if abs(r["error"]) <= r["sigma0"]) / 11, s["share_inside_band"], 1e-12)
eq("mean_seller_pnl", sum(pnl) / 11, s["mean_seller_pnl"], 1e-6)
eq("sum_seller_pnl", sum(pnl), s["sum_seller_pnl"])
eq("min_seller_pnl", min(pnl), s["min_seller_pnl"])
eq("rw_mean_error", sum(rwerr) / 11, s["rw_mean_error"], 1e-12)
eq("rw_rmse", math.sqrt(sum(e * e for e in rwerr) / 11), s["rw_rmse"], 1e-12)
eq("rw_mean_seller_pnl", sum(rpnl) / 11, s["rw_mean_seller_pnl"], 1e-6)
eq("rw_sum_seller_pnl", sum(rpnl), s["rw_sum_seller_pnl"])
eq("rw_min_seller_pnl", min(rpnl), s["rw_min_seller_pnl"])
# builder's reported headline numbers
eq("reported mean error 0.086", 0.086, round(s["mean_error"], 3))
eq("reported RMSE 0.184", 0.184, round(s["rmse"], 3))
eq("reported inside band 73%", 73, round(100 * s["share_inside_band"]))
eq("reported mean seller P&L 128939", 128939, round(s["mean_seller_pnl"]))
eq("reported min seller P&L -102593", -102593, s["min_seller_pnl"])

# variant: realised score under each re-derived cap
for v in WF["cap_rederived_variant"]["rows"]:
    if v is None:
        continue
    eq(f"variant {v['origin']} realised", score(excess_a(v["origin"]), v["cap"]), v["realised_score"])
    eq(f"variant {v['origin']} pnl", v["quote"] - v["realised_score"], v["seller_pnl"])

# 7. notes
notes = " ".join(WF["notes"]).lower()
eq("note: look-ahead in cap", True, "look-ahead" in notes and "cap" in notes)
eq("note: fuel excluded with reason", True, "fuel is excluded" in notes and "1990-08" in notes)
eq("note: n = 11 cannot validate a 10 % tail", True, "n = 11 cannot validate a 10 % tail" in notes)

print(f"{checks} checks, {len(bad)} mismatches")
for m in bad:
    print("MISMATCH", m)
sys.exit(1 if bad else 0)
