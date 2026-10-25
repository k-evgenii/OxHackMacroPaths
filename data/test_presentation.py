"""pixi run test-presentation: snapshots unchanged, exactly one filled CPI row, fuel thin flags."""
import hashlib
import json
import subprocess
import sys
import tomllib
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import presentation as P  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent


def test_snapshots_match_committed():
    out = subprocess.run(["git", "ls-files", "data/snapshots", "data/raw"], cwd=ROOT, capture_output=True, text=True, check=True)
    for f in out.stdout.split():
        committed = subprocess.run(["git", "show", f"HEAD:{f}"], cwd=ROOT, capture_output=True, check=True).stdout
        assert hashlib.sha256((ROOT / f).read_bytes()).hexdigest() == hashlib.sha256(committed).hexdigest(), f


def test_one_filled_row_from_series_toml():
    rows = P.cpi_presentation()
    filled = [r for r in rows if r["filled"]]
    assert len(filled) == 1 and filled[0]["date"] == "2025-10-01"
    spec = {s["id"]: s for s in tomllib.loads(P.CONFIG.read_text(encoding="utf-8"))["series"]}["CPIAUCNS"]
    assert filled[0]["value_str"] == spec["fallback"]["value"] == "325.604"
    assert all(r["value_str"] not in ("", ".") for r in rows)


def test_fuel_thin_months():
    thin = {r["month"]: r["readings"] for r in P.fuel_presentation() if r["thin"]}
    assert {"1990-12": 1, "1991-01": 2}.items() <= thin.items()  # 1990-08 is also thin (partial first month)


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_"):
            fn()
            print("ok", name)
