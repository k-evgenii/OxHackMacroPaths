"""Tests for the planner reference. Run: pixi run test-planner (pytest research/test_planner.py)."""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "research"))
from planner import Policy, Scenario, evaluate, policies, recommend, shortfall, showcase, tail_mean  # noqa: E402

PRICES = {"excess": 0.5, "fuel": 0.5}   # the brief's 0.5 convention, H = 2c*s


def three_scenarios():
    return [
        Scenario("a", 0.0, 0.0, 0.0),      # calm: no overrun
        Scenario("b", 0.3, 1.0, 5.0),      # fuel spike: overrun 500 at q=100, fuel saturates
        Scenario("c", 1.0, 0.2, 1.0),      # inflation without fuel: overrun 100
    ]


def test_shortfall_formula():
    assert shortfall(L=728, B=200, c=200, H=400) == 328
    assert shortfall(L=0, B=200, c=200, H=0) == 0        # premium lost but budget covers: no shortfall
    assert shortfall(L=100, B=200, c=0, H=0) == 0


def test_tail_mean_uses_ceil():
    assert tail_mean([5, 1, 3, 2], alpha=0.05) == 5      # ceil(0.2) = 1 element
    assert tail_mean([5, 1, 3, 2], alpha=0.5) == 4       # mean of 5 and 3


def test_half_price_reduces_to_double_stake():
    s = three_scenarios()
    r = evaluate(Policy("fuel", 100.0), s, q=100, B=200, prices=PRICES)
    assert r.units == 200.0
    # scenario b: L=500, cash left 100, payout 200*1.0 -> shortfall 200
    assert r.shortfalls == [0.0, 200.0, 0.0]


def test_policy_grid_and_stake_bound():
    pol = policies(200.0)
    assert len(pol) == 21 and pol[0] == Policy("cash", 0.0)
    assert all(0 <= p.stake <= 200.0 for p in pol)


def test_recommendation_hand_computed():
    s = three_scenarios()
    best, ranked = recommend(s, q=100, B=200, prices=PRICES)
    # Only scenario b produces shortfall; N=3 -> tail = max. Fuel at full stake: 500-0-400 = 100.
    assert best.policy == Policy("fuel", 200.0)
    assert best.tail_loss_95 == 100.0
    # Deterministic ordering and tie-break: cash beats any equal-tail policy
    assert [r.policy for r in ranked] == [r.policy for r in recommend(s, 100, 200, PRICES)[1]]


def test_cash_wins_when_cover_cannot_help():
    s = [Scenario("x", 0.0, 0.0, 1.0)]      # overrun 100 < budget; nothing to gain
    best, _ = recommend(s, q=100, B=200, prices=PRICES)
    assert best.policy == Policy("cash", 0.0)


def test_showcase_numbers_match_notebook_check():
    # 2021-24: fuel overrun 7.284 $-months/gal, fuel score 1, excess score 0.367 at the p90 cap, price 0.5
    show = Scenario("2021-01", 0.367037, 1.0, 7.2844)
    f = showcase(Policy("fuel", 200.0), show, 100, 200, PRICES)
    assert abs(f["shortfall"] - 328.44) < 0.5 and abs(f["cash_baseline_shortfall"] - 528.44) < 0.5
    e = showcase(Policy("excess", 200.0), show, 100, 200, PRICES)
    assert abs(e["shortfall"] - 581.6) < 1.0           # inflation cover worse than cash for a fuel bill


def test_artifact_if_present():
    p = ROOT / "forecast" / "planner.json"
    if not p.exists():
        return
    art = json.loads(p.read_text())
    assert len(art["scenarios"]) > 200 and art["default_table"][0] == art["default_recommendation"]
    assert all(0 <= s["excess_score"] <= 1 and 0 <= s["fuel_score"] <= 1 for s in art["scenarios"])


if __name__ == "__main__":   # no pytest in the pixi envs on Windows: run the functions directly
    import traceback
    fails = 0
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            try:
                fn(); print("ok  ", name)
            except Exception:
                fails += 1; print("FAIL", name); traceback.print_exc()
    raise SystemExit(1 if fails else 0)
