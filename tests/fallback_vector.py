"""October 2025 CPI fallback: one test vector for a future (v2) dataset rule.

    pixi run python tests/fallback_vector.py            # writes tests/fallback-vector.json
    pixi run python tests/fallback_vector.py --check    # recompute and compare

BLS published no CPI for October 2025. The U.S. Treasury's TIPS contingency index for
that month is 325.604 (declared with its source in data/series.toml `fallback`). This
script does not change v1: no v1 window touches 2025-10, and fetch.py keeps FRED's empty
value. It records what the declared rule would give:

- the contingency value reproduced from the rule (CPI_Sep25 * (CPI_Sep25 / CPI_Sep24)^(1/12),
  rounded to 3 decimals, computed with Decimal at 50 digits) -- a provenance check only;
- x for 2025-10 with the fallback level, using make_vectors' exact integer `yoy`;
- that 2025-11 does not depend on it, and that 2026-10 would (its base month is 2025-10).
"""

from __future__ import annotations

import json
import sys
import tomllib
from decimal import ROUND_HALF_UP, Decimal, getcontext
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import make_vectors as mv  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
SNAPSHOT = ROOT / "data" / "snapshots" / "CPIAUCNS.json"
OUT = ROOT / "tests" / "fallback-vector.json"


def declared_fallback() -> dict:
    spec = {s["id"]: s for s in tomllib.loads((ROOT / "data" / "series.toml").read_text())["series"]}["CPIAUCNS"]
    (fb,) = [f for f in spec["fallback"] if f["month"] == "2025-10"]
    return fb


def x_of(level: str, base: str) -> int:
    scale = max(mv.frac_digits(level), mv.frac_digits(base))
    return mv.yoy(mv.to_scaled_int(level, scale), mv.to_scaled_int(base, scale))


def build(snapshot: Path = SNAPSHOT) -> dict:
    snap = json.loads(snapshot.read_text())
    lv = {r["date"][:7]: r["value_str"] for r in snap["rows"]}
    if lv.get("2025-10") not in ("", "."):
        raise SystemExit(f"2025-10 is no longer empty in the snapshot ({lv.get('2025-10')!r}); review the rule")
    fb = declared_fallback()
    getcontext().prec = 50
    sep25, sep24 = Decimal(lv["2025-09"]), Decimal(lv["2024-09"])
    rule = (sep25 * (sep25 / sep24) ** (Decimal(1) / Decimal(12))).quantize(Decimal("0.001"), ROUND_HALF_UP)
    if str(rule) != fb["value"]:
        raise SystemExit(f"rule gives {rule}, series.toml declares {fb['value']}")
    return {
        "note": "Declared fallback for a future dataset rule; v1 sessions and tests/vectors.json do not use it.",
        "snapshot": {"sha256_of_raw": snap["sha256_of_raw"]},  # content only: retrieved_at differs per machine
        "fallback": fb,
        "rule_check": {"formula": "CPI_2025-09 * (CPI_2025-09 / CPI_2024-09)^(1/12), rounded to 0.001",
                       "inputs": {"2025-09": lv["2025-09"], "2024-09": lv["2024-09"]}, "value": str(rule)},
        "x": {
            "2025-10": {"level": fb["value"], "base_2024-10": lv["2024-10"], "x": x_of(fb["value"], lv["2024-10"]),
                        "uses_fallback": True},
            "2025-11": {"level": lv["2025-11"], "base_2024-11": lv["2024-11"], "x": x_of(lv["2025-11"], lv["2024-11"]),
                        "uses_fallback": False},
            "2026-10": {"note": "would use the fallback as its base month; BLS will not publish a 12-month change for October 2026"},
        },
    }


def dumps(o: dict) -> str:
    return json.dumps(o, indent=2) + "\n"


def main() -> int:
    out = dumps(build())
    if "--check" in sys.argv:
        ok = OUT.exists() and OUT.read_text() == out
        print("fallback-vector.json " + ("matches" if ok else "DIFFERS"))
        return 0 if ok else 1
    OUT.write_text(out, newline="\n")
    print(f"wrote {OUT.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
