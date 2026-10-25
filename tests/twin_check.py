"""Twin-windows check for MacroPaths: how close is 2013-03..2017-02 to the on-chain window?

Usage:
    pixi run python tests/twin_check.py                  # reads data/snapshots/CPIAUCNS.json, writes tests/twin-windows.json
    pixi run python tests/twin_check.py SNAPSHOT         # any other snapshot path
    pixi run python tests/twin_check.py --check          # recompute and diff against the committed JSON (exit 1 on mismatch)

The reference window is the on-chain session A window, 2021-01..2024-12 (x_0 .. x_47). The script
scans every 48-month window in the snapshot, ranks it by how close its two endpoints (x_0 and x_47)
are to the reference's, and records the numbers behind the claim "same start, same end, different
payout" for the reference, the 2013-03 comparison window and the closest historical match.

Declared rules (also written into the fixture under "method"):
  * x is the contract value: floor(10^6 * (P_t - P_{t-12}) / P_{t-12}) in 1e-4 pp (make_vectors.yoy),
    so every distance is an integer in 1e-4 pp. The unrounded YoY is carried alongside as an exact
    fraction (fractions.Fraction); there are no floats anywhere.
  * distance = Chebyshev = max(|dx_start|, |dx_end|). L1 = |dx_start| + |dx_end| and the squared L2
    distance (dx_start^2 + dx_end^2, rank-equivalent to L2) are reported as cross-checks.
  * candidate set = every 48-month window whose 60 levels are all present in the snapshot, except
    windows whose 48 observation months overlap the reference's (|start - 2021-01| < 48 months,
    i.e. starts 2017-02..2024-12, which includes the reference itself).
  * ranks: "ordinal" sorts by (distance, start month) so ranks are unique; "competition" is
    1 + the number of strictly closer candidates (ties share a rank).
  * de-duplicated rank: walk the candidates in (distance, start month) order, keep one only if its
    48 observation months do not overlap an already kept window (|start - kept start| < 48).
  * a window missing any level it needs is never scored. The reference, the comparison window and
    the closest match must be complete or the script stops; a window that would otherwise be a
    candidate and has a missing level also stops the script (no silent skips).

Reuses make_vectors.py for frac_digits, to_scaled_int, yoy, run_recursions, score and the
constants K, DCAP, ACAP, so the reference numbers are those of vectors.json by construction. The
script also asserts them against vectors.json (read, never typed).

Writes tests/twin-windows.json (fixed key order, indent 2, LF, trailing newline).
"""

from __future__ import annotations

import argparse
import difflib
import hashlib
import json
import subprocess
import sys
from fractions import Fraction
from pathlib import Path

HERE = Path(__file__).resolve().parent
if str(HERE) not in sys.path:
    sys.path.insert(0, str(HERE))

import make_vectors as mv  # noqa: E402  (tests/make_vectors.py)

ROOT = mv.ROOT
DEFAULT_SNAPSHOT = mv.DEFAULT_SNAPSHOT
VECTORS = ROOT / "tests" / "vectors.json"
OUT = ROOT / "tests" / "twin-windows.json"
DOC = ROOT / "docs" / "twin-windows.md"

VERSION = 1
COMMAND = "pixi run python tests/twin_check.py"
N = mv.N_OBS  # 48 observations per window
REF_START = "2021-01"
REF_END = "2024-12"
TWIN_START = "2013-03"  # the comparison window shown in the pitch (a declared pick, not computed)
TOP_ROWS = 15
THRESHOLD = Fraction(15, 100)  # "within 0.15 pp"
X_PER_PP = 10_000  # x is in 1e-4 percentage points
METRICS = (("chebyshev", "chebyshev"), ("l1", "l1"), ("l2_squared", "l2_squared"))


# ---------- formatting (integer maths only) ----------

