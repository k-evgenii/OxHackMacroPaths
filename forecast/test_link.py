"""Link tests: one forecast drives the table, the conditional file, the quote and the planner."""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "forecast"))
from ar1lib import QUOTE_KAPPA, clamp_quote  # noqa: E402

table = json.loads((ROOT / "forecast" / "table.json").read_text(encoding="utf-8"))
cond = json.loads((ROOT / "forecast" / "conditional.json").read_text(encoding="utf-8"))
planner = json.loads((ROOT / "forecast" / "planner.json").read_text(encoding="utf-8"))


def test_pinned_numbers():
    assert table["quotes"]["p"] == [384852, 57153]
    assert table["quotes"]["fuel_research_quote"] == 108466
    assert table["caps"] == {"cooling": 76973, "excess": 1883141, "fuel": 36411}


def test_conditional_matches_table():
    assert len(cond["rows"]) == 48
    for r in cond["rows"]:
        t = table["rows"][r["t"]]["excess"]
        assert r["V"] == t["V"] and r["sigma"] == t["sigma"]


def test_end_of_replay_is_realised():
    last = table["rows"][48]["excess"]
    assert last["sigma"] == 0.0 and last["V"] == last["V_rw"]
    assert abs(last["V"] - 367037 / 1_000_000) < 1e-6


def test_quote_single_source():
    r0 = table["rows"][0]
    got = [clamp_quote(r0[k]["V"], r0[k]["sigma"]) for k in ("cooling", "excess")]
    assert got == table["quotes"]["p"] and table["quotes"]["kappa"] == QUOTE_KAPPA
    assert planner["prices"]["excess"] == table["quotes"]["p"][1] / 1e6
    assert planner["prices"]["fuel"] == table["quotes"]["fuel_research_quote"] / 1e6
    assert planner["products"]["excess"]["expected_score"] == r0["excess"]["V"]
    for f in ("forecast/ar1.py", "research/export_artifact.py", "forecast/manifest.py"):
        src = (ROOT / f).read_text(encoding="utf-8")
        assert "0.5 * sigma" not in src and "0.5*sigma0 *" not in src and "floor((V0" not in src


if __name__ == "__main__":
    for n, f in list(globals().items()):
        if n.startswith("test_"):
            f()
            print("ok", n)
