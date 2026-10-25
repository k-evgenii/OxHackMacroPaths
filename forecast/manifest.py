"""Demo manifest: caps by the declared rule, in integers, from the frozen snapshots.

Rule (declared, not fitted): for each product, take every 48-month window of the
product's integer row that starts on or after 1960-01 (or the row's first month)
and ends on or before 2020-12, compute the product's statistic, and set the cap
to the nearest-rank 90th percentile: sort ascending, take index ceil(0.9*n) - 1.

Usage:  pixi run manifest        (writes forecast/manifest.json, prints the caps)

Everything is integer arithmetic on the same transforms as tests/make_vectors.py,
which this script imports so the two can never disagree.
"""
from __future__ import annotations

import hashlib
import json
import math
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "tests"))
sys.path.insert(0, str(ROOT / "data"))
import presentation  # noqa: E402
from make_vectors import (K, N_OBS, ONE, FIRST_PERIOD_ID, SERIES_ID, SOURCE_URL, TRANSFORM_ID,  # noqa: E402
                          WINDOW_END, WINDOW_START, frac_digits, next_month, run_recursions, score,
                          to_scaled_int, yoy)

SNAP = ROOT / "data" / "snapshots"
OUT = ROOT / "forecast" / "manifest.json"

WINDOW = 48
TRAIN_START = "1960-01"      # inclusive, first month of a window
TRAIN_END = "2020-12"        # inclusive, last month of a window
QUANTILE = 0.9
FUEL_ID = "GASREGW"
FUEL_K = 35_000              # 3.50 usd/gal in 1e-4 usd
FUEL_SCALE = 10_000


def nearest_rank(values: list[int], q: float) -> int:
    s = sorted(values)
    return s[math.ceil(q * len(s)) - 1]


def load_snapshot(series_id: str) -> dict:
    return json.loads((SNAP / f"{series_id}.json").read_text(encoding="utf-8"))


def cpi_row(snap: dict) -> list[tuple[str, int]]:
    """(month 'YYYY-MM', x_t) for every month with a 12-month lag, integers only."""
    rows = [r for r in snap["rows"] if r["value_str"] not in ("", ".")]
    scale = max(frac_digits(r["value_str"]) for r in rows)
    lv = {r["date"][:7]: to_scaled_int(r["value_str"], scale) for r in rows}
    out = []
    for r in rows:
        m = r["date"][:7]
        y, mo = int(m[:4]), int(m[5:7])
        lag = f"{y - 1:04d}-{mo:02d}"
        if lag in lv:
            out.append((m, yoy(lv[m], lv[lag])))
    return out


