"""Deterministic generator for the frontend v2 scenario fixtures.

Run from the repository root:  python packages/client/fixtures/frontend-v2/_generate.py

Everything except the reference session A view and the research artifacts is SYNTHETIC test data:
on-chain states, owners, mints, signatures and balances are invented, and every synthetic JSON
object carries a `_synthetic` note. Reference session A (B89z...) values come from the committed
real fixtures in packages/client/fixtures/. The research bundle is assembled from the committed
web/public/data artifacts; hashes are SHA-256 of the committed git blob bytes (not the working-copy
bytes, which may carry CRLF conversion). No generation timestamp is fabricated (generatedAt: null).
"""

import copy
import hashlib
import json
import subprocess
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[3]
FIX = ROOT / "packages" / "client" / "fixtures"
SYN = "SYNTHETIC test data for frontend v2 scenarios; not an on-chain read."

B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"


def b58(data: bytes) -> str:
    n = int.from_bytes(data, "big")
    out = ""
    while n:
        n, r = divmod(n, 58)
        out = B58[r] + out
    pad = len(data) - len(data.lstrip(b"\0"))
    return "1" * pad + out


def key(tag: str) -> str:
    """Deterministic synthetic pubkey."""
    return b58(hashlib.sha256(b"macropaths-fe2-key:" + tag.encode()).digest())


def sig(tag: str) -> str:
    """Deterministic synthetic 64-byte signature."""
    h = hashlib.sha512(b"macropaths-fe2-sig:" + tag.encode()).digest()
    return b58(h)


def score(stat: int, cap: int) -> int:
    if stat < 0:
        return 0
    return min(stat, cap) * 1_000_000 // cap


def load(name):
    return json.loads((FIX / name).read_text(encoding="utf-8"))


def write(rel, obj):
    p = HERE / rel
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(obj, indent=2) + "\n", encoding="utf-8", newline="\n")


A = load("session-B89z.view.json")
A_POS = load("positions-B89z.view.json")["positions"][0]
A_OWNER = A_POS["owner"]
MINT_A = A["playMint"]
MINT_B = key("mint-b")
FETCHED = "2026-10-25T00:00:00.000Z"  # synthetic fixture read time
META = {"source": "fixture", "fetchedAt": FETCHED}
ZERO2 = ["0", "0"]
ZERO4 = ["0", "0", "0", "0"]


def presentation(label, first=202101, bundle=None):
    return {
        "label": label,
        "mode": "historical_replay",
        "layout": "v1",
        "firstPeriodId": first,
        "researchBundleId": bundle,
    }


def synth_session(tag, state, next_index, mint=MINT_A, terms=None, side_totals=None):
    s = copy.deepcopy(A)
    s["_synthetic"] = SYN
    s["address"] = key(f"session-{tag}")
    s["sessionId"] = str(int(A["sessionId"]) + 1000 + len(tag))
    s["playMint"] = mint
    s["vaults"] = [key(f"vault-{tag}-0"), key(f"vault-{tag}-1")]
    s["state"] = state
    if terms:
        s["terms"] = terms
    s["nextIndex"] = next_index
    s["path"] = A["path"][:next_index]
    s["integrityOk"] = next_index == s["nObs"] and state == "Settled"
    if not s["integrityOk"]:
        s["terminal"] = "0" * 64
    if side_totals:
        s["sideTotals"] = side_totals
    if next_index == 0:
        s["stats"] = {"peak": None, "maxDecline": "0", "excessAcc": "0"}
    else:
        last = s["path"][-1]
        s["stats"] = {"peak": last["peak"], "maxDecline": last["decline"], "excessAcc": last["excess"]}
    if state != "Settled":
        s["scores"] = ZERO2
        s["matched"] = ZERO2
        s["pBudget"] = ZERO4
        s["rBudget"] = ZERO4
    return s


def accrued(s):
    if s["state"] == "Settled":
        return list(s["scores"])
    if s["state"] == "Running" and s["nextIndex"] > 0:
        return [
            str(score(int(s["stats"]["maxDecline"]), int(s["terms"]["dCap"]))),
            str(score(int(s["stats"]["excessAcc"]), int(s["terms"]["aCap"]))),
        ]
    return None


