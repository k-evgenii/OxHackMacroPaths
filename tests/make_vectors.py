"""Reference test vectors for MacroPaths (task 5).

Usage:
    pixi run vectors                                   # reads data/snapshots/CPIAUCNS.json
    pixi run python tests/make_vectors.py SNAPSHOT     # any other snapshot path

Source of truth: docs/macropaths-maths.pdf, version 2. Equation numbers below refer to it.

Everything here is integer arithmetic. Level strings such as "257.971" are parsed
exactly into integers at a common decimal scale; there are no floats anywhere. Every
division is Python `//` on integers with a positive denominator, which is the
mathematical floor (Rust `div_euclid` for a positive divisor), as the doc requires.

Writes tests/vectors.json (fixed key order, indent 2, LF, trailing newline) and
asserts every number quoted in the doc. The last printed line is the summary
`D=<D47> A=<A47> <s1> <s2>`; the line before it is `dataset_id=... C_0=... C_N=...`.

The commitment chain (dataset_id, C_i, C_0, C_N) follows docs/commitment-chain.md (v1)
exactly: little-endian integers, u32-length-prefixed UTF-8 strings, raw ASCII tags, SHA-256.
"""

from __future__ import annotations

import hashlib
import json
import re
import struct
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_SNAPSHOT = ROOT / "data" / "snapshots" / "CPIAUCNS.json"
OUT = ROOT / "tests" / "vectors.json"

VERSION = 1
SERIES_ID = "CPIAUCNS"
WINDOW_START = "2020-01-01"  # t = -12
WINDOW_END = "2024-12-01"  # t = 47
N_LEVELS = 60
N_OBS = 48

ONE = 1_000_000  # millionths; also the 10^6 of eq. (1)
K = 40_000  # eq. (4): 4% in units of 1e-4 pp
DCAP = 80_000  # 8 pp
ACAP = 800_000  # 80 pp-months, the demo cap (section 2)
ACAP_40 = 400_000  # 40 pp-months, the saturated variant in the section 2 table
PLAY_DECIMALS = 6
PLAY = 10**PLAY_DECIMALS

# Commitment chain v1 (docs/commitment-chain.md)
CHAIN_SPEC = "docs/commitment-chain.md"
CHAIN_VERSION = "v1"
SOURCE_URL = "https://fred.stlouisfed.org/graph/fredgraph.csv?id=CPIAUCNS"
TRANSFORM_ID = "yoy-1e6-floor-v1"
FIRST_PERIOD_ID = 202101
TAG_DATASET = "PATH-DATASET-v1"
TAG_OBS = b"PATH-OBS-v1"
TAG_END = b"PATH-END-v1"
OBS_PREIMAGE_LEN = 91
END_PREIMAGE_LEN = 47

LEVEL_RE = re.compile(r"^([0-9]+)(?:\.([0-9]+))?$")


# ---------- exact parsing ----------

def frac_digits(s: str) -> int:
    m = LEVEL_RE.match(s)
    if m is None:
        raise ValueError(f"not a plain non-negative decimal: {s!r}")
    return len(m.group(2) or "")


def to_scaled_int(s: str, scale: int) -> int:
    """'257.971' at scale 3 -> 257971. Exact, no floats."""
    m = LEVEL_RE.match(s)
    assert m is not None, s
    whole, frac = m.group(1), m.group(2) or ""
    assert len(frac) <= scale, (s, scale)
    return int(whole) * 10**scale + int(frac.ljust(scale, "0") or "0")


def next_month(date: str) -> str:
    y, m = int(date[:4]), int(date[5:7])
    y, m = (y + 1, 1) if m == 12 else (y, m + 1)
    return f"{y:04d}-{m:02d}-01"


# ---------- maths ----------

def floor_div(a: int, b: int) -> int:
    """Mathematical floor of a/b for b > 0 (div_euclid semantics)."""
    assert b > 0
    return a // b


def yoy(p_t: int, p_prev: int) -> int:
    """Eq. (1): floor(10^6 * (P_t - P_{t-12}) / P_{t-12}). Inputs at a common scale."""
    return floor_div(ONE * (p_t - p_prev), p_prev)


