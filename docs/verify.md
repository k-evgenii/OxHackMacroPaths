# Verifying a MacroPaths session yourself

This is for someone who wants to check, without trusting the team, that the
settled numbers on devnet follow from public CPI data and the rules in
[program-spec.md](program-spec.md) and [commitment-chain.md](commitment-chain.md).
Everything below is integer arithmetic and SHA-256; it runs offline except for
the CPI download and the one account read.

Reference session A: `B89zLLRMtmwAKP5idiUt6ffzfetNo6xRZBbXpDVaBVju` on devnet
(links in [deployments.md](deployments.md)).

## 1. Fetch the data

```bash
pixi install --locked
pixi run fetch
```

This downloads `CPIAUCNS` (US CPI, all urban consumers, not seasonally adjusted)
from `https://fred.stlouisfed.org/graph/fredgraph.csv?id=CPIAUCNS` and writes
`data/snapshots/CPIAUCNS.json`, keeping each level as the exact string FRED
publishes (for example `"257.971"`). The 60 levels from 2020-01 to 2024-12 are
the only data the whole system depends on. You can also download the CSV in a
browser and compare the 60 values by eye.

## 2. Recompute the chain

```bash
pixi run vectors
```

`tests/make_vectors.py` turns the 60 levels into 48 year-on-year values
`x_t = floor(10^6 * (P_t - P_{t-12}) / P_{t-12})` (so `32500` means 3.25%), then
builds the commitment chain exactly as `docs/commitment-chain.md` specifies and
writes `tests/vectors.json`. The last two lines it prints are:

```
dataset_id=328f498b394e988f88f763947e0c656cb0e988321c3f66228c8549946401143e C_0=fdae7619c863f7802333c08e1e66f5ef0001aaae4ad02334b36e6a919d64768a C_N=b5a06c8e2aa10b7fe1339666afb92af7a30cf98e318efde9acdc4a6c5733abef
D=66191 A=691184 827387 863980
```

What those are:

- `dataset_id` is SHA-256 over the series id, source URL, window, transform id,
  the 60 level strings, `N = 48`, the first period `202101`, and the term-sheet
  parameters `K = 40000`, `D_cap = 80000`, `A_cap = 800000`. Change any level by
  one digit and it changes.
- `C_N = SHA256("PATH-END-v1" ‖ dataset_id ‖ u32(48))` is the terminal.
- `C_i = SHA256("PATH-OBS-v1" ‖ dataset_id ‖ u32(i) ‖ u32(period_id_i) ‖ i64(x_i) ‖ C_{i+1})`,
  computed from `i = 47` down to `0`. `C_0` is what the session starts with.

The same values are committed in `tests/vectors.json` under `commitment`
(`dataset_id`, `C_0`, `C_N`) and `chain` (every `C_i` with its preimage). If your
run prints different hashes, FRED has revised a level in the window; `pixi run
fetch --refresh` lists the changed rows.

## 3. Compare with the on-chain Session

The `Session` account (`programs/macropaths/src/state.rs`) stores three 32-byte
fields: `dataset_id`, `commitment` (the current `C_i`, starting at `C_0`) and
`terminal` (`C_N`). `create_session` writes all three. Each `observe(i, period_id,
value, next)` is accepted only if `SHA256("PATH-OBS-v1" ‖ dataset_id ‖ i ‖
period_id ‖ value ‖ next)` equals the stored `commitment`, and then stores `next`.
On row 47 the program also requires `next == terminal`. `settle` refuses unless
`next_index == 48` and `commitment == terminal`. So on a settled session
`commitment` must equal `terminal` must equal your `C_N`.

Read the account:

```bash
solana account B89zLLRMtmwAKP5idiUt6ffzfetNo6xRZBbXpDVaBVju --url devnet --output json
```

The `data` field is base64 Borsh. With the field order in `state.rs` (8-byte
Anchor discriminator, then `authority` 32, `session_id` 8, `play_mint` 32,
`vaults` 64), the three hashes sit at byte offsets 144, 176 and 208:

```bash
solana account B89zLLRMtmwAKP5idiUt6ffzfetNo6xRZBbXpDVaBVju --url devnet --output json \
  | python3 -c 'import sys,json,base64; d=base64.b64decode(json.load(sys.stdin)["account"]["data"][0]);
print("dataset_id", d[144:176].hex()); print("commitment", d[176:208].hex()); print("terminal", d[208:240].hex())'
```

Expected: `dataset_id` = `328f498b…143e`, and both `commitment` and `terminal` =
`b5a06c8e…abef` (the full hex is in step 2). Any Anchor-aware decoder given
`packages/client/idl.json` shows the same fields by name. The `create_session`
transaction's arguments carry `c0`, which should be `fdae7619…768a`. The 48
`observe` transactions, in order, carry `period_id` `202101` … `202412` and the
48 `x_t` values from `tests/vectors.json` `rows`; row 0 is `13997`, row 47 is `28880`.

## 4. Check the scores

`settle` computes, per §1.5 of the spec, `score(stat, cap) = min(stat, cap) * 1_000_000 / cap`
(floor, zero if `stat < 0`). The two path statistics after 48 rows are
`D = 66191` (largest decline of `x` from its running peak, in 1e-4 pp) and
`A = 691184` (sum of `max(x - 40000, 0)`, in 1e-4 pp-months):

```
Cooling:  min(66191,  80000)  * 1000000 / 80000  = 827387   (827387.5 floored)
Excess:   min(691184, 800000) * 1000000 / 800000 = 863980
```

These match `scores` on the Session account and the `final` block of
`tests/vectors.json` (`D`, `A`, `s1`, `s2`). `D` and `A` themselves are in
`running[47]`; you can recompute them by hand from the 48 `x` values with
`peak = max(peak, x)`, `D = max(D, peak - x)`, `A += max(x - 40000, 0)`.

## 5. Worked payout: 33,827,340

`tests/vectors.json` `worked_example`, pinned by the Rust tests. PLAY has 6
decimals, so 10 PLAY = 10,000,000 base units. Per product, side 0 holds 90 PLAY of
seed plus 10 PLAY from one buyer, side 1 holds 100 PLAY, so `M = 100,000,000` and
nothing is refunded (`R = [0, 0]`). From §1.5 `side_budgets`: `P0 = floor(2M * s / 10^6)`,
`P1 = 2M - P0`; a depositor on side `j` receives `floor(a * R_j / S_j) + floor(a * P_j / S_j)`.

```
Cooling (s = 827387):  P0 = 165,477,400  P1 = 34,522,600   buyer = 10e6 * 165,477,400 / 100e6 = 16,547,740
Excess  (s = 863980):  P0 = 172,796,000  P1 = 27,204,000   buyer = 10e6 * 172,796,000 / 100e6 = 17,279,600
Total                                                                                        33,827,340
```

The buyer put in 20,000,000 and takes out 33,827,340 base units (33.82734 PLAY).
The other 400,000,000 - 33,827,340 goes to the seeders by the same formula;
`claim` pays every position from the same `p_budget` and `r_budget`, and the
sum of all claims never exceeds the deposits (§1.9).