def fuel_row(snap: dict) -> tuple[list[tuple[str, int]], dict[str, int]]:
    """Calendar-month arithmetic mean of the weekly rows, floor to 1e-4 usd. Returns counts too."""
    by_month: dict[str, list[int]] = {}
    for r in snap["rows"]:
        if r["value_str"] in ("", "."):
            continue
        by_month.setdefault(r["date"][:7], []).append(to_scaled_int(r["value_str"], 4))
    months = sorted(by_month)
    # require consecutive months
    for a, b in zip(months, months[1:]):
        assert next_month(a + "-01")[:7] == b, f"gap between {a} and {b}"
    row = [(m, sum(v) // len(v)) for m, v in ((m, by_month[m]) for m in months)]
    return row, {m: len(by_month[m]) for m in months}


def cpi_display_row() -> list[tuple[str, int]]:
    """CPI yoy row with the labelled 2025-10 fill. Display and AR(1) fit input only, never the caps."""
    return cpi_row({"rows": presentation.cpi_presentation()})


def fuel_display_row() -> list[tuple[str, int]]:
    """Fuel monthly row through the presentation layer (same values; thin months are flagged there)."""
    return [(r["month"], r["value"]) for r in presentation.fuel_presentation()]


def thin_fuel_windows() -> list[str]:
    thin = {r["month"] for r in presentation.fuel_presentation() if r["thin"]}
    row = fuel_display_row()
    return [start for i, (start, _) in enumerate(row[:len(row) - WINDOW + 1])
            if start >= TRAIN_START and row[i + WINDOW - 1][0] <= TRAIN_END
            and thin & {m for m, _ in row[i:i + WINDOW]}]


def windows(row: list[tuple[str, int]]):
    for i in range(len(row) - WINDOW + 1):
        start, end = row[i][0], row[i + WINDOW - 1][0]
        if start >= TRAIN_START and end <= TRAIN_END:
            yield start, [x for _, x in row[i:i + WINDOW]]


def excess(xs: list[int], k: int) -> int:
    return sum(max(x - k, 0) for x in xs)


def main() -> int:
    cpi = load_snapshot(SERIES_ID)
    fuel = load_snapshot(FUEL_ID)
    xr = cpi_row(cpi)
    fr, counts = fuel_row(fuel)

    cpi_w = list(windows(xr))
    d_vals = [run_recursions(xs)["D"] for _, xs in cpi_w]
    a_vals = [run_recursions(xs, K)["A"] for _, xs in cpi_w]
    fuel_w = list(windows(fr))
    f_vals = [excess(xs, FUEL_K) for _, xs in fuel_w]

    d_cap, a_cap, f_cap = nearest_rank(d_vals, QUANTILE), nearest_rank(a_vals, QUANTILE), nearest_rank(f_vals, QUANTILE)
    assert d_cap > 0 and a_cap > 0 and f_cap > 0

    # showcase 2021-01 .. 2024-12 on the same rows
    show_x = [x for m, x in xr if "2021-01" <= m <= "2024-12"]
    show_f = [x for m, x in fr if "2021-01" <= m <= "2024-12"]
    assert len(show_x) == N_OBS and len(show_f) == N_OBS
    r = run_recursions(show_x, K)
    assert r["D"] == 66191 and r["A"] == 691184, r
    fa = excess(show_f, FUEL_K)

    manifest = {
        "version": 1,
        "cap_rule": (f"nearest-rank p{int(QUANTILE * 100)} of the statistic over {WINDOW}-month windows "
                     f"starting >= {TRAIN_START} (or the row's first month) and ending <= {TRAIN_END}; "
                     f"index ceil(q*n)-1 of the ascending sort; integer by construction"),
        "quantile_method": "nearest-rank",
        "price_convention": "seller entry quote p = clamp(V0 + 0.5*sigma0, 0.05, 0.95) from forecast/table.json; "
                            "the matched pool's implicit 0.5 is not used for the demo",
        "products": [
            {"index": 0, "key": "cooling", "name": "Inflation Cooling", "stat": "max_decline",
             "row": "CPIAUCNS yoy, 1e-4 pp", "k": None, "cap": d_cap, "cap_units": "1e-4 pp",
             "windows": len(d_vals), "first_window": cpi_w[0][0], "last_window": cpi_w[-1][0], "executable": True},
            {"index": 1, "key": "excess", "name": "Excess Inflation", "stat": "accumulated_excess",
             "row": "CPIAUCNS yoy, 1e-4 pp", "k": K, "cap": a_cap, "cap_units": "1e-4 pp-months",
             "windows": len(a_vals), "first_window": cpi_w[0][0], "last_window": cpi_w[-1][0], "executable": True},
            {"index": None, "key": "fuel", "name": "Fuel Pass-through", "stat": "accumulated_excess",
             "row": "GASREGW calendar-month mean, 1e-4 usd/gal", "k": FUEL_K, "cap": f_cap,
             "cap_units": "1e-4 usd-months", "windows": len(f_vals), "first_window": fuel_w[0][0],
             "last_window": fuel_w[-1][0], "executable": False,
             "aggregation": "arithmetic mean of the weekly rows dated inside the calendar month, floored to 1e-4 usd",
             "note": "research product; not settled on chain this weekend"},
        ],
        "chain": {"series_id": SERIES_ID, "source_url": SOURCE_URL, "transform_id": TRANSFORM_ID,
                  "window_start": WINDOW_START, "window_end": WINDOW_END, "n": N_OBS,
                  "first_period_id": FIRST_PERIOD_ID, "k": K, "d_cap": d_cap, "a_cap": a_cap},
        "showcase": {
            "window": ["2021-01", "2024-12"],
            "cooling": {"stat": r["D"], "score": score(r["D"], d_cap)},
            "excess": {"stat": r["A"], "score": score(r["A"], a_cap)},
            "fuel": {"stat": fa, "score": score(fa, f_cap), "months_above_k": sum(1 for x in show_f if x > FUEL_K)},
        },
        "snapshots": {
            SERIES_ID: {"retrieved_at": cpi["retrieved_at"], "sha256_of_raw": cpi["sha256_of_raw"]},
            FUEL_ID: {"retrieved_at": fuel["retrieved_at"], "sha256_of_raw": fuel["sha256_of_raw"],
                      "weekly_rows_per_month_min": min(counts.values()), "max": max(counts.values())},
        },
        "one": ONE,
        "notes": {
            "thin_fuel_windows": thin_fuel_windows(),
            "thin_fuel_months": [r["month"] for r in presentation.fuel_presentation() if r["thin"]],
            "cpi_filled_months": [r["date"][:7] for r in presentation.cpi_presentation() if r["filled"]],
            "scope": "illustrative historical data; the gap fill is presentation-only and the caps read the raw snapshot",
        },
    }
    OUT.write_text(json.dumps(manifest, indent=1) + "\n", encoding="utf-8", newline="\n")
    print(f"d_cap={d_cap} ({d_cap/1e4:.4f} pp)  a_cap={a_cap} ({a_cap/1e4:.4f} pp-months)  "
          f"fuel_cap={f_cap} ({f_cap/1e4:.4f} usd-months)")
    print("showcase scores:", {k: v["score"] for k, v in manifest["showcase"].items() if isinstance(v, dict)})
    print("wrote", OUT.relative_to(ROOT))
    return 0


if __name__ == "__main__":
    sys.exit(main())