def run_recursions(xs: list[int], k: int = K) -> dict:
    """Eqs. (2)-(4) from fresh state: M_{-1} = -inf, D_{-1} = 0, A_{-1} = 0."""
    m = None  # -infinity
    d = 0
    a = 0
    steps = []
    for x in xs:
        m = x if m is None else max(m, x)
        d = max(d, m - x)
        a += max(x - k, 0)
        steps.append({"M": m, "D": d, "A": a})
    return {"M": m, "D": d, "A": a, "steps": steps}


def score(stat: int, cap: int) -> int:
    """Eq. (6) in millionths, floored."""
    return floor_div(ONE * min(stat, cap), cap)


def summary(xs: list[int]) -> dict:
    r = run_recursions(xs)
    return {
        "x": xs,
        "M": r["M"],
        "D": r["D"],
        "A": r["A"],
        "s1": score(r["D"], DCAP),
        "s2": score(r["A"], ACAP),
        "s2_cap40": score(r["A"], ACAP_40),
    }


def settle_budgets(s0: int, s1: int, s: int) -> dict:
    """Eqs. (8)-(9): M = min(S0,S1), P0 = floor(2*M*s/10^6), P1 = 2M - P0, R_j = S_j - M."""
    m = min(s0, s1)
    p0 = floor_div(2 * m * s, ONE)
    p1 = 2 * m - p0
    return {"S": [s0, s1], "M": m, "P": [p0, p1], "R": [s0 - m, s1 - m]}


def claim(a: int, side: int, b: dict) -> int:
    """Eq. (10): floor(a*R_j/S_j) + floor(a*P_j/S_j)."""
    sj = b["S"][side]
    return floor_div(a * b["R"][side], sj) + floor_div(a * b["P"][side], sj)


# ---------- commitment chain (docs/commitment-chain.md, v1) ----------

U32_MAX = 2**32 - 1
I64_MIN, I64_MAX = -(2**63), 2**63 - 1
U64_MAX = 2**64 - 1


def _le(x: int, n: int) -> bytes:
    """n-byte little-endian of a non-negative int < 256**n, written byte by byte."""
    out = bytearray()
    for _ in range(n):
        out.append(x & 0xFF)
        x >>= 8
    assert x == 0
    return bytes(out)


def _int(x: int, name: str, lo: int, hi: int) -> int:
    if type(x) is not int:  # rejects bool and float
        raise TypeError(f"{name}: not an int: {x!r}")
    if not lo <= x <= hi:
        raise ValueError(f"{name}: {x} outside {lo}..{hi}")
    return x


def u32(x: int) -> bytes:
    return _le(_int(x, "u32", 0, U32_MAX), 4)


def u64(x: int) -> bytes:
    return _le(_int(x, "u64", 0, U64_MAX), 8)


def i64(x: int) -> bytes:
    """8-byte two's complement, little-endian."""
    x = _int(x, "i64", I64_MIN, I64_MAX)
    return _le(x + 2**64 if x < 0 else x, 8)


def enc_str(s: str) -> bytes:
    """str(s): u32(len) || UTF-8 bytes."""
    b = s.encode("utf-8")
    return u32(len(b)) + b


def period_id(date: str) -> int:
    """'2021-01-01' -> 202101."""
    assert re.fullmatch(r"[0-9]{4}-[0-9]{2}-01", date), date
    return int(date[:4]) * 100 + int(date[5:7])


def dataset_preimage(series_id: str, source_url: str, window_start: str, window_end: str,
                     transform_id: str, levels: list[str], n: int, first_period_id: int,
                     k: int, d_cap: int, a_cap: int) -> bytes:
    parts = [
        enc_str(TAG_DATASET),
        enc_str(series_id),
        enc_str(source_url),
        enc_str(window_start),
        enc_str(window_end),
        enc_str(transform_id),
        u32(len(levels)),
        *(enc_str(lv) for lv in levels),
        u32(n),
        u32(first_period_id),
        i64(k),
        u64(d_cap),
        u64(a_cap),
    ]
    return b"".join(parts)


