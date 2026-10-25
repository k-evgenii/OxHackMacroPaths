"""Manifest data rules: gaps fail unless declared, windows never span a gap, proposals compute nothing."""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "forecast"))
import manifest as mf  # noqa: E402

committed = json.loads((ROOT / "forecast" / "manifest.json").read_text(encoding="utf-8"))


def monthly(start: str, end: str, empty: tuple[str, ...] = (), skip: tuple[str, ...] = ()) -> dict:
    rows, d, v = [], start + "-01", 2000
    while d[:7] <= end:
        if d[:7] not in skip:
            rows.append({"date": d, "value_str": "" if d[:7] in empty else f"{v / 10:.1f}"})
        d, v = mf.next_month(d), v + 3
    return {"rows": rows}


def raises(f, *a) -> str:
    try:
        f(*a)
    except ValueError as e:
        return str(e)
    raise AssertionError(f"{f.__name__} did not raise")


def test_undeclared_empty_fails():
    assert "2019-05" in raises(mf.cpi_row, monthly("2015-01", "2020-12", empty=("2019-05",)))


def test_skipped_month_fails():
    assert "not contiguous" in raises(mf.cpi_row, monthly("2015-01", "2020-12", skip=("2018-03",)))


def test_declared_month_has_no_yoy_and_breaks_windows():
    row = mf.cpi_row(monthly("2015-01", "2026-12", empty=("2025-10",)))
    months = [m for m, _ in row]
    assert "2025-10" not in months and "2026-10" not in months and "2025-09" in months
    # a 48-month window over the gap is caught, not counted as 48 months
    gap_row = [(m, x) for m, x in mf.cpi_row(monthly("1960-01", "1970-12")) if m != "1965-06"]
    assert "spans a gap" in raises(lambda r: list(mf.windows(r)), gap_row)


def test_caps_unchanged_by_the_rules():
    assert committed["chain"]["d_cap"] == 76973 and committed["chain"]["a_cap"] == 1883141


def test_data_rules_record_the_fallback():
    cpi = committed["data_rules"]["CPIAUCNS"]
    assert cpi["bls_series"] == "CUUR0000SA0"
    assert [m["month"] for m in cpi["known_missing"]] == ["2025-10"]
    assert cpi["fallback"][0]["month"] == "2025-10" and cpi["fallback"][0]["value"] == "325.604"
    assert "never the caps" in cpi["fallback_use"]
    assert committed["data_rules"]["GASREGW"]["first_value"] == "1990-08-20"


def test_proposals_compute_nothing():
    props = {p["key"]: p for p in committed["proposed_products"]}
    assert set(props) == {"diesel", "loan_rate"}
    assert props["diesel"]["series"] == "GASDESW" and props["loan_rate"]["series"] == "DFF"
    for p in props.values():
        assert p["executable"] is False and p["threshold"] is None and p["cap"] is None
    assert not {p["key"] for p in committed["products"]} & set(props)
    assert [p["key"] for p in committed["products"] if p["executable"]] == ["cooling", "excess"]


if __name__ == "__main__":
    for n, f in list(globals().items()):
        if n.startswith("test_"):
            f()
    print("ok")
