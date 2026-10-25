# Replay mode and live mode

Response to findings 1, 8 and 10 of the external review (25 Oct). It states what the deployed demo proves and what a live contract would need. **Live mode is a proposal; nothing in this file is implemented.**

## What the demo is: a reproducible replay

- **How it works:** Session A on devnet replays US CPI year-on-year inflation for 2021-01..2024-12. Before any deposit, `create_session` stores a reverse hash chain over the 48 rows: `C_N = H("PATH-END-v1" ‖ dataset_id ‖ N)` and `C_i = H("PATH-OBS-v1" ‖ dataset_id ‖ i ‖ period ‖ value ‖ C_{i+1})` (`docs/commitment-chain.md`). Each `observe` must open the stored commitment, and the last must land on the terminal one.
- **What this proves:**
  - Once deposits open, nobody, including us, can change a row.
  - Anyone can post the rows or settle.
  - Anyone can recompute every row from public FRED data and check it.
- **What it cannot do:** it cannot commit to data that does not exist yet. A reverse chain is built from the last row backwards, so it can only seal a path that has already happened. Everyone who has seen 2021–24 knows the outcome. The demo shows the settlement mechanics, not a market on the future.

Say "the replay is reproducible by anyone". Do not say "sealed data" about live use (`docs/pitch-claims.md`).

## What a live contract would need: an attested forward log

1. **A named attester.** Like CME weather futures, which name their settlement agent (Speedwell Settlement Services Ltd.), a live session names who posts each month's value, from which source (BLS CPI-U NSA, first release), and by when (for example, 5 business days after the BLS release).
2. **A forward log** instead of a reverse chain. Each month the attester posts row `i`, and the program extends `C_i = H(C_{i-1} ‖ i ‖ period_i ‖ value_i ‖ salt_i)`.
   - The log is append-only and auditable, and it stops anyone else from writing.
   - `salt_i` matters only if values are committed before they are revealed: the value space is small enough that a bare hash could be guessed.
   - **You trust the attester, not the hash.** The hash cannot tell a correct BLS number from a wrong one; the attester's identity, key and published source can.
3. **Declared fallbacks**, fixed at `create_session`:
   - **Missing source value:** use the declared contingency rule. For CPI, that is Treasury's TIPS contingency index, never replaced afterwards (`docs/commitment-chain.md`, Data rules).
   - **Attester misses its deadline:** the session expires and refunds, as `expire_incomplete` already does for a stalled replay.
   - **Disputed value:** a challenge window before the row is final, if there is a second attester. This is not designed yet.
4. **A dataset id that names the rules**, not only the numbers: series ids, units, vintage rule, revision rule and missing-value rule. This is the v2 `dataset_id` in `docs/commitment-chain.md`. For live data the levels are not known at creation, so the id binds the rules and the log binds the values.

## Precedents to name, carefully

- **Weather degree-day futures (CME)** settle on an index that accumulates daily excess over 65 °F across a calendar month. That is the same accumulated-excess shape as our Excess product, with a named data and settlement agent.
- **On-chain CPI feeds** publish an index level on chain. For example, the Frax Price Index's documentation describes a CPI-tracker oracle that applies monthly CPI-U changes to a peg price. That is a level or a compounded level, not a path statistic. Check the current oracle before naming a provider.
- **Our claim** is "we are not aware of a contract that settles on the path of a macro series on chain". It is not "nobody does this".

## Status

| Piece | Status |
|---|---|
| Reverse-chain replay, permissionless observe and settle, expire/refund | Deployed on devnet; session A settled |
| Missing-value rule and the October 2025 fallback | Declared (`data/series.toml`, Data rules); a fallback vector exists; not used by any session |
| v2 `dataset_id` naming the rules | Proposal |
| Attester, forward log, salt, challenge window | Proposal; needs a program upgrade, none planned for the demo |
