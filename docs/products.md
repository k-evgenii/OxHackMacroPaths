# Product catalogue: what runs, what is designed, what is proposed

Response to the review's "four products, not a catalogue" (25 Oct). The status column is the point of this file: only the first two rows run on the deployed program today.

| Product | Row | Status | Evidence |
|---|---|---|---|
| **Excess Inflation** (product 1) | CPIAUCNS YoY, `x_t` in 1e-4 pp; accumulated excess above K = 4% | **Executable.** Runs on the deployed program; session A settled at 863980 | `docs/deployments.md`, `tests/vectors.json` |
| **Inflation Cooling** (product 0) | same row; largest decline from the running peak | **Executable, labelled a view.** Settled at 827387. A view, not protection: our own backtest finds no forecast that beats history on it (PR #32) | as above; `forecast/backtest.md` on PR #32 |
| **Fuel Pass-through** | GASREGW weekly, monthly mean floored to 1e-4 $ (`month-mean-floor-1e4-v1`); accumulated excess above $3.50 | **Designed, not run.** A one-row v1 session can carry it without a program upgrade, but no fuel session has been created, the keeper builds only the CPI row, and its caps come from `forecast/manifest.py` on `evgenii/integration` | team doc `extension-v2-fuel.md`; `web/public/data/manifest.json` on `evgenii/frontend` |
| **Diesel Surcharge** | GASDESW weekly (FRED from 1994-03-21) | **Proposal.** The series is added to the research fetch list only. No threshold, cap or product definition has been declared, so none is computed | `data/series.toml` on PR `phill/macro-review-research`; `forecast/manifest.json` `proposed_products` (`executable: false`, threshold and cap null), PR #43 |
| **Floating-Loan Rate** | DFF daily (FRED from 1954-07-01) | **Proposal.** In the fetch list already. No threshold, cap or product definition declared. Its monthly mean tracks FEDFUNDS, which the research notebook's "hiking cost" product already uses | `data/series.toml`; `forecast/manifest.json` `proposed_products`, PR #43 |

## Rules for this table

- **"Executable"** means a session can be created, replayed and settled on the program deployed at `FvT786RtMTtbdXWemA9zgA9rfwhvxFsKY1ypiMMNwMbS` with the keeper on `main`. Nothing else may be shown with deposit or cover buttons.
- **Thresholds and caps are declared, never fitted after the fact.** The demo's CPI caps (8 pp, 80 pp-months) were chosen after seeing 2021–24 and are labelled retrospective wherever they appear. The declared pre-2021 p90 rule gives 7.697 pp and 188.18 pp-months.
- **A proposal becomes "designed"** when its row transform, K and cap rule are written down and reproduced by a script. It becomes "executable" when a session has run end to end.

## Dropped

- **The average-of-path ("Asian") product.** The review proposed dropping it. No such product exists in the research code.
- **Series to remove from product lists, per the review's licence and revision note:** MORTGAGE30US, UMCSENT, VIXCLS, DCOILWTICO, BAMLH0A0HYM2, CPILFESL (use CPILFENS), PPIACO and EXPINF1YR.
  - Of the licence reasons, FRED's copyright notices on MORTGAGE30US (Freddie Mac) and VIXCLS (Chicago Board Options Exchange) were checked: "Reprinted with permission". The reasons for the other six were not checked.
  - Only MORTGAGE30US and VIXCLS were registered as products. The research notebook keeps them as research rows and leaves them off the sub-pool menu and the joint simulation (`not_offerable`, research PR #34). The others appear only as research inputs, never as products.
