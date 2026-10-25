"""Twin-windows fixture: recomputation, rank, wording and doc checks.

Run with:  pixi run pytest tests/test_twin_windows.py -q

Tests that need data/snapshots/CPIAUCNS.json (gitignored) skip with a reason when it is absent. When
it is present, any inconsistency with the committed tests/twin-windows.json fails. Tests that only
read committed files (the fixture, tests/vectors.json, docs/twin-windows.md) always run.

No reference number is typed here: values come from tests/vectors.json, from the fixture, or from an
independent brute-force recomputation of the snapshot (a second implementation of the ranking).
"""

from __future__ import annotations

import json
import re
import shutil
import sys
from fractions import Fraction
from pathlib import Path

import pytest

import make_vectors as mv
import twin_check as tc

SNAP = tc.DEFAULT_SNAPSHOT
FIXTURE = tc.OUT
DOC = tc.DOC
N = mv.N_OBS
FORBIDDEN = re.compile(r"\b(" + "|".join(["fair value", "bet", "bets", "option", "options", "insurance"]) + r")\b",
                       re.IGNORECASE)


@pytest.fixture(scope="module")
def committed() -> dict:
    assert FIXTURE.exists(), "tests/twin-windows.json is not committed; run `pixi run python tests/twin_check.py`"
    return json.loads(FIXTURE.read_text(encoding="utf-8"))


@pytest.fixture(scope="module")
def vectors() -> dict:
    return json.loads(tc.VECTORS.read_text(encoding="utf-8"))


@pytest.fixture(scope="module")
def snapshot() -> Path:
    if not SNAP.exists():
        pytest.skip("data/snapshots/CPIAUCNS.json is gitignored and absent; "
                    "run `pixi run fetch` (or copy the frozen snapshot) to run the recomputation checks")
    return SNAP


@pytest.fixture(scope="module")
def rebuilt(snapshot, committed) -> dict:
    return tc.reconcile(tc.build(snapshot), committed)


def window(fx: dict, role: str) -> dict:
    (w,) = [w for w in fx["windows"] if w["role"] == role]
    return w


# ---------- committed files only ----------

def test_fixture_is_canonical_json(committed):
    text = FIXTURE.read_bytes().decode("utf-8")
    assert "\r" not in text and text.endswith("}\n") and not text.endswith("\n\n")
    assert text == json.dumps(committed, indent=2, ensure_ascii=True) + "\n"


def test_reference_window_reproduces_vectors_json(committed, vectors):
    ref = window(committed, "reference")
    assert len(ref["series"]) == N
    for row, run, mine in zip(vectors["rows"], vectors["running"], ref["series"]):
        assert (row["date"][:7], row["x"]) == (mine["date"], mine["x"])
        assert (run["M"], run["D"], run["A"]) == (mine["M"], mine["D"], mine["A"])
    f = vectors["final"]
    assert (f["M"], f["D"], f["A"], f["s1"], f["s2"]) == (
        ref["M"], ref["D"], ref["A"], ref["score_cooling"], ref["score_excess"])
    assert (ref["start"], ref["end"]) == (vectors["rows"][0]["date"][:7], vectors["rows"][-1]["date"][:7])
    assert committed["parameters"]["K"] == vectors["parameters"]["K"] == mv.K
    assert committed["parameters"]["Dcap"] == vectors["parameters"]["Dcap"] == mv.DCAP
    assert committed["parameters"]["Acap"] == vectors["parameters"]["Acap"] == mv.ACAP
    assert committed["provenance"]["vectors"]["dataset_id"] == vectors["commitment"]["dataset_id"]


def test_window_statistics_follow_from_their_series(committed):
    for w in committed["windows"]:
        xs = [row["x"] for row in w["series"]]
        r = mv.run_recursions(xs)
        assert [(row["M"], row["D"], row["A"]) for row in w["series"]] == [
            (st["M"], st["D"], st["A"]) for st in r["steps"]]
        assert (w["M"], w["D"], w["A"]) == (r["M"], r["D"], r["A"])
        assert w["score_cooling"] == mv.score(r["D"], mv.DCAP)
        assert w["score_excess"] == mv.score(r["A"], mv.ACAP)
        assert w["endpoints"]["start"]["x"] == xs[0] and w["endpoints"]["end"]["x"] == xs[-1]


def test_wording_flags_follow_from_fixture_values(committed):
    """The 0.15 pp truth values re-derived from the fixture's own x and exact fractions."""
    ref, twin = window(committed, "reference"), window(committed, "comparison")
    w = committed["wording"]
    contract = max(abs(twin["endpoints"][e]["x"] - ref["endpoints"][e]["x"]) for e in ("start", "end"))
    exact = max(abs(Fraction(twin["endpoints"][e]["yoy_pp_exact"]) - Fraction(ref["endpoints"][e]["yoy_pp_exact"]))
                for e in ("start", "end"))
    limit = Fraction(15, 100)
    assert w["within_0_15_pp_inclusive"] == {
        "contract_floored": Fraction(contract, tc.X_PER_PP) <= limit, "exact_unrounded": exact <= limit}
    assert w["within_0_15_pp_strict"] == {
        "contract_floored": Fraction(contract, tc.X_PER_PP) < limit, "exact_unrounded": exact < limit}
    assert w["max_endpoint_gap_pp_4dp"]["contract_floored"] == tc.fmt_x(contract)
    assert w["max_endpoint_gap_pp_4dp"]["exact_unrounded"] == tc.fmt_fraction(exact, 4)
    assert Fraction(w["max_endpoint_gap_pp_exact"]) == exact
    assert w["smallest_two_decimal_bound_pp"] == tc.ceil_2dp(max(Fraction(contract, tc.X_PER_PP), exact))


