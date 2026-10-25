"""Advisory forecast table: V_t, sigma_t, se_t for every month of the replay, per product.

At month t the forecast conditions on the realised integer path x_0..x_{t-1} (so on the
running peak, max decline and accumulator the chain actually holds) and simulates the
remaining 48-t months 10,000 times from the AR(1) fitted to the declared training window.
Row 0 is the pre-replay forecast and feeds the seller's entry quote
p = clamp(V_0 + 0.5*sigma_0, 0.05, 0.95). Nothing here is executed against on-chain.

Usage:  pixi run forecast        (needs forecast/manifest.json from `pixi run manifest`)
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "forecast"))
sys.path.insert(0, str(ROOT / "tests"))
from ar1lib import QUOTE_FORMULA, QUOTE_KAPPA, RW_LABEL, clamp_quote, fit_ar1, forecast_from, random_walk_v  # noqa: E402
from manifest import FUEL_ID, FUEL_K, TRAIN_END, TRAIN_START, cpi_display_row, fuel_display_row  # noqa: E402
from make_vectors import K, N_OBS, SERIES_ID, run_recursions  # noqa: E402

MANIFEST = ROOT / "forecast" / "manifest.json"
OUT = ROOT / "forecast" / "table.json"
COND = ROOT / "forecast" / "conditional.json"
N_PATHS = 10_000
SEED = 2026
KAPPA = QUOTE_KAPPA


def forecast_product(name: str, row: list[tuple[str, int]], fit, stat: str, k: int | None, cap: int,
                     rng: np.random.Generator) -> list[dict]:
    show = [x for m, x in row if "2021-01" <= m <= "2024-12"]
    assert len(show) == N_OBS
    x_prev = [x for m, x in row if m == "2020-12"][0]
    out = []
    for t in range(N_OBS + 1):
        st = run_recursions(show[:t], k if k is not None else K) if t else {"M": None, "D": 0, "A": 0}
        x0 = show[t - 1] if t else x_prev
        state = {"x": x0, "M": st["M"], "D": st["D"], "A": st["A"]}
        f = forecast_from(state, name, N_OBS - t, fit=fit, stat=stat, k=k, cap=cap, rng=rng, n_paths=N_PATHS)
        v, s = f["V"], f["sigma"]
        rw = random_walk_v(state, N_OBS - t, stat=stat, k=k, cap=cap)
        out.append({"t": t, "V": v, "V_rw": rw, "sigma": s, "se": f["se"], "p_cap": f["p_cap"],
                    "accrued_floor": min((st["D"] if stat == "max_decline" else st["A"]) / cap, 1.0) if t else 0.0})
    return out


def main() -> int:
    man = json.loads(MANIFEST.read_text(encoding="utf-8"))
    prods = {p["key"]: p for p in man["products"]}
    cpi = cpi_display_row()
    fuel = fuel_display_row()
    rows = {"cooling": cpi, "excess": cpi, "fuel": fuel}
    fits = {"cpi": fit_ar1(cpi, TRAIN_START, TRAIN_END), "fuel": fit_ar1(fuel, TRAIN_START, TRAIN_END)}
    rng = np.random.default_rng(SEED)
    per = {}
    for key, p in prods.items():
        fit = fits["fuel" if key == "fuel" else "cpi"]
        per[key] = forecast_product(key, rows[key], fit, p["stat"], p["k"], p["cap"], rng)

    periods = [m for m, _ in cpi if "2021-01" <= m <= "2024-12"]
    table_rows = []
    for t in range(N_OBS + 1):
        pid = int(periods[t].replace("-", "")) if t < N_OBS else None
        table_rows.append({"t": t, "period_id": pid, **{k: per[k][t] for k in per}})
    quotes = [clamp_quote(per[k][0]["V"], per[k][0]["sigma"], KAPPA) for k in ("cooling", "excess")]
    table = {
        "manifest_version": man["version"],
        "model": f"AR(1) on the integer row, closed-form OLS on {TRAIN_START}..{TRAIN_END}; simulated paths rounded to integers; exact recursions",
        "n_paths": N_PATHS, "seed": SEED,
        "fit": {"cpi": fits["cpi"].as_dict(), "fuel": fits["fuel"].as_dict()},
        "caps": {k: prods[k]["cap"] for k in prods},
        "quotes": {"p": quotes, "kappa": KAPPA, "products": ["cooling", "excess"],
                   "formula": QUOTE_FORMULA,
                   "fuel_research_quote": clamp_quote(per["fuel"][0]["V"], per["fuel"][0]["sigma"], KAPPA)},
        "benchmark": {"V_rw": RW_LABEL},
        "label": "Forecast (AR(1) baseline, advisory). Settlement uses the realised path only.",
        "rows": table_rows,
    }
    cond = {"manifest_version": man["version"], "product": "excess",
            "note": "V and sigma of the Excess product conditional on the realised path up to month t (t=0 session start, t=48 realised). "
                    "Advisory; settlement uses the realised path only.",
            "rows": [{"t": r["t"], "period_id": table_rows[r["t"]]["period_id"], "V": r["V"], "sigma": r["sigma"]}
                     for r in per["excess"][:N_OBS]]}
    COND.write_text(json.dumps(cond, indent=1) + "\n", encoding="utf-8", newline="\n")
    OUT.write_text(json.dumps(table, indent=1) + "\n", encoding="utf-8", newline="\n")
    for k in per:
        r0, r48 = per[k][0], per[k][48]
        print(f"{k:8s} V0={r0['V']:.3f} sigma0={r0['sigma']:.3f} P(cap)={r0['p_cap']:.3f}  realised={r48['V']:.3f}")
    print("quotes (millionths):", quotes, "fuel research:", table["quotes"]["fuel_research_quote"])
    print("fit cpi:", {k: round(v, 4) for k, v in fits["cpi"].as_dict().items() if isinstance(v, float)})
    print("wrote", OUT.relative_to(ROOT))
    return 0


if __name__ == "__main__":
    sys.exit(main())
