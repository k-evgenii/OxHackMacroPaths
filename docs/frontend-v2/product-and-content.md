# Product and content specification

## Audience and success

The primary user is exploring seller-backed covers. Their wallet may also own pool positions, which must remain visible as a distinct mechanism. Success is understanding what determines payout, seeing personal amounts and status, and distinguishing the historical demonstration from research.

Prioritize these questions: what does it pay for; which session is this; what did I pay; what can I receive; what remains uncovered; where can I verify it?

This release connects wallets and reads data. It does not execute a transaction. A valid seller offer can be described, but a purchase button must not imply that buying is implemented.

## Meaning of the numbers

| Data | User-facing meaning | Avoid |
| --- | --- | --- |
| `path.value` | Monthly CPI year-on-year reading, with observation month | Calling the final 2024 reading today's inflation |
| Cooling score | Largest decline divided by that session's cap, capped at 100% | Probability, yield, or return |
| Excess score | Accumulated monthly excess divided by that session's cap | Percentage of the user's bill covered |
| `sideTotals` sum | Historical pool contributions | Calling it current locked/vault value after claims |
| Vault token balances | Current tokens held in the two vault accounts | Reconstructing them from historical deposits |
| `CoverView.units` | Maximum cover payout in PLAY base units | Treating units as premium paid |
| `premiumPaid` | Buyer expenditure | Including seller-funded escrow in buyer expenditure |
| Pool deposit | Stake allocated to More/Less sides | Applying seller quote math to its payout |
| Research quote | Model reference price | A verified on-chain offer |
| `integrityOk` | Completed replay chain matches its terminal | Showing an alarming failure badge during normal incomplete replay |

Scores are payout factors for covers; pool positions follow side budgets. More means the side benefiting from a larger score for that product. Less benefits from a smaller score. Never substitute Protection/Counterparty as side labels.

## Dashboard

Disconnected: heading, historical replay/devnet/test PLAY context, two CPI product cards, session preview, Connect wallet and Explore session. Lead with Excess Inflation, then Inflation Cooling.

Connected: PLAY balance; unclaimed payout/refund where known; covers first; pool positions second; a replay sparkline and last reading; recent personal activity. Keep different mints separate. No fiat conversion or invented portfolio valuation.

Each holding shows its session, product, premium or deposit, amount determined so far, and claim state. Do not show the reference fixture owner's holding as the connected user's holding.

## Session

One page at `/session/[addr]`; no client Summary/Path/Results/Seller tabs. Header contains human title, historical date range and state. The hero is the inflation path with threshold shading. The three headline numbers are last replay reading and both product scores. State/progress uses a pill and a progress line.

Below the hero: Your covers; Your pool positions; currently held in vaults; total pool deposited; the four-side composition; replay progress. Terms and a concise calculation explanation are expandable. Source/methodology explanations remain available to users even though raw hashes move to developer tooling.

Reference session A uses caps `80000` and `800000`. Its scores are `827387` and `863980`. Show approximately 82.7% and 86.4%, not the p90 research bundle's 86.0% and 36.7%. Display 9.06% peak in Jun 2022, 6.62 percentage-point decline, and 69.1 point-months above 4%. Its pool contributions sum to 380 PLAY. Read actual fixture values instead of recreating raw readings from the rounded prose list.

## State-dependent holding copy

| State | Amount label | Rule |
| --- | --- | --- |
| Open, no readings | Not determined yet | No invented forecast or zero payout |
| Running | Accrued payout illustration | Calculate using the recorded path; add "illustration until settlement" |
| Settled, unclaimed | Final payout | Use authoritative view payout |
| Refunding, unclaimed | Refund available | Deposits for pool positions; premiums for covers |
| Claimed | Claimed / Refunded | Keep history, exclude from available-to-claim totals |

Final amounts are not labelled illustrations. Running amounts are not called expected final returns. Claim/purchase/faucet execution is unavailable with a visible explanation. Avoid dead buttons that look ready to act.

## Activity

`/activity` has My activity and Market controls. My activity has an action icon, title, session/product context, actual timestamp, signed PLAY amount and Explorer link. Titles: Cover purchased, Pool deposit, Cover payout, Pool payout, Refund. Group real timestamps by Today/Yesterday/date in browser timezone. Unknown timestamps go under Date unavailable. Amount `null` means Amount unavailable, not zero.

Market activity comes from `SessionView.path` and session state, requiring no transaction-hydration calls. A historical observation month is not its posting timestamp. Group observations by historical month/year and show completion/settlement as state facts without fabricated transaction links or times.

Loading older signatures can yield no recognized actions but still have another page. Partial recovery never discards already displayed rows or pending older pages.

## Products and Planner

Excess Inflation: "Pays according to how far and how long inflation stays above the session's threshold."

Inflation Cooling: "Pays according to the largest decline in inflation from an earlier peak." Describe it as a view rather than promising it matches a particular bill.

Fuel: "Research illustration of a contract linked more directly to a gasoline bill." It remains Research for this release regardless of newer deployment proposals.

Offer prices are PLAY per unit of maximum cover payout; for example a raw price of `57153` is 0.057153 PLAY per 1 PLAY maximum payout. This example is not a live quote. Never present a price as a chance of success. If a verified on-chain offer is absent/closed, say so instead of substituting a model price.

The Planner leads with one recommendation sentence, then residual shortfall and cash-only comparison. Its chart compares budget allocation against historical shortfall, not an invented time series. A disclosure exposes all 21 comparisons. Show expected end-of-period cash alongside the tail metric because the ranking objective does not penalize every wasted premium in calm periods.

Inputs/results are illustrative USD research amounts. State: "Research calculations use illustrative USD amounts. Devnet holdings use PLAY; no conversion rate is assumed." Defaults are derived from the selected bundle; the inspected bundle recommends Fuel stake 40 for 100 gallons/month and budget 200, leaving approximately 199.55 in the 2021–24 showcase versus approximately 528.33 for cash alone. Do not hardcode those outputs.

Explain that historical windows overlap, the sample is not a calibrated future probability, and a payout cap can leave a bill uncovered. Never present zero historical tail shortfall as guaranteed protection.

## Developer content

Hide raw account addresses, slot counters, hashes, dataset IDs, P/R budgets, matched totals, account counters, raw integers, fit coefficients and API JSON in `/dev`. Keep client source links and understandable terms accessible. A source period and a transaction date must always remain distinguishable.

## Scope boundaries

Two CPI products and Fuel Research only. No new catalogue, live-attestation implementation, program upgrade, keeper modification, model rewrite, or transaction execution. The replay commitment establishes reproducibility of the historical replay; it is not a guarantee about future observations.
