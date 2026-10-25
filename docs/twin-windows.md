# Twin windows: what the comparison shows, and what it does not

The pitch compares the on-chain window **2021-01..2024-12** (session A) with **2013-03..2017-02**: similar start and end inflation, very different path, very different payout. This note fixes the wording and records how the claim was checked. Every number below comes from `tests/twin-windows.json`, which `tests/twin_check.py` generates from the frozen CPIAUCNS snapshot and `tests/test_twin_windows.py` re-checks.

## What the windows are

The two windows have **similar** endpoints. They are **not identical**, and 2013-03 is **not the closest possible match**.

| | 2021-01..2024-12 (on chain) | 2013-03..2017-02 | 1962-05..1966-04 (closest) |
|---|---|---|---|
| start YoY, x_0 | 13997 (1.3997 %) | 14738 (1.4738 %) | 13422 (1.3422 %) |
| end YoY, x_47 | 28880 (2.8880 %) | 27379 (2.7379 %) | 28662 (2.8662 %) |
| start gap to reference | | +0.0741 pp | -0.0575 pp |
| end gap to reference | | -0.1501 pp | -0.0218 pp |
| peak M | 90597 | 27379 | 28662 |
| Cooling D / score (cap 80000) | 66191 / 827387 | 23267 / 290837 | 6739 / 84237 |
| Excess A / score (cap 800000, K = 40000) | 691184 / 863980 | 0 / 0 | 0 / 0 |

x, M, D are in 1e-4 percentage points, A in 1e-4 pp-months, scores in millionths. The per-month series (x, M, D, A) for all three windows is in the fixture, ready for the path chart. The reference row reproduces `tests/vectors.json` (D=66191, A=691184, 827387, 863980); the script asserts this by reading that file.

The 1962-06 start has the same endpoints, D and A as 1962-05 (same x_0 = 13422 and x_47 = 28662, because the levels are published to one decimal). The two tie for closest.

## How "similar" was measured

- **Distance (primary): Chebyshev**, `max(|x_start - x_start_ref|, |x_end - x_end_ref|)`, on the contract's floored x (`make_vectors.yoy`), so it is an integer in 1e-4 pp. L1 (sum) and squared L2 are reported as cross-checks.
- **Candidate set:** every 48-month window whose 60 levels are all present, **excluding windows whose 48 observation months overlap 2021-01..2024-12** (starts 2017-02..2024-12, the reference itself included). That leaves 1237 candidates. The empty FRED value for 2025-10 is never used.
- **Tie rule:** the ordinal rank sorts by (distance, start month), so ties go to the earlier start. The competition rank (1 + the number of strictly closer candidates) is also recorded; for 2013-03 the two agree because nothing ties with it.
- **De-duplicated rank:** walk the candidates in that order and keep a window only if its observation months do not overlap one already kept.

Results for 2013-03 (distance 1501 in 1e-4 pp, 0.1501 pp):

- **Ninth of 1237** by Chebyshev, and also ninth by L1 and by squared L2.
- Eleventh if windows overlapping the reference are allowed as candidates (2020-08 and 2020-12 come in ahead of it).
- **Second after de-duplication.** The eight windows ahead of it are starts 1962-05 to 1963-10, which are overlapping views of one episode; once 1962-05 is kept they are all dropped. The third kept window is 1954-01 (distance 2719). Breaking the 1962-05 / 1962-06 tie the other way leaves 2013-03 second.

So "ninth" understates how distinct 2013-03 is among separate episodes, and "within 0.15 pp" overstates how close it is. Say neither as a headline.

## Why 2013-17 is still the main comparison

- It is recent and familiar to the audience.
- It has the same CPI precision as 2021-24. Levels in the snapshot carry three decimals from 2007-01 on; before that every level has one significant decimal (the stored last two decimals are always 0). Both 2013-17 and 2021-24 are three-decimal windows; **1962-66 is not**.
- The precision matters for the closest match. A one-decimal index moves YoY by about 0.32 to 0.34 pp per tick near 1962-66 (0.3356 pp at the start, 0.3185 pp at the end), against about 0.0003 to 0.0004 pp per tick in 2013-17 and 2021-24. A close endpoint match on that coarse grid carries less weight than the same distance in a three-decimal window.

The fixture includes 1962-66 (and notes the 1962-06 tie) so the closest historical match is disclosed rather than hidden. Its payout is smaller still: Cooling 84237, Excess 0.

