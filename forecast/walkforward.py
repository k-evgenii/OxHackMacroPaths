"""Walk-forward check of the Excess seller quote on CPI (descriptive, not a backtest).

Origins: 11 non-overlapping 48-month windows starting 1975-01 and stepping 48 months:
1975-01, 1979-01, ..., 2015-01 (last window ends 2018-12, before the training end 2020-12).
Checked against the data: the CPI YoY row starts 1948-01 and is complete to 2020-12, so
every origin has >= 15 years of fit data from 1960-01. The plan's earlier "1975 to 2017"
wording is corrected to "1975-01 .. 2015-01 (windows end 2018-12)".

Per origin: AR(1) fitted on the RAW snapshot row 1960-01 .. month before origin (expanding),
48 months simulated from the last observed value (seed 2026, 10000 paths, fresh stream per
origin), quote = clamp_quote(V0, sigma0). Realised score from the exact recursions at the
declared cap and k. Random-walk benchmark = flat path at the last observed value.
Seller P&L per unit = quote - realised score (millionths).

Cross-check: origin 2021-01 fitted on 1960-01..2020-12 must give the table quotes. The table
draws its shocks from ONE stream shared across products (cooling t=0..47 first, then excess), so
384852 is the COOLING quote (first draw, same as a fresh stream) and 57153 the EXCESS quote
(stream advanced past all of cooling's draws). Both are reproduced here.

Usage: pixi run walkforward
"""
from __future__ import annotations

import json
import math
import sys
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "forecast"))
sys.path.insert(0, str(ROOT / "tests"))
from ar1lib import clamp_quote, fit_ar1, forecast_from, random_walk_v  # noqa: E402
from manifest import WINDOW, cpi_row, load_snapshot, nearest_rank, QUANTILE  # noqa: E402
from make_vectors import K, SERIES_ID, run_recursions  # noqa: E402

OUT = ROOT / "forecast" / "walkforward.json"
MANIFEST = ROOT / "forecast" / "manifest.json"
TABLE = ROOT / "forecast" / "table.json"
TRAIN_START, TRAIN_END = "1960-01", "2020-12"
N_PATHS, SEED, ONE = 10_000, 2026, 1_000_000


def add_months(m: str, n: int) -> str:
    y, mo = int(m[:4]), int(m[5:7])
    t = y * 12 + mo - 1 + n
    return f"{t // 12:04d}-{t % 12 + 1:02d}"


def one_origin(row, origin: str, cap: int, rng=None) -> dict:
    prev = add_months(origin, -1)
    fit = fit_ar1(row, TRAIN_START, prev)
    x0 = dict(row)[prev]
    state = {"x": x0, "M": None, "D": 0, "A": 0}
    f = forecast_from(state, "excess", WINDOW, fit=fit, stat="excess", k=K, cap=cap, rng=rng, n_paths=N_PATHS, seed=SEED)
    quote = clamp_quote(f["V"], f["sigma"])
    win = [dict(row)[add_months(origin, i)] for i in range(WINDOW)]
    a = run_recursions(win, K)["A"]
    realised = (min(a, cap) * ONE) // cap
    rw = round(random_walk_v(state, WINDOW, stat="excess", k=K, cap=cap) * ONE)
    return {"origin": origin, "fit_window": [TRAIN_START, prev], "V0": f["V"], "sigma0": f["sigma"], "quote": quote,
            "realised_score": realised, "error": f["V"] - realised / ONE,
            "inside_band": abs(f["V"] - realised / ONE) <= f["sigma"],
            "seller_pnl": quote - realised, "rw_V0": rw, "rw_quote": clamp_quote(rw / ONE, 0.0),
            "rw_seller_pnl": clamp_quote(rw / ONE, 0.0) - realised}


def summarise(rows: list[dict]) -> dict:
    e = [r["error"] for r in rows]
    pnl = [r["seller_pnl"] for r in rows]
    rpnl = [r["rw_seller_pnl"] for r in rows]
    rw_err = [r["rw_V0"] / ONE - r["realised_score"] / ONE for r in rows]
    return {"n": len(rows), "mean_error": sum(e) / len(e), "rmse": math.sqrt(sum(x * x for x in e) / len(e)),
            "share_inside_band": sum(r["inside_band"] for r in rows) / len(rows),
            "mean_seller_pnl": sum(pnl) / len(pnl), "sum_seller_pnl": sum(pnl), "min_seller_pnl": min(pnl),
            "rw_mean_error": sum(rw_err) / len(rw_err), "rw_rmse": math.sqrt(sum(x * x for x in rw_err) / len(rw_err)),
            "rw_mean_seller_pnl": sum(rpnl) / len(rpnl), "rw_sum_seller_pnl": sum(rpnl), "rw_min_seller_pnl": min(rpnl),
            "label": "n = 11, cannot validate a 10 % tail; descriptive, not a backtest of a trading strategy"}


