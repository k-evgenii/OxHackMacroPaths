"""Candidate products (sub-pools) for MacroPaths, with the economic event each one
hedges, who is on each side, and the exact path statistic that settles it.

A product is: an integer row (one transformed series or a composite), a statistic
from the on-chain family {max_decline, max_rise, accumulated_excess, time_above,
time_below}, a threshold K where relevant, and a cap. Score = min(stat, cap)/cap.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Callable

import numpy as np
import pandas as pd

from macrolib import (accumulated_excess, max_decline, max_rise, sahm_gap, time_above,
                      time_below, yoy, zscore)


@dataclass
class Product:
    key: str
    name: str
    row: str                      # what x_t is, in words
    event: str                    # the economic event the "more" side is paid on
    more_side: str                # who buys protection (is paid if the event is large)
    less_side: str                # natural counterparty (paid if it is small)
    stat: str                     # on-chain statistic family
    k: float | None               # threshold for excess / time stats
    cap_rule: str                 # how the cap is set
    build: Callable[[pd.DataFrame], pd.Series] = field(repr=False)
    fn: Callable = field(repr=False)
    fn_kw: dict = field(default_factory=dict, repr=False)

    def series(self, P: pd.DataFrame) -> pd.Series:
        s = self.build(P)
        s.name = self.key
        return s

    def stat_value(self, x: np.ndarray) -> float:
        return float(self.fn(x, **self.fn_kw))


def _real_10y(P):
    # The 10-year TIPS yield itself (DFII10, from 2003). The earlier proxy, a 10-year
    # nominal yield minus a 5-year breakeven, mismatched maturities and spiked in 2008.
    return P["DFII10"]


def _stagflation(P):
    # Declared composite: equal weights on standardised headline inflation and
    # unemployment, minus the curve slope (an inverted curve adds to stress).
    return (zscore(yoy(P["CPIAUCNS"])) + zscore(P["UNRATE"]) - zscore(P["T10Y2Y"])) / 3.0


PRODUCTS: list[Product] = [
    Product("cooling", "Inflation Cooling", "CPI-U YoY, pp",
            "disinflation: how far headline inflation falls from its running peak",
            "index-linked bondholders, TIPS holders (they lose when inflation cools)",
            "fixed-rate borrowers, nominal bondholders",
            "max_decline", None, "8 pp (declared)",
            lambda P: yoy(P["CPIAUCNS"]), max_decline),
    Product("excess", "Excess Inflation", "CPI-U YoY, pp",
            "persistent inflation above 4%: pp-months of overshoot",
            "firms with CPI-indexed input surcharges, tenants with CPI rents",
            "landlords with CPI-indexed rents, index-linked bondholders",
            "accumulated_excess", 4.0, "80 pp-months (declared); 90th pct pre-2021 shown",
            lambda P: yoy(P["CPIAUCNS"]), accumulated_excess, {"k": 4.0}),
    Product("sticky_core", "Sticky Core", "core PCE YoY, pp",
            "core inflation stays above 3%: months the Fed cannot ease",
            "floating-rate borrowers, growth-equity holders",
            "money-market savers, banks earning on floating assets",
            "time_above", 3.0, "48 months (the window)",
            lambda P: yoy(P["PCEPILFE"]), time_above, {"k": 3.0}),
    Product("hiking", "Hiking-Cycle Cost", "effective fed funds, pp",
            "policy rate held above 2%: pp-months of restrictive policy",
            "SOFR/floating-rate borrowers, leveraged loans, ARMs",
            "money-market funds, floating-rate note holders",
            "accumulated_excess", 2.0, "90th pct of pre-2021 48-month windows",
            lambda P: P["FEDFUNDS"], accumulated_excess, {"k": 2.0}),
    Product("sahm", "Sahm Trigger", "Sahm gap on U3, pp",
            "labour-market break: rise in the Sahm-rule gap (3-month mean of U3 minus its low over the previous 12 months; trigger 0.50 pp) from its running low; computed on current-vintage UNRATE, not real-time data",
            "consumer lenders, staffing firms, cyclical employers",
            "counter-cyclical businesses, recession-hedged funds",
            "max_rise", None, "90th pct of pre-2021 windows",
            lambda P: pd.Series(sahm_gap(P["UNRATE"].to_numpy()), index=P.index), max_rise),
    Product("inversion", "Curve Inversion", "10y-2y spread, pp",
            "yield-curve inversion: months the 10y-2y is below zero",
            "banks and lenders whose margin is the slope",
            "long-duration bondholders, pension funds",
            "time_below", 0.0, "48 months",
            lambda P: P["T10Y2Y"], time_below, {"k": 0.0}),
    Product("real_rate", "Real-Rate Shock", "10y TIPS real yield (DFII10), pp",
            "rise in real yields from the running low",
            "mortgage REITs, long-duration equity, homebuilders",
            "insurers and pensions that need higher real yields",
            "max_rise", None, "90th pct of pre-2021 windows",
            _real_10y, max_rise),
    Product("mortgage", "Mortgage Lock-in", "30y mortgage rate, pp",
            "rise in mortgage rates from the running low",
            "homebuilders, realtors, mortgage originators",
            "existing fixed-rate mortgage holders (their asset gains value)",
            "max_rise", None, "90th pct of pre-2021 windows",
            lambda P: P["MORTGAGE30US"], max_rise),
    Product("gasoline", "Fuel Pass-through", "gasoline, dollars per gallon",
            "sustained gasoline above 3.50 dollars: dollar-months",
            "fleets, airlines, delivery firms, commuters",
            "refiners, oil producers",
            "accumulated_excess", 3.5, "90th pct of pre-2021 windows",
            lambda P: P["GASREGW"], accumulated_excess, {"k": 3.5}),
    Product("real_wage", "Real-Wage Squeeze", "CPI YoY minus AHE YoY, pp",
            "inflation outrunning wages: pp-months of real-wage decline",
            "consumer-discretionary retailers, unions negotiating contracts",
            "employers with nominal wage contracts",
            "accumulated_excess", 0.0, "90th pct of pre-2021 windows",
            lambda P: yoy(P["CPIAUCNS"]) - yoy(P["AHETPI"]), accumulated_excess, {"k": 0.0}),
    Product("dollar", "Dollar Surge", "broad dollar index YoY, pp",
            "appreciation of the dollar from its running low",
            "US exporters, EM borrowers with dollar debt",
            "US importers, tourists, dollar-earning foreign firms",
            "max_rise", None, "90th pct of pre-2021 windows",
            lambda P: yoy(P["DTWEXBGS"]), max_rise),
    Product("housing", "Housing Stall", "housing starts YoY, pp",
            "collapse in housing starts from the running peak",
            "builders, lumber and appliance suppliers, mortgage lenders",
            "renters, REITs with existing stock",
            "max_decline", None, "90th pct of pre-2021 windows",
            lambda P: yoy(P["HOUST"]), max_decline),
    Product("vol", "Volatility Regime", "VIX monthly mean",
            "months of VIX above 25",
            "equity-heavy portfolios, volatility sellers",
            "vol funds, long-vol strategies",
            "time_above", 25.0, "48 months",
            lambda P: P["VIXCLS"], time_above, {"k": 25.0}),
    Product("openings", "Hiring Freeze", "job openings per unemployed (v/u)",
            "decline in labour-market tightness from its peak",
            "staffing firms, HR software, wage-indexed contracts",
            "employers facing wage pressure",
            "max_decline", None, "90th pct of windows since 2001",
            lambda P: P["JTSJOL"] / P["UNEMPLOY"],
            max_decline),
    Product("stagflation", "Stagflation Composite", "mean of z(CPI YoY), z(U3), -z(10y-2y)",
            "months the composite stress is above +1 sd",
            "diversified corporates, equity funds",
            "defensive and inflation-linked portfolios",
            "time_above", 1.0, "48 months",
            _stagflation, time_above, {"k": 1.0}),
]

BY_KEY = {p.key: p for p in PRODUCTS}

PANEL_SPEC = {
    "CPIAUCNS": "mean", "PCEPILFE": "mean", "UNRATE": "mean", "FEDFUNDS": "mean",
    "DFII10": "mean", "T10Y2Y": "mean", "MORTGAGE30US": "mean",
    "GASREGW": "mean", "AHETPI": "mean", "DTWEXBGS": "mean", "HOUST": "mean",
    "VIXCLS": "mean", "JTSJOL": "mean", "UNEMPLOY": "mean", "CPILFENS": "mean",
    "ICSA": "mean", "USREC": "mean", "DCOILWTICO": "mean", "EXPINF1YR": "mean",
}