## What to say instead of "within 0.15 pp"

On the contract values the end gap is 0.1501 pp, so the strict statement "endpoints within 0.15 pp" is **false** (start 0.0741 pp apart, end 0.1501 pp apart). On the exact, unrounded YoY it is still false, only just: the end gap is 1819521950/12122141801 pp, about 0.150099 pp, which rounds to 0.1501.

Use: **"similar endpoints: the start is within 0.08 pp and the end within 0.16 pp (0.0741 pp and 0.1501 pp apart on the contract values)"**, or simply "both endpoints within 0.16 pp".

## Caveat: the caps are retrospective

The caps (8 pp for Cooling, 80 pp-months for Excess) were chosen after the 2021-24 outcome was known. The scores for 2021-24 therefore say how the products read that path once the caps were set, not how a forecast made before 2021 would have fared. The 2013-17 and 1962-66 scores are computed with the same caps and K = 4 %, with no refit.

## Reproduce

```bash
pixi install --locked
pixi run fetch                                   # only if data/snapshots/CPIAUCNS.json is absent; the snapshot is frozen and gitignored
pixi run python tests/twin_check.py              # writes tests/twin-windows.json, prints a one-line summary
pixi run python tests/twin_check.py --check      # recompute and diff against the committed file; exit 1 on mismatch
pixi run pytest tests/test_twin_windows.py -q    # skips with a reason if the snapshot is absent
```

The script refuses to run if the reference, the comparison window, the closest match, or any window that would otherwise be a candidate needs a missing level, or if the months are not contiguous. A re-fetch that leaves the levels unchanged keeps the committed snapshot provenance, as `make_vectors.py` does for `vectors.json`; a re-fetch that adds or changes months changes the input-levels hash and the fixture must be regenerated and reviewed.

## Dataset provenance

- Series: FRED CPIAUCNS, index 1982-1984 = 100, not seasonally adjusted.
- Source: `https://fred.stlouisfed.org/graph/fredgraph.csv?id=CPIAUCNS`
- Snapshot: `data/snapshots/CPIAUCNS.json` (gitignored), retrieved 2026-10-24T16:25:32Z.
- `sha256_of_raw`: `cfab9b9be4a5d4f06253c4dcc3f7e0b28b1d58837e710dd7cb1fd54a49e7ad7c`.
- SHA-256 of the snapshot file: `8caae39af6be41fe2d129abdd898d4033752b794418cba1765155fe3c304f266`.
- The snapshot has an empty value for 2025-10; no window used here touches it.
- Maths: `tests/make_vectors.py` at commit `108afbf29395e6809ce8b78e3fc33339e32e4d03`, imported by `tests/twin_check.py`.

## Checked claims

`tests/test_twin_windows.py` compares every row of this table with the fixture.

| claim | value |
|---|---|
| `comparison_window` | 2013-03..2017-02 |
| `reference_window` | 2021-01..2024-12 |
| `within_0_15_pp_contract_floored` | false |
| `within_0_15_pp_exact_unrounded` | false |
| `start_gap_pp_contract_floored` | 0.0741 |
| `end_gap_pp_contract_floored` | 0.1501 |
| `max_endpoint_gap_pp_contract_floored` | 0.1501 |
| `max_endpoint_gap_pp_exact_unrounded` | 0.1501 |
| `candidates` | 1237 |
| `chebyshev_distance_x` | 1501 |
| `rank_chebyshev_ordinal` | 9 |
| `rank_chebyshev_competition` | 9 |
| `rank_l1_ordinal` | 9 |
| `rank_l2_ordinal` | 9 |
| `rank_chebyshev_deduplicated` | 2 |
| `rank_if_overlapping_windows_were_candidates` | 11 |
| `closest_start` | 1962-05 |
| `closest_chebyshev_distance_x` | 575 |
| `closest_tied_with` | 1962-06 |
| `reference_cooling_D_and_score` | 66191 / 827387 |
| `reference_excess_A_and_score` | 691184 / 863980 |
| `comparison_cooling_D_and_score` | 23267 / 290837 |
| `comparison_excess_A_and_score` | 0 / 0 |
| `closest_cooling_D_and_score` | 6739 / 84237 |
| `closest_excess_A_and_score` | 0 / 0 |
