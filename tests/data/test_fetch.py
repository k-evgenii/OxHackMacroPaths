"""Offline checks for data/fetch.py's row validation (no network).

    pixi run pytest tests/data -q
"""

from __future__ import annotations

import importlib.util
import json
import tomllib
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
_spec = importlib.util.spec_from_file_location("fetch", ROOT / "data" / "fetch.py")
fetch = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(fetch)

CPI_SPEC = {s["id"]: s for s in tomllib.loads((ROOT / "data" / "series.toml").read_text())["series"]}["CPIAUCNS"]
SNAPSHOT = ROOT / "data" / "snapshots" / "CPIAUCNS.json"


def monthly(start: str, values: list[str]) -> list[dict]:
    rows, d = [], start
    for v in values:
        rows.append({"date": d, "value_str": v})
        d = fetch.next_month(d)
    return rows


def strict(**extra) -> dict:
    return {"frequency": "monthly", "strict": True, **extra}


def test_next_month_rolls_the_year():
    assert fetch.next_month("2025-12-01") == "2026-01-01"
    assert fetch.next_month("2025-09-01") == "2025-10-01"


def test_parse_fred_keeps_empty_values_as_empty_strings():
    raw = b"observation_date,CPIAUCNS\n2025-09-01,324.368\n2025-10-01,\n2025-11-01,324.122\n"
    rows = fetch.parse_fred("CPIAUCNS", raw)
    assert [r["value_str"] for r in rows] == ["324.368", "", "324.122"]


def test_complete_strict_series_passes():
    fetch.check_rows("X", monthly("2025-01-01", ["1.0", "2.0", "3.0"]), strict())


def test_undeclared_empty_value_fails_when_strict():
    rows = monthly("2025-09-01", ["1.0", "", "3.0"])
    with pytest.raises(ValueError, match="2025-10: empty value not declared"):
        fetch.check_rows("X", rows, strict())


def test_dot_counts_as_empty():
    rows = monthly("2025-09-01", ["1.0", ".", "3.0"])
    with pytest.raises(ValueError, match="2025-10"):
        fetch.check_rows("X", rows, strict())


def test_declared_empty_value_passes_and_is_printed(capsys):
    rows = monthly("2025-09-01", ["1.0", "", "3.0"])
    fetch.check_rows("X", rows, strict(known_missing=[{"month": "2025-10", "reason": "test"}]))
    assert "2025-10: empty, declared" in capsys.readouterr().out


def test_declared_month_that_has_a_value_fails():
    rows = monthly("2025-09-01", ["1.0", "2.0", "3.0"])
    with pytest.raises(ValueError, match="declared in known_missing but not empty"):
        fetch.check_rows("X", rows, strict(known_missing=[{"month": "2025-10", "reason": "test"}]))


def test_skipped_month_fails_when_strict():
    rows = [{"date": "2025-08-01", "value_str": "1.0"}, {"date": "2025-10-01", "value_str": "2.0"}]
    with pytest.raises(ValueError, match="months missing between 2025-08 and 2025-10"):
        fetch.check_rows("X", rows, strict())


def test_duplicate_or_unordered_dates_always_fail():
    rows = [{"date": "2025-08-01", "value_str": "1.0"}, {"date": "2025-08-01", "value_str": "1.0"}]
    with pytest.raises(ValueError, match="not strictly increasing"):
        fetch.check_rows("X", rows, {"frequency": "daily"})


def test_non_strict_series_warns_instead_of_failing(capsys):
    rows = monthly("2025-09-01", ["1.0", "", "3.0"])
    fetch.check_rows("X", rows, {"frequency": "monthly"})
    out = capsys.readouterr().out
    assert "WARNING" in out and "2025-10" in out


def test_window_with_a_declared_empty_month_still_fails():
    rows = monthly("2025-09-01", ["1.0", "", "3.0"])
    with pytest.raises(ValueError, match="month 2025-10 has no value"):
        fetch.check_window("X", rows, ["2025-09", "2025-11"])


def test_cpi_is_strict_and_declares_only_october_2025():
    assert CPI_SPEC["strict"] is True
    assert [d["month"] for d in CPI_SPEC["known_missing"]] == ["2025-10"]
    assert all(d["reason"].strip() for d in CPI_SPEC["known_missing"])


@pytest.mark.skipif(not SNAPSHOT.exists(), reason="data/snapshots/CPIAUCNS.json is gitignored; run `pixi run fetch` first")
def test_frozen_cpi_snapshot_passes_the_declared_rules():
    rows = json.loads(SNAPSHOT.read_text())["rows"]
    fetch.check_rows("CPIAUCNS", rows, CPI_SPEC)
    fetch.check_window("CPIAUCNS", rows, CPI_SPEC["window"])


def test_cpi_fallback_is_declared_with_a_source_and_never_applied_by_fetch():
    (fb,) = CPI_SPEC["fallback"]
    assert fb["month"] == "2025-10" and fb["value"] == "325.604"
    assert fb["source"].startswith("https://www.treasurydirect.gov/")
    assert "fallback" not in Path(ROOT / "data" / "fetch.py").read_text()


@pytest.mark.skipif(not SNAPSHOT.exists(), reason="data/snapshots/CPIAUCNS.json is gitignored; run `pixi run fetch` first")
def test_fallback_vector_matches_a_recomputation():
    spec = importlib.util.spec_from_file_location("fallback_vector", ROOT / "tests" / "fallback_vector.py")
    fv = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(fv)
    assert fv.OUT.read_text() == fv.dumps(fv.build())
    assert fv.build()["x"]["2025-10"]["x"] == 31489
