"""Exposure-to-contract planner: reference implementation (pure Python).

Question answered: given a monthly gasoline exposure q (gallons), a budget price G
(usd/gal) and a protection budget B (units), which policy among
  cash reserve (stake 0), Excess Inflation cover at stake c, Fuel cover at stake c
with c in {0.1B, ..., 1.0B} has the lowest historical tail shortfall?

Per scenario k (one 48-month historical window):
  L_k = q * sum_t max(gas_{k,t} - G, 0)              expense overrun, usd
  n   = c / p                                         cover units bought at entry price p
  H_k = n * score_k                                   payout (score in [0,1])
  U_k = max(L_k - (B - c) - H_k, 0)                   funding shortfall after cash and payout
TailLoss95 = mean of the largest ceil(0.05 * N) shortfalls.  Lowest wins; ties -> lower stake,
then product order [cash, excess, fuel].  Also reported: mean and max shortfall, how often
the cap binds, and expected end cash E[B - c + H_k] (the premium-cost view the tail objective
ignores).

Units: usd and "units" are treated 1:1 in the demo. PLAY tokens mirror the accounting only.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field

PRODUCT_ORDER = ["cash", "excess", "fuel"]
STAKE_FRACTIONS = [i / 10 for i in range(1, 11)]


@dataclass(frozen=True)
class Scenario:
    start: str
    excess_score: float          # [0, 1]
    fuel_score: float            # [0, 1]
    fuel_overrun_per_gallon: float   # usd-months per gallon: sum_t max(gas_t - G, 0)


@dataclass(frozen=True)
class Policy:
    product: str                 # cash | excess | fuel
    stake: float                 # c, in budget units

    @property
    def key(self) -> tuple[int, float]:
        return (PRODUCT_ORDER.index(self.product), self.stake)


@dataclass
class Result:
    policy: Policy
    units: float
    tail_loss_95: float
    mean_shortfall: float
    max_shortfall: float
    cap_binding_freq: float
    expected_end_cash: float
    shortfalls: list[float] = field(repr=False)


def shortfall(L: float, B: float, c: float, H: float) -> float:
    return max(L - (B - c) - H, 0.0)


def tail_mean(values: list[float], alpha: float = 0.05) -> float:
    n = max(1, math.ceil(alpha * len(values)))
    return sum(sorted(values, reverse=True)[:n]) / n


def evaluate(policy: Policy, scenarios: list[Scenario], q: float, B: float, prices: dict[str, float]) -> Result:
    c = policy.stake
    assert 0 <= c <= B, (c, B)
    if policy.product == "cash":
        units, scores = 0.0, [0.0] * len(scenarios)
    else:
        p = prices[policy.product]
        assert 0 < p <= 1, p
        units = c / p
        scores = [s.excess_score if policy.product == "excess" else s.fuel_score for s in scenarios]
    Ls = [q * s.fuel_overrun_per_gallon for s in scenarios]
    Hs = [units * sc for sc in scores]
    Us = [shortfall(L, B, c, H) for L, H in zip(Ls, Hs)]
    return Result(
        policy=policy, units=units, tail_loss_95=tail_mean(Us),
        mean_shortfall=sum(Us) / len(Us), max_shortfall=max(Us),
        cap_binding_freq=(sum(1 for sc in scores if sc >= 1.0) / len(scores)) if policy.product != "cash" else 0.0,
        expected_end_cash=sum(B - c + H for H in Hs) / len(Hs),
        shortfalls=Us,
    )


def policies(B: float, products: tuple[str, ...] = ("excess", "fuel")) -> list[Policy]:
    out = [Policy("cash", 0.0)]
    for prod in products:
        out += [Policy(prod, round(f * B, 10)) for f in STAKE_FRACTIONS]
    return out


def recommend(scenarios: list[Scenario], q: float, B: float, prices: dict[str, float],
              products: tuple[str, ...] = ("excess", "fuel")) -> tuple[Result, list[Result]]:
    results = [evaluate(pol, scenarios, q, B, prices) for pol in policies(B, products)]
    ranked = sorted(results, key=lambda r: (r.tail_loss_95, r.policy.stake, PRODUCT_ORDER.index(r.policy.product)))
    return ranked[0], ranked


def showcase(policy: Policy, s: Scenario, q: float, B: float, prices: dict[str, float]) -> dict:
    """One scenario (e.g. 2021-24) under a frozen policy, with the cash baseline beside it."""
    L = q * s.fuel_overrun_per_gallon
    if policy.product == "cash":
        units, H = 0.0, 0.0
    else:
        units = policy.stake / prices[policy.product]
        H = units * (s.excess_score if policy.product == "excess" else s.fuel_score)
    return {"overrun": L, "stake": policy.stake, "units": units, "payout": H,
            "remaining_cash": B - policy.stake, "shortfall": shortfall(L, B, policy.stake, H),
            "cash_baseline_shortfall": shortfall(L, B, 0.0, 0.0)}
