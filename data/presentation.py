"""Presentation-layer series: labelled gap fill for display and the AR(1) fit input.

The frozen snapshots in data/snapshots/ are never edited. The caps and the on-chain chain
read the raw snapshot only (forecast/manifest.py main). The historical data is illustrative.
"""
from __future__ import annotations

import json
import tomllib
from pathlib import Path

DATA = Path(__file__).resolve().parent
SNAP = DATA / "snapshots"
CONFIG = DATA / "series.toml"

CPI_ID = "CPIAUCNS"
FUEL_ID = "GASREGW"
THIN_READINGS = 3
CPI_SOURCE = "FRED CPIAUCNS; 2025-10 filled with the Treasury contingency value 325.604; illustrative historical data"
FUEL_SOURCE = ("FRED GASREGW; calendar-month mean of the weekly readings that exist (1990-12 and 1991-01 are thin); "
               "illustrative historical data")


def _snapshot(series_id: str) -> dict:
    return json.loads((SNAP / f"{series_id}.json").read_text(encoding="utf-8"))


def cpi_fallback() -> dict:
    specs = {s["id"]: s for s in tomllib.loads(CONFIG.read_text(encoding="utf-8"))["series"]}
    fb = specs[CPI_ID]["fallback"]
    return fb[0] if isinstance(fb, list) else fb


def cpi_presentation() -> list[dict]:
    """CPIAUCNS rows [{date, value_str, filled}]; the declared fallback month is filled, any other gap raises."""
    fb = cpi_fallback()
    out = []
    for r in _snapshot(CPI_ID)["rows"]:
        month, v = r["date"][:7], r["value_str"]
        if v in ("", "."):
            if month != fb["month"]:
                raise ValueError(f"{CPI_ID}: month {month} is empty and is not the declared fallback {fb['month']}")
            out.append({"date": r["date"], "value_str": fb["value"], "filled": True})
        else:
            out.append({"date": r["date"], "value_str": v, "filled": False})
    if sum(r["filled"] for r in out) != 1:
        raise ValueError(f"{CPI_ID}: declared fallback month {fb['month']} was not empty in the snapshot")
    return out


def fuel_presentation() -> list[dict]:
    """GASREGW calendar-month rows [{month, value (1e-4 usd, floored mean), readings, thin}]."""
    by_month: dict[str, list[int]] = {}
    for r in _snapshot(FUEL_ID)["rows"]:
        if r["value_str"] in ("", "."):
            continue
        whole, _, frac = r["value_str"].partition(".")
        by_month.setdefault(r["date"][:7], []).append(int(whole) * 10_000 + int((frac + "0000")[:4]))
    return [{"month": m, "value": sum(v) // len(v), "readings": len(v), "thin": len(v) < THIN_READINGS}
            for m, v in sorted(by_month.items())]


def main() -> int:
    out = {
        "note": "Presentation layer only. Raw snapshots and the caps are untouched. Illustrative historical data.",
        "cpi": {"series": CPI_ID, "source": CPI_SOURCE, "rows": cpi_presentation()},
        "fuel": {"series": FUEL_ID, "source": FUEL_SOURCE, "unit": "1e-4 usd/gal", "rows": fuel_presentation()},
    }
    path = DATA.parent / "forecast" / "presentation.json"
    path.write_text(json.dumps(out, indent=1) + "\n", encoding="utf-8", newline="\n")
    print("wrote", path.relative_to(DATA.parent))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