def obs_preimage(dataset_id: bytes, i: int, pid: int, value: int, c_next: bytes) -> bytes:
    assert len(dataset_id) == 32 and len(c_next) == 32
    pre = TAG_OBS + dataset_id + u32(i) + u32(pid) + i64(value) + c_next
    assert len(pre) == OBS_PREIMAGE_LEN, len(pre)
    return pre


def end_preimage(dataset_id: bytes, n: int) -> bytes:
    assert len(dataset_id) == 32
    pre = TAG_END + dataset_id + u32(n)
    assert len(pre) == END_PREIMAGE_LEN, len(pre)
    return pre


def build_chain(dataset_id: bytes, obs: list[tuple[int, int]]) -> tuple[bytes, list[dict]]:
    """obs[i] = (period_id_i, value_i). Returns (C_N, entries for i = 0..N-1 with C_i, preimage).

    Computed from i = N-1 down to 0, each C_i hashing C_{i+1}.
    """
    n = len(obs)
    c_n = hashlib.sha256(end_preimage(dataset_id, n)).digest()
    entries: list[dict] = [{}] * n
    nxt = c_n
    for i in range(n - 1, -1, -1):
        pid, value = obs[i]
        pre = obs_preimage(dataset_id, i, pid, value, nxt)
        c_i = hashlib.sha256(pre).digest()
        entries[i] = {"i": i, "period_id": pid, "value": value, "C_i": c_i, "preimage": pre}
        nxt = c_i
    return c_n, entries


def replay_like_observe(dataset_id: bytes, c_0: bytes, c_n: bytes, entries: list[dict]) -> None:
    """Independent forward walk, as `observe` runs it on chain.

    Starts from current = C_0; for each i the keeper supplies next = C_{i+1} (C_N after the
    last row), the hash is rebuilt with struct.pack (not the writers above) and must equal
    current, then current = next. Must end at C_N.
    """
    current = c_0
    n = len(entries)
    for i, e in enumerate(entries):
        nxt = entries[i + 1]["C_i"] if i + 1 < n else c_n
        h = hashlib.sha256(TAG_OBS + dataset_id + struct.pack("<IIq", i, e["period_id"], e["value"])
                           + nxt).digest()
        assert h == current, f"observe({i}) would fail"
        current = nxt
    assert current == c_n
    assert hashlib.sha256(TAG_END + dataset_id + struct.pack("<I", n)).digest() == c_n


# ---------- vector sections ----------

def load_levels(path: Path) -> tuple[dict, list[dict]]:
    snap = json.loads(path.read_text(encoding="utf-8"))
    assert snap["id"] == SERIES_ID, snap["id"]
    rows = [r for r in snap["rows"] if WINDOW_START <= r["date"] <= WINDOW_END]
    assert len(rows) == N_LEVELS, f"expected {N_LEVELS} rows in window, got {len(rows)}"
    expect = WINDOW_START
    for r in rows:
        assert r["date"] == expect, f"gap or disorder at {r['date']} (expected {expect})"
        assert r["value_str"] not in ("", "."), f"empty value at {r['date']}"
        expect = next_month(expect)
    return snap, rows


