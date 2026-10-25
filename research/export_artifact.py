"""Export forecast/planner.json: everything the web planner needs, no Python at runtime.

Scenarios are the 48-month windows common to both rows (fuel starts 1990-08), ending by
2020-12. Scores use the manifest caps; prices come from forecast/table.json row 0.

Usage:  pixi run planner-artifact
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "forecast"))
sys.path.insert(0, str(ROOT / "tests"))
sys.path.insert(0, str(ROOT / "research"))
from ar1lib import QUOTE_FORMULA  # noqa: E402
from manifest import FUEL_K, FUEL_SCALE, TRAIN_END, WINDOW, cpi_display_row, excess, fuel_display_row  # noqa: E402
from make_vectors import K, run_recursions, score  # noqa: E402
from planner import Policy, Scenario, recommend, showcase  # noqa: E402

MANIFEST = ROOT / "forecast" / "manifest.json"
TABLE = ROOT / "forecast" / "table.json"
OUT = ROOT / "forecast" / "planner.json"
DEFAULTS = {"q": 100.0, "G": 3.50, "B": 200.0}
ONE = 1_000_000


def build_scenarios(cpi, fuel, caps: dict[str, int]) -> list[Scenario]:
    cx = dict(cpi)
    fx = dict(fuel)
    months = [m for m, _ in fuel if m in cx]
    out = []
    for i in range(len(months) - WINDOW + 1):
        win = months[i:i + WINDOW]
        if win[-1] > TRAIN_END:
            break
        xs = [cx[m] for m in win]
        fs = [fx[m] for m in win]
        a = run_recursions(xs, K)["A"]
        fa = excess(fs, FUEL_K)
        out.append(Scenario(start=win[0],
                            excess_score=score(a, caps["excess"]) / ONE,
                            fuel_score=score(fa, caps["fuel"]) / ONE,
                            fuel_overrun_per_gallon=fa / FUEL_SCALE))
    return out


def main() -> int:
    man = json.loads(MANIFEST.read_text(encoding="utf-8"))
    table = json.loads(TABLE.read_text(encoding="utf-8"))
    caps = {p["key"]: p["cap"] for p in man["products"]}
    cpi = cpi_display_row()
    fuel = fuel_display_row()
    scen = build_scenarios(cpi, fuel, caps)
    prices = {"excess": table["quotes"]["p"][1] / ONE, "fuel": table["quotes"]["fuel_research_quote"] / ONE}

    # showcase 2021-24
    cx, fx = dict(cpi), dict(fuel)
    win = [m for m, _ in fuel if "2021-01" <= m <= "2024-12"]
    a = run_recursions([cx[m] for m in win], K)["A"]
    fa = excess([fx[m] for m in win], FUEL_K)
    show = Scenario("2021-01", score(a, caps["excess"]) / ONE, score(fa, caps["fuel"]) / ONE, fa / FUEL_SCALE)

    r0 = table["rows"][0]
    expected = {k: {"expected_score": r0[k]["V"], "sigma": r0[k]["sigma"], "rw_benchmark_score": r0[k]["V_rw"],
                    "historical_mean_score": sum(getattr(s, f"{k}_score") for s in scen) / len(scen),
                    "note": "expected_score is the AR(1) forecast at session start; historical_mean_score is the empirical mean over the scenario windows"}
                for k in ("excess", "fuel")}
    best, ranked = recommend(scen, DEFAULTS["q"], DEFAULTS["B"], prices)
    table_rows = [{"product": r.policy.product, "stake": r.policy.stake, "units": r.units,
                   "tail_loss_95": r.tail_loss_95, "mean_shortfall": r.mean_shortfall,
                   "max_shortfall": r.max_shortfall, "cap_binding_freq": r.cap_binding_freq,
                   "expected_end_cash": r.expected_end_cash} for r in ranked]
    art = {
        "version": 1,
        "manifest_version": man["version"],
        "labels": {"excess": "executable on chain (Excess Inflation, product 1)",
                   "fuel": "research product, not executable this weekend",
                   "cash": "keep the budget as a cash reserve"},
        "prices": {"excess": prices["excess"], "fuel": prices["fuel"],
                   "source": f"forecast/table.json quotes: {QUOTE_FORMULA}",
                   "note": "the matched pool's implicit 0.5 is not used"},
        "caps": caps, "thresholds": {"excess_k_1e4pp": K, "fuel_k_1e4usd": FUEL_K},
        "objective": "TailLoss95 = mean of the largest ceil(0.05*N) shortfalls U_k = max(L_k - (B - c) - H_k, 0); "
                     "ties -> lower stake, then cash, excess, fuel",
        "scenario_note": f"{len(scen)} overlapping 48-month windows {scen[0].start}..{scen[-1].start} (ending <= {TRAIN_END}); "
                         "an empirical decision score, not independent episodes or a calibrated probability",
        "products": expected,
        "defaults": DEFAULTS,
        "scenarios": [{"start": s.start, "excess_score": s.excess_score, "fuel_score": s.fuel_score,
                       "fuel_overrun_per_gallon": s.fuel_overrun_per_gallon} for s in scen],
        "showcase": {"start": "2021-01", "excess_score": show.excess_score, "fuel_score": show.fuel_score,
                     "fuel_overrun_per_gallon": show.fuel_overrun_per_gallon,
                     "excess_stat_1e4ppmonths": a, "fuel_stat_1e4usdmonths": fa,
                     "under_recommended": showcase(best.policy, show, DEFAULTS["q"], DEFAULTS["B"], prices)},
        "default_recommendation": table_rows[0],
        "default_table": table_rows,
    }
    OUT.write_text(json.dumps(art, indent=1) + "\n", encoding="utf-8", newline="\n")
    print(f"scenarios {len(scen)} ({scen[0].start}..{scen[-1].start}); prices {prices}")
    print("recommended:", table_rows[0])
    print("showcase under it:", art["showcase"]["under_recommended"])
    print("wrote", OUT.relative_to(ROOT), OUT.stat().st_size, "bytes")
    return 0


if __name__ == "__main__":
    sys.exit(main())