def settle(s):
    """Recompute settled scores/budgets exactly like math.rs for a synthetic Settled session."""
    sc = [score(int(s["stats"]["maxDecline"]), int(s["terms"]["dCap"])),
          score(int(s["stats"]["excessAcc"]), int(s["terms"]["aCap"]))]
    t = [int(x) for x in s["sideTotals"]]
    matched, p, r = [], [], []
    for i in range(2):
        m = min(t[2 * i], t[2 * i + 1])
        p0 = 2 * m * sc[i] // 1_000_000
        matched.append(m)
        p += [p0, 2 * m - p0]
        r += [t[2 * i] - m, t[2 * i + 1] - m]
    s["scores"] = [str(x) for x in sc]
    s["matched"] = [str(x) for x in matched]
    s["pBudget"] = [str(x) for x in p]
    s["rBudget"] = [str(x) for x in r]
    return s


def claim(dep, r, p, total):
    return 0 if total == 0 else dep * r // total + dep * p // total


def position(s, tag, deposited, claimed=False):
    payout = None
    if s["state"] == "Settled":
        payout = [str(claim(int(d), int(s["rBudget"][j]), int(s["pBudget"][j]), int(s["sideTotals"][j])))
                  for j, d in enumerate(deposited)]
    elif s["state"] == "Refunding":
        payout = list(deposited)
    return {"address": key(f"position-{tag}"), "owner": key(f"owner-{tag.split(':')[0]}") if ":" in tag else A_OWNER,
            "deposited": deposited, "claimed": claimed, "payout": payout}