def build(snapshot_path: Path) -> dict:
    snap, level_rows = load_levels(snapshot_path)
    strs = [r["value_str"] for r in level_rows]
    scale = max(frac_digits(s) for s in strs)
    p = [to_scaled_int(s, scale) for s in strs]  # p[i] is P_{i-12}
    assert all(v > 0 for v in p)

    # Eq. (1)
    xs = [yoy(p[t + 12], p[t]) for t in range(N_OBS)]
    dates = [level_rows[t + 12]["date"] for t in range(N_OBS)]
    assert dates[0] == "2021-01-01" and dates[-1] == "2024-12-01"

    # Eqs. (2)-(6) on the full window
    main = run_recursions(xs)
    d47, a47 = main["D"], main["A"]
    s1, s2, s2_40 = score(d47, DCAP), score(a47, ACAP), score(a47, ACAP_40)
    assert d47 == 66191, d47
    assert a47 == 691184, a47
    assert s1 == 827387, s1
    assert s2 == 863980, s2
    assert s2_40 == 1_000_000, s2_40
    # Eq. (7): both statistics are monotone non-decreasing
    for prev, cur in zip(main["steps"], main["steps"][1:]):
        assert cur["D"] >= prev["D"] and cur["A"] >= prev["A"] and cur["M"] >= prev["M"]

    # Annual slices: recursions restart on each calendar year's 12 observations
    annual = []
    for i, year in enumerate(range(2021, 2025)):
        sl = xs[12 * i: 12 * i + 12]
        assert all(d.startswith(str(year)) for d in dates[12 * i: 12 * i + 12])
        r = summary(sl)
        annual.append({
            "year": year,
            "t_first": 12 * i,
            "t_last": 12 * i + 11,
            "M": r["M"],
            "D": r["D"],
            "A": r["A"],
            "s1": r["s1"],
            "s2": r["s2"],
            "s2_cap40": r["s2_cap40"],
        })
    # The excess accumulator is additive across a partition of the window.
    assert sum(y["A"] for y in annual) == a47

    # Section 4: synthetic same-endpoint pair, plus a path through zero
    up = summary([20_000, 80_000, 30_000])
    flat = summary([20_000, 40_000, 30_000])
    assert up["s1"] == 625_000 and flat["s1"] == 125_000, (up, flat)
    assert up["D"] == 50_000 and flat["D"] == 10_000
    assert up["A"] == 40_000 and flat["A"] == 0
    assert up["s2"] == 50_000 and flat["s2"] == 0
    neg = summary([10_000, -5_000, -20_000, 15_000])
    assert neg["M"] == 15_000 and neg["D"] == 30_000 and neg["A"] == 0
    assert neg["s1"] == 375_000 and neg["s2"] == 0
    assert run_recursions([10_000, -5_000, -20_000, 15_000])["steps"][2]["D"] == 30_000

    # Eq. (1) floor on a negative change: floor, not truncation toward zero
    neg_x = yoy(2, 3)
    assert neg_x == -333_334, neg_x
    trunc = -(ONE // 3)  # what truncating division would give
    assert trunc == -333_333 and neg_x != trunc

    # Threshold cases for eq. (4)
    thresholds = []
    for x, adds in ((39_999, 0), (40_000, 0), (40_001, 1)):
        got = run_recursions([x])["A"]
        assert got == adds, (x, got)
        thresholds.append({"x": x, "A_added": got})

    # Section 3: 3-vs-2 budget case at s = 0
    deps = [[1, 2], [2]]
    b = settle_budgets(sum(deps[0]), sum(deps[1]), 0)
    assert b == {"S": [3, 2], "M": 2, "P": [0, 4], "R": [1, 0]}, b
    claims = [[claim(a, j, b) for a in deps[j]] for j in (0, 1)]
    assert claims == [[0, 0], [4]], claims
    total_claims = sum(map(sum, claims))
    deposited = sum(map(sum, deps))
    assert total_claims == 4 and deposited == 5
    # Naive per-user floors: m_u = floor(a_u*M/S_j), refund a_u - m_u, payout 2*m_u*s (side 0)
    # and 2*m_u*(1-s) (side 1). At s = 0 this over-obligates the pool.
    naive_m = [[floor_div(a * b["M"], b["S"][j]) for a in deps[j]] for j in (0, 1)]
    assert naive_m == [[0, 1], [2]], naive_m
    naive_refund = [sum(a - m for a, m in zip(deps[j], naive_m[j])) for j in (0, 1)]
    naive_payout = [0, 2 * sum(naive_m[1])]  # s = 0: side 0 pays 0, side 1 pays 2 per matched unit
    naive_oblig = sum(naive_refund) + sum(naive_payout)
    assert naive_refund == [2, 0] and naive_payout == [0, 4] and naive_oblig == 6

    # Section 3 worked example, fully matched: side 0 = seed 90 + buyer 10, side 1 = 100 (PLAY, 6 dp)
    buyer = 10 * PLAY
    worked = {}
    for name, s in (("cooling", s1), ("excess", s2)):
        wb = settle_budgets(90 * PLAY + buyer, 100 * PLAY, s)
        worked[name] = {"s": s, "S": wb["S"], "M": wb["M"], "P": wb["P"], "R": wb["R"],
                        "buyer_claim": claim(buyer, 0, wb)}
    assert worked["cooling"]["buyer_claim"] == 16_547_740
    assert worked["excess"]["buyer_claim"] == 17_279_600
    worked_total = worked["cooling"]["buyer_claim"] + worked["excess"]["buyer_claim"]
    assert worked_total == 33_827_340

    # Commitment chain v1 (docs/commitment-chain.md)
    assert snap["source_url"] == SOURCE_URL, snap["source_url"]
    pids = [period_id(d) for d in dates]
    assert pids[0] == FIRST_PERIOD_ID and pids[-1] == 202412, pids
    ds_pre = dataset_preimage(SERIES_ID, SOURCE_URL, WINDOW_START, WINDOW_END, TRANSFORM_ID,
                              strs, N_OBS, FIRST_PERIOD_ID, K, DCAP, ACAP)
    # 6 tagged/metadata strings + u32(L) + 60 length-prefixed levels + u32 u32 i64 u64 u64
    expect_len = (sum(4 + len(t.encode()) for t in (TAG_DATASET, SERIES_ID, SOURCE_URL,
                                                       WINDOW_START, WINDOW_END, TRANSFORM_ID))
                  + 4 + sum(4 + len(lv.encode()) for lv in strs) + 4 + 4 + 8 + 8 + 8)
    assert len(ds_pre) == expect_len, (len(ds_pre), expect_len)
    dataset_id = hashlib.sha256(ds_pre).digest()
    c_n, chain = build_chain(dataset_id, list(zip(pids, xs)))
    c_0 = chain[0]["C_i"]
    assert len(chain) == N_OBS and all(len(e["preimage"]) == OBS_PREIMAGE_LEN for e in chain)
    assert len(end_preimage(dataset_id, N_OBS)) == END_PREIMAGE_LEN
    replay_like_observe(dataset_id, c_0, c_n, chain)

    return {
        "version": VERSION,
        "maths_doc": "docs/macropaths-maths.pdf version 2",
        "provenance": {
            "series_id": snap["id"],
            "source_url": snap["source_url"],
            "retrieved_at": snap["retrieved_at"],
            "sha256_of_raw": snap["sha256_of_raw"],
            "window": [WINDOW_START, WINDOW_END],
        },
        "parameters": {"K": K, "Dcap": DCAP, "Acap": ACAP, "Acap_cap40": ACAP_40, "one": ONE},
        "units": {
            "x": "1e-4 percentage points (32500 = 3.25%)",
            "D": "1e-4 percentage points",
            "A": "1e-4 pp-months",
            "scores": "millionths",
            "play": "base units, 6 decimals",
        },
        "transform": "x_t = floor(10^6 * (P_t - P_{t-12}) / P_{t-12}), mathematical floor (div_euclid)",
        "levels": [{"t": i - 12, "date": r["date"], "level": r["value_str"]}
                   for i, r in enumerate(level_rows)],
        "rows": [{"t": t, "date": dates[t], "x": xs[t]} for t in range(N_OBS)],
        "running": [{"t": t, "M": st["M"], "D": st["D"], "A": st["A"]}
                    for t, st in enumerate(main["steps"])],
        "final": {"M": main["M"], "D": d47, "A": a47, "s1": s1, "s2": s2, "s2_cap40": s2_40},
        "annual_slices": {
            "note": "Each calendar year's 12 observations run the recursions from fresh state "
                    "(M_{-1} = -inf, D_{-1} = 0, A_{-1} = 0); state does not carry over from the "
                    "previous year. Same caps as the main window.",
            "years": annual,
        },
        "synthetic": {
            "same_endpoint_pair": {
                "note": "Section 4: 2% -> 8% -> 3% vs 2% -> 4% -> 3%; same endpoints, different scores",
                "spike": up,
                "flat": flat,
            },
            "through_zero": {
                "note": "D is an absolute decline in 1e-4 pp, defined through zero",
                **neg,
            },
            "transform_negative_floor": {
                "P_t_minus_12": 3,
                "P_t": 2,
                "x": neg_x,
                "truncation_would_give": trunc,
            },
        },
        "threshold": {"K": K, "cases": thresholds},
        "budget_3v2": {
            "s": 0,
            "deposits": deps,
            "S": b["S"],
            "M": b["M"],
            "P": b["P"],
            "R": b["R"],
            "claims": claims,
            "total_claims": total_claims,
            "deposited": deposited,
            "dust": deposited - total_claims,
            "naive_per_user_floor": {
                "note": "Counterexample: per-user m_u = floor(a_u*M/S_j) with independent refunds",
                "matched": naive_m,
                "refunds": naive_refund,
                "payouts": naive_payout,
                "obligations": naive_oblig,
                "deposited": deposited,
            },
        },
        "worked_example": {
            "note": "Section 3, fully matched: side 0 = 90 seed + 10 buyer, side 1 = 100, per product; "
                    "buyer claim via eq. (10)",
            "buyer_deposit": buyer,
            "cooling": worked["cooling"],
            "excess": worked["excess"],
            "buyer_total": worked_total,
        },
        "commitment": {
            "spec": CHAIN_SPEC,
            "version": CHAIN_VERSION,
            "dataset_id": dataset_id.hex(),
            "dataset_preimage_hex": ds_pre.hex(),
            "dataset_preimage_len": len(ds_pre),
            "N": N_OBS,
            "first_period_id": FIRST_PERIOD_ID,
            "K": K,
            "D_cap": DCAP,
            "A_cap": ACAP,
            "transform_id": TRANSFORM_ID,
            "series_id": SERIES_ID,
            "source_url": SOURCE_URL,
            "window": [WINDOW_START, WINDOW_END],
            "C_N": c_n.hex(),
            "C_0": c_0.hex(),
        },
        "chain": [{"i": e["i"], "period_id": e["period_id"], "value": e["value"],
                   "C_i": e["C_i"].hex(), "preimage_hex": e["preimage"].hex()} for e in chain],
    }


def main() -> int:
    snapshot_path = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_SNAPSHOT
    vec = build(snapshot_path)
    print(f"snapshot {snapshot_path}  sha256_of_raw={vec['provenance']['sha256_of_raw']}")
    # Same dataset_id means the same 60 levels, so keep the committed retrieved_at and
    # sha256_of_raw. Otherwise every re-fetch would show vectors.json as changed in git.
    try:
        old = json.loads(OUT.read_text(encoding="utf-8"))
        same_data = old["commitment"]["dataset_id"] == vec["commitment"]["dataset_id"]
    except (OSError, ValueError, KeyError, TypeError):
        old, same_data = None, False
    if same_data:
        for key in ("retrieved_at", "sha256_of_raw"):
            vec["provenance"][key] = old["provenance"][key]
    text = json.dumps(vec, indent=2, ensure_ascii=True) + "\n"
    if same_data and OUT.read_text(encoding="utf-8") == text:
        print(f"vectors.json unchanged (dataset_id matches): {len(vec['rows'])} rows")
    else:
        OUT.write_text(text, encoding="utf-8", newline="\n")
        print(f"wrote {OUT.relative_to(ROOT)}: {len(vec['rows'])} rows")
    for y in vec["annual_slices"]["years"]:
        print(f"  {y['year']}: D={y['D']} A={y['A']} s1={y['s1']} s2={y['s2']}")
    c = vec["commitment"]
    print(f"dataset_id={c['dataset_id']} C_0={c['C_0']} C_N={c['C_N']}")
    f = vec["final"]
    print(f"D={f['D']} A={f['A']} {f['s1']} {f['s2']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