def main() -> int:
    row = cpi_row(load_snapshot(SERIES_ID))   # RAW snapshot row: the 2025-10 fill never enters
    cap = json.loads(MANIFEST.read_text(encoding="utf-8"))["products"][1]["cap"]
    assert cap == 1_883_141
    origins = [add_months("1975-01", 48 * i) for i in range(11)]
    assert origins[-1] == "2015-01" and add_months(origins[-1], 47) == "2018-12"
    rows = [one_origin(row, o, cap) for o in origins]

    # per-origin cap re-derived from windows ending before the origin (declared rule: nearest-rank p90)
    variant = []
    months = [m for m, _ in row]
    for r in rows:
        prev = add_months(r["origin"], -1)
        ws = [run_recursions([x for _, x in row[i:i + WINDOW]], K)["A"] for i in range(len(row) - WINDOW + 1)
              if TRAIN_START <= row[i][0] and row[i + WINDOW - 1][0] <= prev]
        if len(ws) < 12:
            variant.append(None)
            continue
        c = nearest_rank(ws, QUANTILE)
        v = one_origin(row, r["origin"], c)
        variant.append({"origin": r["origin"], "cap": c, "n_windows": len(ws), "V0": v["V0"], "sigma0": v["sigma0"],
                        "quote": v["quote"], "realised_score": v["realised_score"], "seller_pnl": v["seller_pnl"]})
    variant_summary = None
    if all(v is not None for v in variant):
        p = [v["seller_pnl"] for v in variant]
        variant_summary = {"mean_seller_pnl": sum(p) / len(p), "sum_seller_pnl": sum(p), "min_seller_pnl": min(p)}

    # cross-check against the live table (shared shock stream: cooling first, then excess)
    table = json.loads(TABLE.read_text(encoding="utf-8"))
    cool = json.loads(MANIFEST.read_text(encoding="utf-8"))["products"][0]
    fit = fit_ar1(row, TRAIN_START, TRAIN_END)
    x0 = dict(row)["2020-12"]
    st = {"x": x0, "M": None, "D": 0, "A": 0}
    rng = np.random.default_rng(SEED)
    fc = forecast_from(st, "cooling", WINDOW, fit=fit, stat="max_decline", k=None, cap=cool["cap"], rng=rng, n_paths=N_PATHS)
    for t in range(1, WINDOW):      # burn the rest of cooling's replay-month draws, as ar1.py does before excess
        rng.normal(0.0, fit.resid_sd, size=(N_PATHS, WINDOW - t))
    fe = forecast_from(st, "excess", WINDOW, fit=fit, stat="excess", k=K, cap=cap, rng=rng, n_paths=N_PATHS)
    got = [clamp_quote(fc["V"], fc["sigma"]), clamp_quote(fe["V"], fe["sigma"])]
    assert got == table["quotes"]["p"] == [384852, 57153], (got, table["quotes"]["p"])
    fresh = one_origin(row, "2021-01", cap)["quote"]

    out = {
        "product": "excess", "series": SERIES_ID, "seed": SEED, "n_paths": N_PATHS, "cap": cap, "k": K,
        "origins": origins, "rows": rows, "summary": summarise(rows),
        "cap_rederived_variant": {"rows": variant, "summary": variant_summary,
                                  "rule": "nearest-rank p90 of Excess over 48-month windows ending before the origin; null if fewer than 12 windows"},
        "cross_check": {"origin": "2021-01", "fit_window": [TRAIN_START, TRAIN_END], "table_quotes": table["quotes"]["p"],
                        "reproduced": got, "excess_fresh_stream_quote": fresh,
                        "note": "table shares one shock stream across products: 384852 is the cooling quote, 57153 the excess quote"},
        "notes": [
            "n = 11 cannot validate a 10 % tail; descriptive, not a backtest of a trading strategy. Windows are non-overlapping but the AR(1) fits share most of their data.",
            "Cap look-ahead: the declared cap 1883141 is the p90 over windows ending 2020-12, so it uses information after every origin. The cap_rederived_variant re-derives it from windows ending before each origin.",
            "Fuel is excluded: its series starts 1990-08, which leaves too few non-overlapping origins with an in-sample fit.",
            "Advisory; settlement uses the realised path only. Fit and score use the raw snapshot row, so the 2025-10 presentation fill never enters.",
        ],
    }
    OUT.write_text(json.dumps(out, indent=1) + chr(10), encoding="utf-8", newline=chr(10))
    s = out["summary"]
    print(f"{len(rows)} origins; mean err {s['mean_error']:.3f} rmse {s['rmse']:.3f} inside {s['share_inside_band']:.2f} "
          f"mean pnl {s['mean_seller_pnl']:.0f} min {s['min_seller_pnl']}")
    print("cross-check", got, "excess fresh-stream", fresh)
    return 0


if __name__ == "__main__":
    sys.exit(main())
