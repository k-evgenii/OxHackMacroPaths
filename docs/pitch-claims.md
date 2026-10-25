# Pitch claims: five we say, five we never say

Every sentence on stage, on Devpost or on a slide must be one of the five below, or be checked the same way. Each "say" line names where its numbers come from.

## Say

1. **"The worst case of the contract is known in advance."**
   - A position can lose at most what it deposited.
   - The score is capped between 0 and 1.
   - Claims are computed with integer floors, so the vault can never pay out more than it holds (`docs/pricing.md`; pot-size tests up to the u64 limit in `programs/macropaths/tests/pot_size.rs`).
   - Do not stretch this to "known loss" for the inflation outcome itself.
2. **"Every month is checked on chain against data committed before anyone deposited, and anyone can post a month or settle."**
   - Session A on devnet replayed 48 rows. Each row opened the hash chain stored at `create_session`.
   - It settled at Cooling 827387 and Excess 863980, equal to `tests/vectors.json`.
   - `observe` and `settle` need no special signer (`docs/deployments.md`).
3. **"The 2021–24 replay is reproducible by anyone from public FRED data."**
   - `dataset_id` binds the 60 CPI levels, the window, the transform, K and both caps (`docs/commitment-chain.md`).
   - Say "reproducible", not "sealed" (see `docs/live-mode.md`).
4. **"Similar start, similar end, different payout."**
   - 2021–24 and 2013–17 both start near 1.4% and end near 2.8% inflation. The endpoints are within 0.08 pp and 0.16 pp.
   - Cooling pays 0.827 against 0.291, and Excess 0.864 against 0.
   - A contract on the end value cannot tell them apart (`docs/twin-windows.md`, PR #33). Add "on caps chosen after 2021–24" if asked about the caps.
5. **"We tested our own forecast out of sample, and it changed what we offer."**
   - **Excess:** AR(1) beat history in the main test and in 3 of 4 variants.
   - **Cooling:** history won the main test, AR(1) was poorly calibrated, and the result did not hold across variants. So Cooling is offered as a view, not priced as protection.
   - About 14 independent four-year periods underlie this (PR #32 `forecast/backtest.md`).

Optional access line, if time allows: **"Access at small size for anyone with a wallet, accepting a fixed four-year term and US-average basis risk."**

## Never say

1. **"The data is sealed" or "tamper-proof", about the future.**
   - The reverse chain can only commit a path that already happened. It proves the replay, not live data.
   - A live contract trusts a named attester (`docs/live-mode.md`).
2. **"Same endpoints", "within 0.15 pp", or "the closest match in history", about 2013–17.**
   - The end gap is 0.1501 pp.
   - 2013–17 ranks 9th by endpoint distance, and 2nd among separate episodes. 1962–66 is closer (PR #33).
3. **"Our model predicts inflation", "the quote is fair", or "the seller makes money".**
   - The forecast is advisory and settlement uses only the realised path.
   - The quote is a declared policy, `p = clamp(V0 + 0.5·σ0, 0.05, 0.95)`.
   - The backtest's positive seller results come from a forecast that runs high, on about 14 independent periods.
   - The 11-origin walk-forward cannot validate a 10% tail (`forecast/walkforward.md`).
4. **"Nobody settles a path on chain."**
   - We have not checked every protocol.
   - Say "we are not aware of a contract that settles on the path of a macro series on chain", and name the precedents we do know: weather degree-day futures settle on accumulated excess, and on-chain CPI feeds publish the level (`docs/live-mode.md`).
5. **"Fuel, diesel and loan-rate cover are live", or "the caps were set before 2021".**
   - Only the CPI session runs (`docs/products.md`).
   - The demo caps 8 pp and 80 pp-months were chosen after seeing 2021–24. The declared pre-2021 rule gives 7.697 pp and 188.31 pp-months, under which Excess pays 0.367.

Wording rules from the repo stay in force: "forecast", "position" and "cover". Never "fair value", "bet", "option" or "insurance".
