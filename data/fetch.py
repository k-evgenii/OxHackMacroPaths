"""Fetch macro series from open sources and freeze them as hashed snapshots.

Usage:
    python data/fetch.py                  # fetch CPIAUCNS (default)
    python data/fetch.py --series UNRATE  # one series
    python data/fetch.py --all            # every series in series.toml
    python data/fetch.py --refresh ...    # re-download and overwrite, printing changed rows

An existing snapshot is re-checked, not re-downloaded. A committed snapshot is never
overwritten without --refresh, because the on-chain
commitment chain is built from the snapshot and must not change silently.
Values are kept as the exact strings from the source; no floats are parsed here.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import io
import json
import sys
import time
import tomllib
from datetime import datetime, timezone
from pathlib import Path

import requests

DATA = Path(__file__).resolve().parent
RAW = DATA / "raw"
SNAP = DATA / "snapshots"
CONFIG = DATA / "series.toml"


# ---------- sources: each returns (url, raw_bytes) ----------

def _get(url: str, tries: int = 3) -> bytes:
    last: Exception | None = None
    for i in range(tries):
        try:
            r = requests.get(url, timeout=30, headers={"User-Agent": "curl/8.5.0", "Accept": "*/*"})
            r.raise_for_status()
            return r.content
        except requests.RequestException as e:
            last = e
            time.sleep(2 ** i)
    raise RuntimeError(f"download failed after {tries} tries: {url}: {last}")


def fred(series_id: str) -> tuple[str, bytes]:
    url = f"https://fred.stlouisfed.org/graph/fredgraph.csv?id={series_id}"
    return url, _get(url)


SOURCES = {"fred": fred}


# ---------- parsing and validation ----------

def parse_fred(series_id: str, raw: bytes) -> list[dict]:
    reader = csv.reader(io.StringIO(raw.decode("utf-8-sig")))
    header = next(reader)
    if len(header) != 2 or header[0] not in ("observation_date", "DATE") or header[1] != series_id:
        raise ValueError(f"{series_id}: unexpected header {header}")
    rows = []
    for date, value in reader:
        rows.append({"date": date, "value_str": value.strip()})
    if not rows:
        raise ValueError(f"{series_id}: no rows")
    return rows


MISSING = ("", ".")


def next_month(date: str) -> str:
    y, m = int(date[:4]), int(date[5:7])
    y, m = (y + 1, 1) if m == 12 else (y, m + 1)
    return f"{y:04d}-{m:02d}-01"


def check_rows(series_id: str, rows: list[dict], spec: dict) -> None:
    """Dates strictly increasing, monthly series contiguous, every empty value declared.

    `known_missing` in series.toml lists the months the source leaves empty, each with a
    reason. With `strict = true` any other empty value or skipped month fails, and so does
    a declared month that now has a value, so a stale declaration is noticed. Without
    `strict` the same problems are printed. Empty values are never dropped or filled here.
    """
    dates = [r["date"] for r in rows]
    for a, b in zip(dates, dates[1:]):
        if not a < b:
            raise ValueError(f"{series_id}: dates not strictly increasing at {a} -> {b}")
    problems = []
    if spec.get("frequency") == "monthly":
        problems += [f"months missing between {a[:7]} and {b[:7]}"
                     for a, b in zip(dates, dates[1:]) if b != next_month(a)]
    declared = {d["month"]: d["reason"] for d in spec.get("known_missing", [])}
    empty = [r["date"][:7] for r in rows if r["value_str"] in MISSING]
    for month in empty:
        if month in declared:
            print(f"  {month}: empty, declared in series.toml ({declared[month]})")
        else:
            problems.append(f"{month}: empty value not declared in known_missing")
    problems += [f"{month}: declared in known_missing but not empty in the data"
                 for month in sorted(set(declared) - set(empty))]
    if not problems:
        return
    if spec.get("strict"):
        raise ValueError(f"{series_id}: " + "; ".join(problems))
    print(f"  WARNING: {len(problems)} gaps or undeclared empty values (series is not strict):")
    for p in problems[:10]:
        print(f"    {p}")
    if len(problems) > 10:
        print(f"    ... and {len(problems) - 10} more")


def check_window(series_id: str, rows: list[dict], window: list[str]) -> None:
    start, end = window
    by_month = {r["date"][:7]: r for r in rows}
    y, m = map(int, start.split("-"))
    ey, em = map(int, end.split("-"))
    n = 0
    while (y, m) <= (ey, em):
        key = f"{y:04d}-{m:02d}"
        row = by_month.get(key)
        if row is None:
            raise ValueError(f"{series_id}: month {key} missing")
        if row["value_str"] in MISSING:
            raise ValueError(f"{series_id}: month {key} has no value")
        n += 1
        y, m = (y + 1, 1) if m == 12 else (y, m + 1)
    print(f"  window {start}..{end}: {n} months, complete")


# ---------- snapshot ----------

def fetch_one(spec: dict, refresh: bool) -> None:
    sid = spec["id"]
    snap_path = SNAP / f"{sid}.json"
    if snap_path.exists() and not refresh:
        print(f"{sid}: snapshot exists, not downloading (use --refresh); re-checking it")
        rows = json.loads(snap_path.read_text())["rows"]
        check_rows(sid, rows, spec)
        if "window" in spec:
            check_window(sid, rows, spec["window"])
        return

    print(f"{sid}: downloading from {spec['source']}")
    url, raw = SOURCES[spec["source"]](sid)
    rows = parse_fred(sid, raw)
    print(f"  {len(rows)} rows, {rows[0]['date']} .. {rows[-1]['date']}")
    check_rows(sid, rows, spec)
    if "window" in spec:
        check_window(sid, rows, spec["window"])

    if snap_path.exists():
        old = {r["date"]: r["value_str"] for r in json.loads(snap_path.read_text())["rows"]}
        changed = [(r["date"], old[r["date"]], r["value_str"])
                   for r in rows if r["date"] in old and old[r["date"]] != r["value_str"]]
        added = sum(1 for r in rows if r["date"] not in old)
        print(f"  vs previous snapshot: {len(changed)} rows changed, {added} added")
        for d, a, b in changed[:20]:
            print(f"    {d}: {a} -> {b}")

    RAW.mkdir(exist_ok=True)
    SNAP.mkdir(exist_ok=True)
    (RAW / f"{sid}.csv").write_bytes(raw)
    snapshot = {
        "id": sid,
        "source": spec["source"],
        "source_url": url,
        "retrieved_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "sha256_of_raw": hashlib.sha256(raw).hexdigest(),
        "frequency": spec.get("frequency"),
        "units": spec.get("units"),
        "rows": rows,
    }
    snap_path.write_text(json.dumps(snapshot, indent=1) + "\n", newline="\n")
    print(f"  wrote {snap_path.relative_to(DATA.parent)}  sha256={snapshot['sha256_of_raw'][:16]}...")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    g = ap.add_mutually_exclusive_group()
    g.add_argument("--series", action="append", help="series id (repeatable)")
    g.add_argument("--all", action="store_true", help="every series in series.toml")
    ap.add_argument("--refresh", action="store_true", help="re-download and overwrite existing snapshots")
    args = ap.parse_args()

    specs = {s["id"]: s for s in tomllib.loads(CONFIG.read_text())["series"]}
    wanted = list(specs) if args.all else (args.series or ["CPIAUCNS"])
    failed = []
    for sid in wanted:
        if sid not in specs:
            print(f"{sid}: not in series.toml", file=sys.stderr)
            failed.append(sid)
            continue
        try:
            fetch_one(specs[sid], args.refresh)
        except Exception as e:
            print(f"{sid}: FAILED: {e}", file=sys.stderr)
            failed.append(sid)
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