def fmt_fraction(fr: Fraction, dp: int) -> str:
    """Decimal string of `fr` rounded half away from zero to `dp` places."""
    n, d = abs(fr.numerator), fr.denominator
    scaled = (2 * n * 10**dp + d) // (2 * d)
    whole, frac = divmod(scaled, 10**dp)
    sign = "-" if fr < 0 and scaled != 0 else ""
    return f"{sign}{whole}.{frac:0{dp}d}" if dp else f"{sign}{whole}"


def fmt_x(x: int) -> str:
    """x in 1e-4 pp as a percentage-point decimal string (exact, 4 dp)."""
    sign = "-" if x < 0 else ""
    return f"{sign}{abs(x) // X_PER_PP}.{abs(x) % X_PER_PP:04d}"


def frac_str(fr: Fraction) -> str:
    return f"{fr.numerator}/{fr.denominator}"


def ceil_2dp(fr: Fraction) -> str:
    """Smallest two-decimal bound that is >= fr (fr >= 0)."""
    assert fr >= 0
    hundredths = -((-fr.numerator * 100) // fr.denominator)
    return f"{hundredths // 100}.{hundredths % 100:02d}"


# ---------- snapshot ----------

class Data:
    """The snapshot as parallel arrays indexed by month number (0 = first month)."""

    def __init__(self, path: Path):
        raw = path.read_bytes()
        self.path = path
        self.file_sha256 = hashlib.sha256(raw).hexdigest()
        snap = json.loads(raw.decode("utf-8"))
        if snap["id"] != mv.SERIES_ID:
            raise ValueError(f"{path}: series id {snap['id']!r}, expected {mv.SERIES_ID!r}")
        self.meta = {k: snap[k] for k in ("id", "source_url", "retrieved_at", "sha256_of_raw")}
        if self.meta["source_url"] != mv.SOURCE_URL:
            raise ValueError(f"{path}: source_url {self.meta['source_url']!r}")
        rows = snap["rows"]
        if not rows:
            raise ValueError(f"{path}: no rows")
        self.months: list[str] = []
        self.levels: list[str | None] = []  # None = empty value in the snapshot
        y, m = int(rows[0]["date"][:4]), int(rows[0]["date"][5:7])
        for r in rows:
            expect = f"{y:04d}-{m:02d}-01"
            if r["date"] != expect:
                raise ValueError(f"{path}: month gap or disorder at {r['date']} (expected {expect})")
            self.months.append(expect[:7])
            v = r["value_str"].strip()
            if v in ("", "."):
                self.levels.append(None)
            else:
                mv.frac_digits(v)  # raises unless a plain non-negative decimal
                self.levels.append(v)
            y, m = (y + 1, 1) if m == 12 else (y, m + 1)
        self.idx = {mo: i for i, mo in enumerate(self.months)}
        present = [v for v in self.levels if v is not None]
        self.scale = max(mv.frac_digits(v) for v in present)
        self.p: list[int | None] = [None if v is None else mv.to_scaled_int(v, self.scale)
                                    for v in self.levels]
        assert all(v > 0 for v in self.p if v is not None)
        self.missing = [self.months[i] for i, v in enumerate(self.levels) if v is None]
        # x_t for every month that has a level and a level 12 months earlier (None otherwise)
        self.x: list[int | None] = [None] * len(self.p)
        self.pp: list[Fraction | None] = [None] * len(self.p)
        for i in range(12, len(self.p)):
            a, b = self.p[i], self.p[i - 12]
            if a is not None and b is not None:
                self.x[i] = mv.yoy(a, b)
                self.pp[i] = Fraction(100 * (a - b), b)  # exact YoY in pp, unrounded
        self.levels_sha256 = hashlib.sha256(
            "".join(f"{mo}={v or ''}\n" for mo, v in zip(self.months, self.levels)).encode()
        ).hexdigest()

    def sig_decimals(self, i: int) -> int:
        """Decimal places that carry information (trailing zeros of the stored string dropped)."""
        v = self.levels[i]
        assert v is not None
        return len(v.split(".", 1)[1].rstrip("0")) if "." in v else 0

    def window_range(self, s: int) -> range:
        """Month indices of the 48 observations of the window starting at month index s."""
        return range(s, s + N)

    def complete(self, s: int) -> bool:
        """Window s is inside the data and every level it needs (months s-12 .. s+47) is present."""
        return s >= 12 and s + N <= len(self.p) and all(self.p[i] is not None for i in range(s - 12, s + N))

    def require(self, s: int, what: str) -> None:
        if s < 12 or s + N > len(self.p):
            raise ValueError(f"{what}: window starting at month index {s} is outside the snapshot")
        lacking = [self.months[i] for i in range(s - 12, s + N) if self.p[i] is None]
        if lacking:
            raise ValueError(f"{what}: window {self.months[s]} needs missing level(s) {lacking}; refusing to run")

    def xs(self, s: int) -> list[int]:
        out = [self.x[i] for i in self.window_range(s)]
        assert all(v is not None for v in out)
        return out  # type: ignore[return-value]


# ---------- candidates, distances, ranks ----------

def endpoint_distance(dx_start: int, dx_end: int) -> dict:
    a, b = abs(dx_start), abs(dx_end)
    return {"chebyshev": max(a, b), "l1": a + b, "l2_squared": a * a + b * b}


def scan(d: Data, ref: int) -> tuple[list[dict], list[dict], dict]:
    """Return (candidates, overlapping_but_complete, counts). Candidates exclude the reference's overlap."""
    rs, re_ = d.x[ref], d.x[ref + N - 1]
    cands, overlapping = [], []
    incomplete_overlapping = 0
    for s in range(12, len(d.p) - N + 1):
        overlaps = abs(s - ref) < N
        if not d.complete(s):
            if not overlaps:
                d.require(s, "candidate window")  # stops the script, naming the missing months
            incomplete_overlapping += 1
            continue
        dxs, dxe = d.x[s] - rs, d.x[s + N - 1] - re_
        row = {"s": s, "dx_start": dxs, "dx_end": dxe, **endpoint_distance(dxs, dxe)}
        (overlapping if overlaps else cands).append(row)
    counts = {
        "start_months_in_snapshot_range": len(d.p) - N + 1 - 12,
        "complete_windows": len(cands) + len(overlapping),
        "excluded_overlapping_reference": len(overlapping),
        "excluded_overlapping_reference_with_missing_level": incomplete_overlapping,
        "candidates": len(cands),
    }
    return cands, overlapping, counts


def order(rows: list[dict], key: str, reverse_ties: bool = False) -> list[dict]:
    return sorted(rows, key=lambda r: (r[key], -r["s"] if reverse_ties else r["s"]))


def competition_rank(rows: list[dict], key: str, row: dict) -> int:
    return 1 + sum(1 for o in rows if o[key] < row[key])


def dedup(ordered: list[dict]) -> tuple[list[dict], dict[int, int]]:
    """Greedy non-overlapping selection. Returns (kept, {dropped start: start of the kept window that blocked it})."""
    kept: list[dict] = []
    blocked: dict[int, int] = {}
    for r in ordered:
        blocker = next((k for k in kept if abs(k["s"] - r["s"]) < N), None)
        if blocker is None:
            kept.append(r)
        else:
            blocked[r["s"]] = blocker["s"]
    return kept, blocked


# ---------- per-window description ----------

def git_commit_of(path: Path) -> str | None:
    try:
        out = subprocess.run(["git", "log", "-n", "1", "--format=%H", "--", str(path.relative_to(ROOT))],
                             cwd=ROOT, capture_output=True, text=True, timeout=30)
    except (OSError, subprocess.SubprocessError):
        return None
    if out.returncode != 0:
        return None
    return out.stdout.strip() or None


def endpoint_entry(d: Data, i: int, ref_i: int | None, window_sig: int) -> dict:
    """Month index i is an endpoint (x_0 or x_47). ref_i is the matching reference endpoint."""
    tick = 10 ** (d.scale - window_sig)  # smallest published level step, at the common scale
    out = {
        "month": d.months[i],
        "level": d.levels[i],
        "level_12_months_earlier": d.levels[i - 12],
        "x": d.x[i],
        "x_pp": fmt_x(d.x[i]),
        "yoy_pp_exact": frac_str(d.pp[i]),
        "yoy_pp_exact_6dp": fmt_fraction(d.pp[i], 6),
        "yoy_step_per_level_tick_pp_4dp": fmt_fraction(Fraction(100 * tick, d.p[i - 12]), 4),
    }
    if ref_i is not None:
        dx = d.x[i] - d.x[ref_i]
        dpp = d.pp[i] - d.pp[ref_i]
        out["delta_to_reference"] = {
            "x": dx,
            "pp": fmt_x(dx),
            "pp_exact": frac_str(dpp),
            "pp_exact_6dp": fmt_fraction(dpp, 6),
        }
    return out


def describe(d: Data, s: int, ref: int, role: str, ident: str) -> dict:
    d.require(s, ident)
    xs = d.xs(s)
    r = mv.run_recursions(xs)
    sig = max(d.sig_decimals(i) for i in range(s - 12, s + N))
    entry = {
        "id": ident,
        "role": role,
        "start": d.months[s],
        "end": d.months[s + N - 1],
        "level_months": [d.months[s - 12], d.months[s + N - 1]],
        "max_significant_decimals_in_levels": sig,
        "endpoints": {
            "start": endpoint_entry(d, s, None if s == ref else ref, sig),
            "end": endpoint_entry(d, s + N - 1, None if s == ref else ref + N - 1, sig),
        },
        "M": r["M"],
        "D": r["D"],
        "A": r["A"],
        "score_cooling": mv.score(r["D"], mv.DCAP),
        "score_excess": mv.score(r["A"], mv.ACAP),
        "series": [{"t": t, "date": d.months[s + t], "x": xs[t], "M": st["M"], "D": st["D"], "A": st["A"]}
                   for t, st in enumerate(r["steps"])],
    }
    return entry


def rank_block(s: int, cands: list[dict], overlapping: list[dict], ref: int) -> dict:
    """Ranks of start month index s under each metric, or an error if s is not a candidate."""
    by_s = {c["s"]: c for c in cands}
    if s not in by_s:
        raise ValueError("window is not in the candidate set")
    pool = cands + overlapping  # complete windows, reference's overlap included; reference itself left out below
    pool = [c for c in pool if c["s"] != ref]
    out = {}
    for name, key in METRICS:
        ordered = order(cands, key)
        pos = [c["s"] for c in ordered].index(s) + 1
        kept, blocked = dedup(ordered)
        kept_rev, blocked_rev = dedup(order(cands, key, reverse_ties=True))
        kept_s = [k["s"] for k in kept]
        kept_rev_s = [k["s"] for k in kept_rev]
        out[name] = {
            "ordinal": pos,
            "competition": competition_rank(cands, key, by_s[s]),
            "tied_with": sorted(c["s"] for c in cands if c[key] == by_s[s][key] and c["s"] != s),
            "dedup": kept_s.index(s) + 1 if s in kept_s else None,
            "dedup_blocked_by": blocked.get(s),
            "dedup_if_ties_go_to_later_start": kept_rev_s.index(s) + 1 if s in kept_rev_s else None,
            "ordinal_if_overlapping_windows_were_candidates": [c["s"] for c in order(pool, key)].index(s) + 1,
        }
    return out


def months_of(d: Data, block: dict) -> dict:
    """Replace month indices by month names in a rank block."""
    out = {}
    for name, v in block.items():
        v = dict(v)
        v["tied_with"] = [d.months[i] for i in v["tied_with"]]
        v["dedup_blocked_by"] = None if v["dedup_blocked_by"] is None else d.months[v["dedup_blocked_by"]]
        out[name] = v
    return out


def table_row(d: Data, c: dict, kept_starts: set[int]) -> dict:
    r = mv.run_recursions(d.xs(c["s"]))
    return {
        "start": d.months[c["s"]],
        "end": d.months[c["s"] + N - 1],
        "x_start": d.x[c["s"]],
        "x_end": d.x[c["s"] + N - 1],
        "dx_start": c["dx_start"],
        "dx_end": c["dx_end"],
        "chebyshev": c["chebyshev"],
        "l1": c["l1"],
        "l2_squared": c["l2_squared"],
        "D": r["D"],
        "A": r["A"],
        "score_cooling": mv.score(r["D"], mv.DCAP),
        "score_excess": mv.score(r["A"], mv.ACAP),
        "kept_in_dedup_chebyshev": c["s"] in kept_starts,
    }


# ---------- wording check ----------

def wording(d: Data, ref: int, s: int) -> dict:
    """Does 'endpoints within 0.15 pp' hold? On contract floored x and on exact unrounded YoY."""
    ends = ((ref, s), (ref + N - 1, s + N - 1))
    contract = [abs(d.x[b] - d.x[a]) for a, b in ends]
    exact = [abs(d.pp[b] - d.pp[a]) for a, b in ends]
    c_gap = Fraction(max(contract), X_PER_PP)
    e_gap = max(exact)
    holds = {
        "contract_floored": c_gap <= THRESHOLD,
        "exact_unrounded": e_gap <= THRESHOLD,
    }
    strict = {
        "contract_floored": c_gap < THRESHOLD,
        "exact_unrounded": e_gap < THRESHOLD,
    }
    bound = ceil_2dp(max(c_gap, e_gap))
    start_c, end_c = fmt_x(contract[0]), fmt_x(contract[1])
    facts = (f"the start is {start_c} pp apart and the end is {end_c} pp apart on the contract values")
    if holds["contract_floored"] and holds["exact_unrounded"]:
        text = f"Both endpoints are within 0.15 pp: {facts}."
    elif holds["contract_floored"]:
        text = (f"Both endpoints are within {bound} pp: {facts}; 'within 0.15 pp' holds on the contract "
                f"values but not on the exact unrounded YoY.")
    else:
        text = (f"Both endpoints are within {bound} pp: {facts}; 'within 0.15 pp' does not hold, so the "
                f"windows have similar endpoints, not identical ones.")
    return {
        "threshold_pp": fmt_fraction(THRESHOLD, 2),
        "comparison": f"{d.months[s]}..{d.months[s + N - 1]} against {d.months[ref]}..{d.months[ref + N - 1]}",
        "within_0_15_pp_inclusive": holds,
        "within_0_15_pp_strict": strict,
        "start_gap_pp_4dp": {"contract_floored": start_c, "exact_unrounded": fmt_fraction(exact[0], 4)},
        "end_gap_pp_4dp": {"contract_floored": end_c, "exact_unrounded": fmt_fraction(exact[1], 4)},
        "max_endpoint_gap_pp_4dp": {"contract_floored": fmt_fraction(c_gap, 4),
                                    "exact_unrounded": fmt_fraction(e_gap, 4)},
        "max_endpoint_gap_pp_exact": frac_str(e_gap),
        "smallest_two_decimal_bound_pp": bound,
        "qualified_statement": text,
    }


# ---------- vectors.json cross-check ----------

def check_reference_against_vectors(d: Data, ref: int, entry: dict) -> dict:
    vec = json.loads(VECTORS.read_text(encoding="utf-8"))
    vlevels = {r["date"][:7]: r["level"] for r in vec["levels"]}
    for i in range(ref - 12, ref + N):
        assert vlevels[d.months[i]] == d.levels[i], f"snapshot level {d.months[i]} differs from vectors.json"
    assert len(vec["rows"]) == N and len(vec["running"]) == N
    for t, (row, run, mine) in enumerate(zip(vec["rows"], vec["running"], entry["series"])):
        assert row["date"][:7] == mine["date"] and row["t"] == run["t"] == mine["t"] == t
        assert row["x"] == mine["x"], f"x differs from vectors.json at t={t}"
        assert (run["M"], run["D"], run["A"]) == (mine["M"], mine["D"], mine["A"]), f"M/D/A differ at t={t}"
    f = vec["final"]
    assert (f["M"], f["D"], f["A"], f["s1"], f["s2"]) == (
        entry["M"], entry["D"], entry["A"], entry["score_cooling"], entry["score_excess"])
    assert vec["parameters"]["K"] == mv.K and vec["parameters"]["Dcap"] == mv.DCAP
    assert vec["parameters"]["Acap"] == mv.ACAP
    return {"path": "tests/vectors.json", "dataset_id": vec["commitment"]["dataset_id"],
            "sha256_of_raw": vec["provenance"]["sha256_of_raw"],
            "reference_levels_x_M_D_A_scores_match": True}


# ---------- build ----------

def build(snapshot_path: Path) -> dict:
    d = Data(snapshot_path)
    ref = d.idx[REF_START]
    if d.months[ref + N - 1] != REF_END:
        raise ValueError("reference window does not end at " + REF_END)
    d.require(ref, "reference")
    twin = d.idx[TWIN_START]

    cands, overlapping, counts = scan(d, ref)
    if twin not in {c["s"] for c in cands}:
        raise ValueError(f"{TWIN_START} is not in the candidate set")
    ordered = order(cands, "chebyshev")
    closest = ordered[0]["s"]
    tied_for_closest = [c["s"] for c in ordered if c["chebyshev"] == ordered[0]["chebyshev"]]
    kept, _ = dedup(ordered)
    kept_starts = {k["s"] for k in kept}

    windows = [
        describe(d, ref, ref, "reference", "reference"),
        describe(d, twin, ref, "comparison", "twin_" + d.months[twin].replace("-", "_")),
        describe(d, closest, ref, "closest_match", "closest_" + d.months[closest].replace("-", "_")),
    ]
    by_s = {c["s"]: c for c in cands}
    for w, s in zip(windows[1:], (twin, closest)):
        w["distance_to_reference"] = {k: by_s[s][k] for k in ("chebyshev", "l1", "l2_squared")}
        w["ranks"] = months_of(d, rank_block(s, cands, overlapping, ref))
    windows[0]["distance_to_reference"] = endpoint_distance(0, 0)
    windows[0]["ranks"] = None
    vectors_check = check_reference_against_vectors(d, ref, windows[0])

    first_multi = next(i for i in range(len(d.levels)) if d.levels[i] is not None and d.sig_decimals(i) > 1)
    assert all(d.sig_decimals(i) <= 1 for i in range(first_multi) if d.levels[i] is not None)

    top = [table_row(d, c, kept_starts) for c in ordered[:TOP_ROWS]]
    assert any(r["start"] == d.months[twin] for r in top), "comparison window not in the top table"

    return {
        "version": VERSION,
        "purpose": "Evidence for the 'twin windows' comparison: how close 2013-03..2017-02 is to the "
                   "on-chain 2021-01..2024-12 window, and what pays differently.",
        "provenance": {
            "snapshot": {
                "path": str(snapshot_path.relative_to(ROOT)) if snapshot_path.is_relative_to(ROOT)
                else str(snapshot_path),
                "series_id": d.meta["id"],
                "source_url": d.meta["source_url"],
                "retrieved_at": d.meta["retrieved_at"],
                "sha256_of_raw": d.meta["sha256_of_raw"],
                "file_sha256": d.file_sha256,
            },
            "input_levels": {
                "first_month": d.months[0],
                "last_month": d.months[-1],
                "sha256": d.levels_sha256,
                "note": "sha256 over the lines 'YYYY-MM=level' (empty for a missing value) of the whole "
                        "snapshot; a re-fetch with identical levels keeps the committed snapshot entry above",
                "missing_levels": d.missing,
            },
            "make_vectors": {
                "path": "tests/make_vectors.py",
                "git_commit": git_commit_of(HERE / "make_vectors.py"),
                "sha256": hashlib.sha256((HERE / "make_vectors.py").read_bytes()).hexdigest(),
            },
            "vectors": vectors_check,
            "generator": "tests/twin_check.py",
            "command": COMMAND,
        },
        "parameters": {"K": mv.K, "Dcap": mv.DCAP, "Acap": mv.ACAP, "one": mv.ONE, "N": N},
        "units": {
            "x": "1e-4 percentage points (32500 = 3.25%)",
            "D": "1e-4 percentage points",
            "A": "1e-4 pp-months",
            "scores": "millionths",
            "pp_exact": "exact YoY in percentage points as a reduced fraction, unrounded",
        },
        "method": {
            "x": "x_t = floor(10^6 * (P_t - P_{t-12}) / P_{t-12}) from make_vectors.yoy; a window is x_0..x_47 "
                 "and needs levels P_{-12}..P_47 (60 months)",
            "endpoints": "x_start = x_0 (first month of the window), x_end = x_47 (last month)",
            "distance": "Chebyshev = max(|x_start - x_start_ref|, |x_end - x_end_ref|) on the contract's floored x; "
                        "L1 = |dx_start| + |dx_end|; l2_squared = dx_start^2 + dx_end^2 (rank-equivalent to L2)",
            "primary_metric": "chebyshev",
            "reference": f"{REF_START}..{REF_END} (on-chain session A)",
            "candidate_set": "every 48-month window with all 60 levels present, excluding windows whose 48 "
                             "observation months overlap the reference's: |start - 2021-01| < 48 months, "
                             "i.e. starts 2017-02..2024-12 (the reference itself is among them)",
            "tie_rule": "ordinal rank sorts by (distance, start month), so ties go to the earlier start; "
                        "competition rank is 1 + the number of strictly closer candidates (ties share it)",
            "dedup_rule": "greedy over the (distance, start month) order: keep a window unless its observation "
                          "months overlap an already kept one (|start - kept start| < 48); the de-duplicated "
                          "rank is the position among kept windows",
            "scores": "score_cooling = floor(10^6 * min(D, Dcap) / Dcap); "
                      "score_excess = floor(10^6 * min(A, Acap) / Acap), K = 40000",
            "wording_threshold": "'within 0.15 pp' is tested as |gap| <= 0.15 pp on both endpoints (the strict "
                                 "< variant is recorded too); contract values use the floored x, exact values "
                                 "use fractions.Fraction",
        },
        "level_precision": {
            "first_month_with_more_than_one_significant_decimal": d.months[first_multi],
            "all_earlier_levels_have_at_most_one_significant_decimal": True,
            "note": "FRED stores every level with three decimals; before that month the last two are always 0",
        },
        "candidates": counts,
        "windows": windows,
        "closest_match": {
            "start": d.months[closest],
            "chebyshev": by_s[closest]["chebyshev"],
            "tied_for_closest": [d.months[s] for s in tied_for_closest],
            "same_endpoints_as_closest": [
                d.months[s] for s in tied_for_closest
                if (d.x[s], d.x[s + N - 1]) == (d.x[closest], d.x[closest + N - 1])],
        },
        "top_starts": {name: [d.months[c["s"]] for c in order(cands, key)[:12]] for name, key in METRICS},
        "top_by_chebyshev": top,
        "dedup_chebyshev": [{"rank": n + 1, "start": d.months[k["s"]], "chebyshev": k["chebyshev"]}
                            for n, k in enumerate(kept[:8])],
        "wording": wording(d, ref, twin),
    }


def reconcile(new: dict, old: dict | None) -> dict:
    """Same input levels as the committed fixture: keep its snapshot provenance, as make_vectors does,
    so re-fetching the snapshot (new retrieved_at and file hashes, same levels) does not change the file."""
    try:
        same = old["provenance"]["input_levels"]["sha256"] == new["provenance"]["input_levels"]["sha256"]
    except (TypeError, KeyError):
        same = False
    if same:
        new["provenance"]["snapshot"] = old["provenance"]["snapshot"]
    return new


def render(fixture: dict) -> str:
    return json.dumps(fixture, indent=2, ensure_ascii=True) + "\n"


def load_committed(path: Path) -> dict | None:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def summary_line(fx: dict) -> str:
    ref, twin, close = fx["windows"]
    r = twin["ranks"]
    w = fx["wording"]
    return (f"D={ref['D']} A={ref['A']} {ref['score_cooling']} {ref['score_excess']} | "
            f"twin {twin['start']} gap={twin['distance_to_reference']['chebyshev']} "
            f"rank cheb={r['chebyshev']['ordinal']} l1={r['l1']['ordinal']} l2={r['l2_squared']['ordinal']} "
            f"of {fx['candidates']['candidates']} dedup={r['chebyshev']['dedup']} "
            f"D={twin['D']} A={twin['A']} {twin['score_cooling']} {twin['score_excess']} | "
            f"closest {close['start']} gap={close['distance_to_reference']['chebyshev']} "
            f"ties={','.join(fx['closest_match']['tied_for_closest'])} | "
            f"within0.15pp contract={w['within_0_15_pp_inclusive']['contract_floored']} "
            f"exact={w['within_0_15_pp_inclusive']['exact_unrounded']} "
            f"maxgap={w['max_endpoint_gap_pp_4dp']['contract_floored']}pp")


def check(snapshot_path: Path = DEFAULT_SNAPSHOT, fixture_path: Path = OUT) -> int:
    """Recompute and diff against the committed JSON. Returns the process exit code."""
    old = load_committed(fixture_path)
    if old is None:
        print(f"MISMATCH: {fixture_path} is missing or not valid JSON", file=sys.stderr)
        return 1
    fx = reconcile(build(snapshot_path), old)
    want, have = render(fx), fixture_path.read_text(encoding="utf-8")
    if want == have:
        print(f"{fixture_path.name} matches the recomputation from {snapshot_path.name}")
        print(summary_line(fx))
        return 0
    diff = list(difflib.unified_diff(have.splitlines(), want.splitlines(), "committed", "recomputed", lineterm="", n=1))
    print(f"MISMATCH: {fixture_path.name} differs from the recomputation ({len(diff)} diff lines)", file=sys.stderr)
    print("\n".join(diff[:60]), file=sys.stderr)
    return 1


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("snapshot", nargs="?", type=Path, default=DEFAULT_SNAPSHOT)
    ap.add_argument("--check", action="store_true", help="diff a recomputation against the committed JSON")
    args = ap.parse_args()
    if not args.snapshot.exists():
        print(f"snapshot {args.snapshot} not found; run `pixi run fetch` first", file=sys.stderr)
        return 2
    snapshot = args.snapshot.resolve()
    try:
        if args.check:
            return check(snapshot, OUT)
        fx = reconcile(build(snapshot), load_committed(OUT))
    except ValueError as e:  # missing level, month gap, window outside the data
        print(f"error: {e}", file=sys.stderr)
        return 1
    text = render(fx)
    if OUT.exists() and OUT.read_text(encoding="utf-8") == text:
        print(f"{OUT.relative_to(ROOT)} unchanged")
    else:
        OUT.write_text(text, encoding="utf-8", newline="\n")
        print(f"wrote {OUT.relative_to(ROOT)}")
    print(summary_line(fx))
    return 0


if __name__ == "__main__":
    sys.exit(main())