def cover(s, owner, tag, units, premium, claimed=False):
    payout = None
    if s["state"] == "Settled":
        payout = [str(int(s["scores"][i]) * int(u) // 1_000_000) for i, u in enumerate(units)]
    elif s["state"] == "Refunding":
        payout = list(premium)
    return {"address": key(f"cover-{tag}"), "owner": owner, "units": units, "premiumPaid": premium,
            "claimed": claimed, "payout": payout}


def offer_status(s, seller, quote):
    if s["state"] in ("Settled", "Refunding") or s["state"] == "Running":
        return "closed"  # terminal or past the deposit deadline (Running implies deposits closed)
    if seller is None or quote is None or not quote["isSet"]:
        return "not_configured"
    if seller["freeCash"] == "0":
        return "unfunded"
    return "available"


def seller_for(s, free_cash="50000000"):
    return {"address": key(f"seller-{s['address']}"), "seller": key("seller-wallet"), "freeCash": free_cash,
            "escrow": ZERO2, "nSold": ZERO2, "premium": ZERO2, "settled": [False, False]}


def quote_for(s):
    return {"address": key(f"quote-{s['address']}"), "p": ["384852", "57153"], "isSet": True, "frozen": False}


def overview(s, label, vault="ok", offer="ok", seller=True, quote=True, vault_amounts=None, synthetic=True):
    total = sum(int(x) for x in s["sideTotals"])
    sel = seller_for(s) if seller else None
    q = quote_for(s) if quote else None
    o = {
        "session": s,
        "meta": META,
        "presentation": presentation(label),
        "derived": {"currentScores": accrued(s), "poolDeposited": str(total)},
    }
    if vault == "ok":
        amounts = vault_amounts or [str(int(s["sideTotals"][0]) + int(s["sideTotals"][1])),
                                    str(int(s["sideTotals"][2]) + int(s["sideTotals"][3]))]
        o["vault"] = {"status": "ok", "data": {"amounts": amounts, "total": str(sum(int(a) for a in amounts))}}
    else:
        o["vault"] = {"status": "unavailable", "data": None}
    if offer == "ok":
        o["coverOffer"] = {"status": "ok", "data": {"seller": sel, "quote": q, "status": offer_status(s, sel, q)}}
    else:
        o["coverOffer"] = {"status": "unavailable", "data": None}
    if synthetic:
        o = {"_synthetic": SYN, **o}
    return o


# ---------------- sessions ----------------
A_TERMS = A["terms"]
OPEN = synth_session("open", "Open", 0, side_totals=["20000000", "10000000", "0", "5000000"])
RUNNING = synth_session("running", "Running", 24)
REFUNDING = synth_session("refunding", "Refunding", 30)
SETTLED = settle(synth_session("settled", "Settled", 48))
SETTLED_B = settle(synth_session("settled-mint-b", "Settled", 48, mint=MINT_B))
RESEARCH_TERMS = {"k": "40000", "dCap": "76973", "aCap": "1883141"}
SETTLED_P90 = settle(synth_session("research-match", "Settled", 48, terms=RESEARCH_TERMS))

for name, s in [("open", OPEN), ("running", RUNNING), ("refunding", REFUNDING), ("settled", SETTLED),
                ("settled-mint-b", SETTLED_B), ("research-match", SETTLED_P90)]:
    write(f"sessions/{name}.json", s)

# ---------------- catalog ----------------
PRODUCTS = [
    {"key": "cooling", "name": "Inflation Cooling", "description": "Cover that pays as inflation falls from its peak.",
     "status": "supported", "productIndex": 0},
    {"key": "excess", "name": "Excess Inflation", "description": "Cover that pays as inflation stays above the threshold.",
     "status": "supported", "productIndex": 1},
    {"key": "fuel", "name": "Fuel", "description": "Research only: gasoline price cover model.",
     "status": "research", "productIndex": None},
]


# ---------------- research bundle ----------------
def blob(path):
    return subprocess.run(["git", "show", f"HEAD:{path}"], cwd=ROOT, check=True, capture_output=True).stdout


raw = {n: blob(f"web/public/data/{n}.json") for n in ("manifest", "forecast", "planner")}
hashes = {n: hashlib.sha256(b).hexdigest() for n, b in raw.items()}
art = {n: json.loads(b) for n, b in raw.items()}
bundle_id = "research-" + hashlib.sha256("".join(hashes[n] for n in ("manifest", "forecast", "planner")).encode()).hexdigest()[:16]
prods = {p["key"]: p for p in art["manifest"]["products"]}
quotes = dict(zip(art["forecast"]["quotes"]["products"], art["forecast"]["quotes"]["p"]))
quotes["fuel"] = art["forecast"]["quotes"]["fuel_research_quote"]
UNITS = {"1e-4 pp": "1e-4-pp", "1e-4 pp-months": "1e-4-pp-months", "1e-4 usd-months": "1e-4-usd-months"}
terms = []
for k in ("cooling", "excess", "fuel"):
    p = prods[k]
    terms.append({
        "key": k,
        "threshold": None if k == "cooling" else str(p["k"]),
        "cap": str(p["cap"]),
        "units": UNITS[p["cap_units"]],
        "quoteMillionths": str(quotes[k]),
        "researchOnly": k == "fuel",
    })
BUNDLE = {
    "id": bundle_id,
    "schemaVersion": 1,
    "metadata": {
        "generatedAt": None,
        "modelCurrency": "USD",
        "moneyMeaning": "illustrative",
        "hashes": hashes,
        "associatedSession": None,
    },
    "terms": terms,
    "manifest": art["manifest"],
    "forecast": art["forecast"],
    "planner": art["planner"],
}
write("research/bundle.json", BUNDLE)

CATALOG = {
    "version": 1,
    "cluster": "devnet",
    "defaultSession": A["address"],
    "sessions": [{"address": A["address"], "presentation": presentation("Session A · 2021–2024 replay")}],
    "products": PRODUCTS,
    "research": {"bundleId": bundle_id, "path": "/api/artifacts/bundle"},
}
write("catalog/reference.json", CATALOG)
write("catalog/synthetic-multi.json", {
    "_synthetic": SYN,
    **CATALOG,
    "sessions": CATALOG["sessions"] + [
        {"address": s["address"], "presentation": presentation(f"Synthetic {s['state']}")}
        for s in (OPEN, RUNNING, REFUNDING, SETTLED, SETTLED_B)
    ],
})

# research association (matching / mismatching terms)
excess_term = next(t for t in terms if t["key"] == "excess")
cooling_term = next(t for t in terms if t["key"] == "cooling")
for name, s, expected in [("terms-match", SETTLED_P90, "match"), ("terms-mismatch-session-a", A, "mismatch")]:
    write(f"research/{name}.json", {
        "_synthetic": SYN if s is not A else "Reference session A terms vs research p90 caps.",
        "sessionAddress": s["address"],
        "sessionTerms": s["terms"],
        "bundleId": bundle_id,
        "bundleTerms": {"cooling": cooling_term, "excess": excess_term},
        "expected": expected,
    })

# ---------------- session overviews ----------------
write("overview/session-a.json", overview(A, "Session A · 2021–2024 replay", vault="unavailable", seller=False, quote=False))
write("overview/open.json", overview(OPEN, "Synthetic Open"))
write("overview/open-unfunded.json", {**overview(OPEN, "Synthetic Open (unfunded seller)"),
                                      "coverOffer": {"status": "ok", "data": {"seller": seller_for(OPEN, "0"), "quote": quote_for(OPEN), "status": "unfunded"}}})
write("overview/open-missing-seller-quote.json", overview(OPEN, "Synthetic Open (no seller)", seller=False, quote=False))
write("overview/running.json", overview(RUNNING, "Synthetic Running"))
write("overview/refunding.json", overview(REFUNDING, "Synthetic Refunding"))
write("overview/settled.json", overview(SETTLED, "Synthetic Settled"))
write("overview/section-unavailable.json", overview(RUNNING, "Synthetic Running (sections unavailable)", vault="unavailable", offer="unavailable"))

# ---------------- wallet overviews ----------------
OWNER_EMPTY = key("owner-empty")
OWNER_X = key("owner-x")


def holding(s, pos=None, cov=None, ok=True):
    if not ok:
        return {"sessionAddress": s["address"], "read": {"status": "unavailable", "data": None}}
    return {"sessionAddress": s["address"], "read": {"status": "ok", "data": {"position": pos, "cover": cov}}}


def bal(mint, amount=None):
    if amount is None:
        return {"mint": mint, "read": {"status": "unavailable", "data": None}}
    return {"mint": mint, "read": {"status": "ok", "data": {"amount": amount}}}


def wallet(owner, balances, holdings):
    return {"_synthetic": SYN, "owner": owner, "meta": META, "balances": balances, "holdings": holdings}


def pos_for(s, owner, tag, deposited, claimed=False):
    p = position(s, tag, deposited, claimed)
    p["owner"] = owner
    return p


write("wallet/empty-owner.json", wallet(OWNER_EMPTY, [bal(MINT_A, "0")], [holding(A)]))
write("wallet/a-owned.json", wallet(A_OWNER, [bal(MINT_A, "1000000")], [holding(A, pos=A_POS)]))
write("wallet/settled-unclaimed.json", wallet(OWNER_X, [bal(MINT_A, "5000000")], [
    holding(SETTLED, pos=pos_for(SETTLED, OWNER_X, "settled-x", ["10000000", "0", "0", "20000000"]),
            cov=cover(SETTLED, OWNER_X, "settled-x", ["30000000", "40000000"], ["11545560", "2286120"])),
]))
write("wallet/settled-claimed.json", wallet(OWNER_X, [bal(MINT_A, "50000000")], [
    holding(SETTLED, pos=pos_for(SETTLED, OWNER_X, "settled-x", ["10000000", "0", "0", "20000000"], claimed=True),
            cov=cover(SETTLED, OWNER_X, "settled-x", ["30000000", "40000000"], ["11545560", "2286120"], claimed=True)),
]))
write("wallet/refunding.json", wallet(OWNER_X, [bal(MINT_A, "0")], [
    holding(REFUNDING, pos=pos_for(REFUNDING, OWNER_X, "refunding-x", ["5000000", "0", "5000000", "0"]),
            cov=cover(REFUNDING, OWNER_X, "refunding-x", ["10000000", "0"], ["3848520", "0"])),
]))
write("wallet/running.json", wallet(OWNER_X, [bal(MINT_A, "0")], [
    holding(RUNNING, pos=pos_for(RUNNING, OWNER_X, "running-x", ["10000000", "0", "0", "10000000"]),
            cov=cover(RUNNING, OWNER_X, "running-x", ["10000000", "10000000"], ["3848520", "571530"])),
]))
write("wallet/open.json", wallet(OWNER_X, [bal(MINT_A, "0")], [
    holding(OPEN, pos=pos_for(OPEN, OWNER_X, "open-x", ["10000000", "0", "0", "0"])),
]))
write("wallet/two-mints.json", wallet(OWNER_X, [bal(MINT_A, "7000000"), bal(MINT_B, "123456789012345678")], [
    holding(SETTLED, pos=pos_for(SETTLED, OWNER_X, "settled-x", ["10000000", "0", "0", "20000000"])),
    holding(SETTLED_B, pos=pos_for(SETTLED_B, OWNER_X, "settled-b-x", ["10000000", "0", "0", "20000000"])),
]))
write("wallet/section-unavailable.json", wallet(OWNER_X, [bal(MINT_A, None), bal(MINT_B, "0")], [
    holding(A), holding(SETTLED, ok=False),
]))

# ---------------- wallet activity ----------------
def item(s, tag, slot, kind, amount, ix=0, inner=None, product=0, mint=MINT_A, block=1792889000):
    sg = sig(tag)
    return {
        "id": f"{sg}:{ix}:{'top' if inner is None else inner}:{kind}",
        "signature": sg, "instructionIndex": ix, "innerInstructionIndex": inner,
        "session": s["address"], "product": product, "slot": slot, "blockTime": block,
        "kind": kind, "amount": amount, "mint": mint,
    }


def activity(items, next_before, pending=(), retry=None):
    return {"_synthetic": SYN, "items": items, "nextBefore": next_before, "pending": list(pending), "retryCursor": retry}


full_items = [
    item(SETTLED, "claim-pool", 900, "PoolPayout", "26000000", product=None),
    item(SETTLED, "claim-cover", 899, "CoverPayout", "36000000", product=1),
    item(SETTLED, "buy-cover", 500, "CoverBought", "-11545560", product=0),
    item(SETTLED, "deposit", 400, "PoolDeposit", "-30000000", product=None),
    item(SETTLED, "multi", 300, "PoolDeposit", "-1000000", ix=0, product=0),
    item(SETTLED, "multi", 300, "CoverBought", None, ix=1, product=1),
]
write("activity/full.json", activity(full_items, sig("deposit")))
write("activity/empty.json", activity([], None))
write("activity/partial.json", activity(full_items[:2], sig("deposit"), pending=[sig("buy-cover"), sig("deposit")],
                                       retry="synthetic-retry-token-0001"))
write("activity/throttled.json", activity([], sig("deposit"), pending=[sig("claim-pool"), sig("claim-cover"), sig("buy-cover"), sig("deposit")],
                                         retry=None))
write("activity/refund.json", activity([item(REFUNDING, "refund", 700, "Refund", "13848520", product=None, block=None)], None))

# ---------------- session events ----------------
real_events = load("events-B89z.view.json")
write("events/session-a-page.json", {**real_events, "events": real_events["events"][:10],
                                      "nextBefore": real_events["events"][9]["signature"],
                                      "_note": "First 10 real session A events; nextBefore derived for paging tests."})
tx = sig("two-sessions")
SESSION_B = SETTLED["address"]
two = [
    {"type": "Claimed", "signature": tx, "slot": 1000, "blockTime": 1792890000, "session": SESSION_B, "eventIndex": 0,
     "data": {"owner": OWNER_X, "amounts": ["1000000", "2000000"], "refund": False}},
    {"type": "Claimed", "signature": tx, "slot": 1000, "blockTime": 1792890000, "session": A["address"], "eventIndex": 1,
     "data": {"owner": A_OWNER, "amounts": ["3000000", "4000000"], "refund": False}},
]
write("events/two-sessions-one-tx.raw.json", {"_synthetic": SYN, "transactionEvents": two})
write("events/two-sessions-one-tx.session-a.json", {"_synthetic": SYN, "events": [two[1]], "nextBefore": None,
                                                     "pending": [], "retryCursor": None})
write("events/partial.json", {"_synthetic": SYN, "events": real_events["events"][:3], "nextBefore": sig("older"),
                              "pending": [sig("pending-1"), sig("pending-2")], "retryCursor": "synthetic-retry-token-0002"})
write("events/throttled.json", {"_synthetic": SYN, "events": [], "nextBefore": sig("older"),
                                "pending": [sig("pending-1"), sig("pending-2"), sig("pending-3")], "retryCursor": None})
print("bundle", bundle_id)