def test_doc_claims_match_fixture(committed):
    """docs/twin-windows.md has a 'Checked claims' table; every row must match the fixture."""
    assert DOC.exists(), "docs/twin-windows.md is missing"
    rows = dict(re.findall(r"^\|\s*`([A-Za-z0-9_]+)`\s*\|\s*(.+?)\s*\|\s*$", DOC.read_text(encoding="utf-8"), re.M))
    ref, twin, close = (window(committed, r) for r in ("reference", "comparison", "closest_match"))
    rk, w = twin["ranks"], committed["wording"]
    expect = {
        "comparison_window": f"{twin['start']}..{twin['end']}",
        "reference_window": f"{ref['start']}..{ref['end']}",
        "within_0_15_pp_contract_floored": str(w["within_0_15_pp_inclusive"]["contract_floored"]).lower(),
        "within_0_15_pp_exact_unrounded": str(w["within_0_15_pp_inclusive"]["exact_unrounded"]).lower(),
        "start_gap_pp_contract_floored": w["start_gap_pp_4dp"]["contract_floored"],
        "end_gap_pp_contract_floored": w["end_gap_pp_4dp"]["contract_floored"],
        "max_endpoint_gap_pp_contract_floored": w["max_endpoint_gap_pp_4dp"]["contract_floored"],
        "max_endpoint_gap_pp_exact_unrounded": w["max_endpoint_gap_pp_4dp"]["exact_unrounded"],
        "candidates": str(committed["candidates"]["candidates"]),
        "chebyshev_distance_x": str(twin["distance_to_reference"]["chebyshev"]),
        "rank_chebyshev_ordinal": str(rk["chebyshev"]["ordinal"]),
        "rank_chebyshev_competition": str(rk["chebyshev"]["competition"]),
        "rank_l1_ordinal": str(rk["l1"]["ordinal"]),
        "rank_l2_ordinal": str(rk["l2_squared"]["ordinal"]),
        "rank_chebyshev_deduplicated": str(rk["chebyshev"]["dedup"]),
        "rank_if_overlapping_windows_were_candidates": str(rk["chebyshev"]["ordinal_if_overlapping_windows_were_candidates"]),
        "closest_start": close["start"],
        "closest_chebyshev_distance_x": str(close["distance_to_reference"]["chebyshev"]),
        "closest_tied_with": ", ".join(close["ranks"]["chebyshev"]["tied_with"]),
        "reference_cooling_D_and_score": f"{ref['D']} / {ref['score_cooling']}",
        "reference_excess_A_and_score": f"{ref['A']} / {ref['score_excess']}",
        "comparison_cooling_D_and_score": f"{twin['D']} / {twin['score_cooling']}",
        "comparison_excess_A_and_score": f"{twin['A']} / {twin['score_excess']}",
        "closest_cooling_D_and_score": f"{close['D']} / {close['score_cooling']}",
        "closest_excess_A_and_score": f"{close['A']} / {close['score_excess']}",
    }
    assert rows == expect


def test_no_banned_vocabulary():
    for path in (DOC, tc.HERE / "twin_check.py", FIXTURE):
        hits = FORBIDDEN.findall(path.read_text(encoding="utf-8"))
        assert not hits, f"{path.name} uses banned wording: {hits}"


# ---------- recomputation from the snapshot ----------

def test_committed_fixture_matches_recomputation(rebuilt):
    assert tc.render(rebuilt) == FIXTURE.read_text(encoding="utf-8")


def test_reference_recomputes_to_vectors_json(rebuilt, vectors):
    ref = window(rebuilt, "reference")
    f = vectors["final"]
    assert (ref["D"], ref["A"], ref["score_cooling"], ref["score_excess"]) == (f["D"], f["A"], f["s1"], f["s2"])
    assert [r["x"] for r in ref["series"]] == [r["x"] for r in vectors["rows"]]


def brute_force(snapshot: Path, twin_month: str) -> dict:
    """A second, deliberately plain implementation of the declared ranking rules."""
    rows = json.loads(snapshot.read_text(encoding="utf-8"))["rows"]
    ordinal = lambda m: int(m[:4]) * 12 + int(m[5:7]) - 1  # noqa: E731
    level = {ordinal(r["date"][:7]): r["value_str"] for r in rows if r["value_str"] not in ("", ".")}
    scale = max(mv.frac_digits(v) for v in level.values())
    p = {k: mv.to_scaled_int(v, scale) for k, v in level.items()}
    x = {k: mv.yoy(p[k], p[k - 12]) for k in p if k - 12 in p}
    ref = ordinal("2021-01")
    cands = {}
    for s in sorted(x):
        if s + N - 1 not in x or any(s + t not in x for t in range(N)) or abs(s - ref) < N:
            continue
        a, b = abs(x[s] - x[ref]), abs(x[s + N - 1] - x[ref + N - 1])
        cands[s] = {"chebyshev": max(a, b), "l1": a + b, "l2_squared": a * a + b * b}
    twin = ordinal(twin_month)
    out = {"n": len(cands)}
    for metric in ("chebyshev", "l1", "l2_squared"):
        d = {s: c[metric] for s, c in cands.items()}
        seq = sorted(d, key=lambda s: (d[s], s))
        kept: list[int] = []
        for s in seq:
            if all(abs(s - k) >= N for k in kept):
                kept.append(s)
        out[metric] = {
            "ordinal": seq.index(twin) + 1,
            "competition": 1 + sum(1 for v in d.values() if v < d[twin]),
            "dedup": kept.index(twin) + 1 if twin in kept else None,
            "closest": seq[0],
            "tied_closest": sorted(s for s in d if d[s] == d[seq[0]]),
        }
    return out


def month_name(i: int) -> str:
    return f"{i // 12:04d}-{i % 12 + 1:02d}"


def test_comparison_window_rank_matches_fixture(rebuilt, snapshot):
    twin = window(rebuilt, "comparison")
    bf = brute_force(snapshot, twin["start"])
    assert bf["n"] == rebuilt["candidates"]["candidates"]
    for metric in ("chebyshev", "l1", "l2_squared"):
        got = twin["ranks"][metric]
        for k in ("ordinal", "competition", "dedup"):
            assert got[k] == bf[metric][k], (metric, k)


def test_closest_window_matches_fixture(rebuilt, snapshot):
    close = window(rebuilt, "closest_match")
    bf = brute_force(snapshot, close["start"])
    for metric in ("chebyshev", "l1", "l2_squared"):
        assert month_name(bf[metric]["closest"]) == close["start"]
        assert bf[metric]["ordinal"] == 1
    assert [month_name(s) for s in bf["chebyshev"]["tied_closest"]] == rebuilt["closest_match"]["tied_for_closest"]
    assert rebuilt["closest_match"]["start"] == close["start"]


def test_check_mode_accepts_matching_and_rejects_altered_fixture(snapshot, tmp_path, capsys):
    assert tc.check(snapshot, FIXTURE) == 0
    altered = tmp_path / "twin-windows.json"
    altered.write_text(FIXTURE.read_text(encoding="utf-8").replace('"chebyshev"', '"chebychev"', 1), encoding="utf-8")
    assert tc.check(snapshot, altered) == 1
    assert "MISMATCH" in capsys.readouterr().err
    assert tc.check(snapshot, tmp_path / "missing.json") == 1


def _snapshot_with(snapshot: Path, tmp_path: Path, month: str, value: str) -> Path:
    snap = json.loads(snapshot.read_text(encoding="utf-8"))
    for r in snap["rows"]:
        if r["date"] == f"{month}-01":
            r["value_str"] = value
    out = tmp_path / "CPIAUCNS.json"
    out.write_text(json.dumps(snap), encoding="utf-8")
    return out


@pytest.mark.parametrize("month", ["2022-06", "2013-05", "1990-01"])
def test_missing_level_stops_the_run(snapshot, tmp_path, month):
    """A reference, comparison or would-be candidate window with an empty level is refused, not skipped."""
    with pytest.raises(ValueError, match="missing level"):
        tc.build(_snapshot_with(snapshot, tmp_path, month, ""))


def test_month_gap_stops_the_run(snapshot, tmp_path):
    snap = json.loads(snapshot.read_text(encoding="utf-8"))
    snap["rows"] = [r for r in snap["rows"] if r["date"] != "1980-03-01"]
    bad = tmp_path / "CPIAUCNS.json"
    bad.write_text(json.dumps(snap), encoding="utf-8")
    with pytest.raises(ValueError, match="gap"):
        tc.build(bad)


def test_refetch_with_identical_levels_keeps_committed_provenance(snapshot, committed, tmp_path):
    """Different retrieved_at and file hash, same levels: the reconciled fixture is unchanged."""
    snap = json.loads(snapshot.read_text(encoding="utf-8"))
    snap["retrieved_at"] = "2030-01-01T00:00:00Z"
    snap["sha256_of_raw"] = "0" * 64
    other = tmp_path / "CPIAUCNS.json"
    other.write_text(json.dumps(snap, indent=1) + "\n", encoding="utf-8")
    assert tc.render(tc.reconcile(tc.build(other), committed)) == FIXTURE.read_text(encoding="utf-8")


def test_script_cli_check_exit_code(snapshot):
    import subprocess
    run = subprocess.run([sys.executable, str(tc.HERE / "twin_check.py"), "--check"], capture_output=True, text=True)
    assert run.returncode == 0, run.stderr
    assert shutil.which("git") is None or "matches the recomputation" in run.stdout
