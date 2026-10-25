# Security review

Reviewed on `agent/11-security` at base `0edeefe` (`cursor_main`, including 01b). Before any edit, the only open pull request into `cursor_main` was #23 (01b, already merged as `20667a9`). There were no GitHub issues. PR #7 is Dev's layout pull request into `main`, not a fix in progress here. This review did not touch padding or the `u32` row index.

Fix commit: `25cadea` (`sec: bind seller_fund's mint to the session`).

Re-reviewed by Dev at `41d108a` (`cursor_main`, 25 Oct 2026). Since base `0edeefe`: `c4312f0` lock deadline, #28 cover handlers (agent 13), #29 terminal lockup fix, #31 `set_entry_quote` deadline, #14 keeper bridge (no program change). Line numbers below are from `programs/macropaths/src/instructions/*.rs` at `41d108a`.

## Pattern coverage

| # | Pattern | Verdict | Evidence |
| --- | --- | --- | --- |
| 1 | Arbitrary CPI | clear | No `invoke` or `invoke_signed`. `deposit`, `claim`, `sweep_dust`, `seller_fund`, `buy_cover`, `claim_cover`, `seller_settle`, and `seller_withdraw` call `anchor_spl::token::transfer` with `CpiContext::new(token::ID)` or `new_with_signer(token::ID, ...)`. Every token account struct declares `token_program: Program<'info, Token>`. Each of those eight handlers also `require`s that key equals `token::ID` before any transfer (seller_fund.rs L63, buy_cover.rs L56, claim_cover.rs L33, seller_settle.rs L36, seller_withdraw.rs L32). |
| 2 | Improper PDA validation | clear | `create_session`, the vaults, `deposit`'s position, `seller_fund`, `set_entry_quote`, and `buy_cover`'s cover use `seeds` plus canonical `bump`. `claim`, `sweep_dust`, `buy_cover`, `claim_cover`, `seller_settle`, and `seller_withdraw` re-derive the session with `create_program_address` and the bump stored at that init before they sign. `Seller`, `EntryQuote`, and `Cover` store `ctx.bumps` at first init (seller_fund.rs L73-74, set_entry_quote.rs L47, buy_cover.rs L150-154), and later instructions use `bump = account.bump`. No instruction takes a bump argument. |
| 3 | Missing ownership check | clear | Sessions, positions, sellers, quotes, and covers are `Account<'info, T>`. Token accounts are `Account<'info, TokenAccount>`. Mints are `Account<'info, Mint>`. No `UncheckedAccount` and no `try_from_slice`. |
| 4 | Missing signer check | clear | `authority`, `owner`, `buyer`, and `seller_wallet` are `Signer`. `lock_and_start`, `sweep_dust`, and `set_entry_quote` use `has_one = authority`. `claim` and `claim_cover` use `has_one = owner`. `seller_fund` binds a returning seller with `seller.seller == seller_wallet` (`WrongSeller`, seller_fund.rs L76-79); the first funder becomes the seller. `seller_withdraw` requires `seller.seller == seller_wallet` as an account constraint (seller_withdraw.rs L17). |
| 5 | Sysvar account check | clear | `now` comes from `Clock::get()`. `create_session` takes `Sysvar<'info, Rent>`. The lockfile resolves `solana-clock` 3.2.1, which is past the 1.8.1 sysvar-address fix. No instruction accepts a raw sysvar account from the caller. |
| 6 | Improper instruction introspection | n/a | No `load_instruction_at`, `load_current_index`, or `get_instruction_relative`. |

## Instruction matrix

Handler is `live` or `pending (wave 3)`. Other cells are ✔, ✘, or n/a. All fourteen handlers are live at `41d108a`.

| Instruction | Handler | PDA seeds and bump | Owner | Mint | Token program | Signer / has_one | State before transfer | Deadline | Arithmetic | init_if_needed | Distinct accounts | Permissionless forward-only | CPI is SPL token only |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| create_session | live | ✔ | ✔ | ✔ | ✔ | ✔ | n/a | ✔ | ✔ | n/a | ✔ | n/a | ✔ |
| deposit | live | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | n/a | ✔ |
| lock_and_start | live | n/a | ✔ | n/a | n/a | ✔ | ✔ | ✔ | ✔ | n/a | n/a | n/a | n/a |
| observe | live | n/a | ✔ | n/a | n/a | n/a | ✔ | ✔ | ✔ | n/a | n/a | ✔ | n/a |
| settle | live | n/a | ✔ | n/a | n/a | n/a | ✔ | n/a | ✔ | n/a | n/a | ✔ | n/a |
| claim | live | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | n/a | ✔ | n/a | ✔ | n/a | ✔ |
| expire_incomplete | live | n/a | ✔ | n/a | n/a | n/a | ✔ | ✔ | ✔ | n/a | n/a | ✔ | n/a |
| sweep_dust | live | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | n/a | ✔ | n/a | ✔ | n/a | ✔ |
| seller_fund | live | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | n/a | ✔ |
| set_entry_quote | live | ✔ | ✔ | n/a | n/a | ✔ | ✔ | ✔ | n/a | ✔ | n/a | n/a | n/a |
| buy_cover | live | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | n/a | ✔ |
| claim_cover | live | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | n/a | ✔ | n/a | ✔ | n/a | ✔ |
| seller_settle | live | ✔ | ✔ | ✔ | ✔ | n/a | ✔ | n/a | ✔ | n/a | ✔ | ✔ | ✔ |
| seller_withdraw | live | ✔ | ✔ | ✔ | ✔ | ✔ | n/a | n/a | ✔ | n/a | ✔ | n/a | ✔ |

Notes on cells that are easy to misread:

- **deposit / lock / observe / settle / expire PDA.** Those instructions do not sign for the session. The session is `Account<'info, Session>`, so it is owned by this program, and the only creator is `create_session`'s canonical `init`. Vault pubkeys are checked against `session.vaults`, which that init wrote from the vault PDAs.
- **claim / sweep / buy_cover / claim_cover / seller_settle / seller_withdraw PDA.** `require_session_pda` runs before the signed transfer (buy_cover.rs L98, claim_cover.rs L61, seller_settle.rs L57, seller_withdraw.rs L56). It uses the bump stored at canonical init.
- **Distinct accounts.** `deposit`, `claim`, `sweep_dust`, and `claim_cover` reject `vault_0 == vault_1` (claim_cover.rs L37-40). Passing the same token account as `owner_ta` and a vault is `ConstraintDuplicateMutableAccount` (2040) under Anchor 1.0.2. `security_deposit_owner_ta_is_vault` and `security_claim_owner_ta_is_vault` pin that. In the wave 3 handlers every wallet-side token account must be owned by the signer and every program-side one by the session (seller_fund.rs L59-62, buy_cover.rs L81-97, seller_withdraw.rs L44-55), so a wallet account cannot stand in for `seller_ta` or a vault; `seller_ta` and the vaults are PDAs with different seeds and are all `mut`, so the same account in two slots is 2040.
- **Deadline.** The spec does not put a deadline on `settle`, `claim`, `claim_cover`, `seller_settle`, `seller_withdraw`, or `sweep_dust`. `deposit`, `lock_and_start` (`c4312f0`, lock_and_start.rs L17), `seller_fund` (seller_fund.rs L46-49), `set_entry_quote` (#31, set_entry_quote.rs L30-33), and `buy_cover` (buy_cover.rs L67-70) use `now <= deposit_deadline`. `observe` uses `now <= replay_deadline`. `expire_incomplete` is the deadline instruction.
- **Wave 3 state cells.** At base `0edeefe` the six wave 3 handlers were empty and these cells were n/a. They are live since #28 (agent 13) and #31. `seller_fund` (L42-45), `set_entry_quote` (L25-28), and `buy_cover` (L63-66) require `Open`. `claim_cover` (L63-67) and `seller_settle` (L59-63) accept `Settled` or `Refunding` and reject everything else with `WrongState`; `claim_cover` also rejects a second claim with `AlreadyClaimed` (L68). Wallet mint and owner are checked in the handler before any transfer (seller_fund.rs L55-62, buy_cover.rs L77-97, claim_cover.rs L45-60, seller_settle.rs L44-56, seller_withdraw.rs L40-55).
- **seller_withdraw state n/a.** The spec puts no session-state gate on withdrawal. The gate is `seller.escrow == [0, 0]` (`SellerEscrowOutstanding`, seller_withdraw.rs L58-61) plus `amount <= free_cash` (L63-66), so sold cover stays escrowed until `seller_settle` releases it.
- **Permissionless forward-only.** `observe` is ✔ after #29: the last row must land on `terminal` (observe.rs L48-53), so a chain cannot end Running with a wrong commitment. `seller_settle` has no signer; it is forward-only through `seller.settled[product]` (`AlreadySettled`, seller_settle.rs L65-68) and pays each product once.
- **seller_fund mint** is ✔ only after `25cadea`.

## Attack tests

All of these are in `programs/macropaths/tests/security.rs`. Anchor constraint failures are matched by numeric code (`ConstraintHasOne` 2001, `ConstraintRaw` 2003, `ConstraintSeeds` 2006, `ConstraintDuplicateMutableAccount` 2040). `AccountNotInitialized` is 3012; none of these attacks hit it.

| Test | Result |
| --- | --- |
| `security_deposit_vault_1_in_vault_0` | rejected, 2003 |
| `security_claim_vault_1_in_vault_0` | rejected, 2003 |
| `security_claim_other_session_position` | rejected, 2006 |
| `security_claim_foreign_token_account` | `WrongOwner` |
| `security_deposit_wrong_mint` | `WrongMint` |
| `security_deposit_past_deadline` | `PastDeadline` |
| `security_deposit_owner_ta_is_vault` | rejected, 2040 |
| `security_observe_valid_hash_while_open` | `WrongState` on Open; the same row is accepted on Running |
| `security_lock_non_authority` | rejected, 2001 |
| `security_sweep_non_authority` | rejected, 2001 |
| `security_sweep_before_all_claimed` | `NotAllClaimed` |
| `security_settle_complete_index_wrong_terminal` | `ChainIncomplete` |
| `security_create_session_same_id_after_expire_blockhash` | second `init` fails, session bytes unchanged |
| `security_claim_twice_after_expire_blockhash` | `AlreadyClaimed`, payout not repeated |
| `security_claim_owner_ta_is_vault` | rejected, 2040 |
| `security_seller_fund_wrong_mint` | `WrongMint` after the fix; the seller accounts are not created |
| `security_set_entry_quote_past_deadline` | `PastDeadline` at `deadline + 1` on an existing quote (bytes unchanged) and on a fresh one (quote PDA not created); the quote at `deadline` itself is accepted |

The wave 3 handlers also have their own suites in `tests/cover.rs` and `tests/seller_accounts.rs`, and the #29 refund path is in `tests/terminal_lockup.rs`.

`cargo test -p macropaths` at `41d108a`: 117 passed (Dev's build, 25 Oct 2026).

## Arithmetic pass

Searched `programs/macropaths/src/instructions/` for `as u64`, `as i64`, `as u32`, and for `+`, `-`, `*` on amounts.

- No `as u64`, `as i64`, or `as u32`.
- `create_session`: `N_OBS as usize` widens the `u32` constant into the `[i64; 48]` array length. `N_OBS` is 48.
- `observe`: `index as usize` is reached only after `index < n_obs` and `index < values.len()`. Widening, then bounded by the array.
- `buy_cover` and `seller_settle`: `usize::from(product)` is an infallible `u8` conversion, used only to index `session.vaults`, `quote.p`, and the `[_; 2]` seller and cover arrays, and only after `product < 2` (`InvalidProduct`, buy_cover.rs L60, seller_settle.rs L40).
- Token amounts use `checked_add`, `checked_sub`, or `math::*` (`cover_split`, `cover_claim`), and `None` maps to `MathOverflow`. `seller_settle` computes the seller's share as `n_sold.checked_sub(owed)` (L76). `lock_and_start` uses `min` only.

## Findings

### High — seller token account can be created for the wrong mint

**File:** `programs/macropaths/src/instructions/seller_fund.rs` (the `play_mint` constraint).

**Fix:** `25cadea`.

`seller_ta` is `init_if_needed` with `token::mint = play_mint` in the account struct. The handler was empty when this was found, but Anchor still initialized the account. `play_mint` was any mint. One seller token account exists per session, so the first caller chose its mint forever. `security_seller_fund_wrong_mint` observed `InitializeAccount3` succeeding before the fix. The constraint `play_mint.key() == session.play_mint` (now seller_fund.rs L33) rejects that with `WrongMint`, and neither the seller account nor the seller token account is created. The live handler also checks `seller_wallet_ta.mint` against the session (L55-58).

### High — terminal lockup: deposits locked forever if `terminal` is not the chain's real C_N

**Files:** `programs/macropaths/src/instructions/observe.rs`, `expire_incomplete.rs`. Reported by a teammate in review after this report. Fixed on `phill/terminal-lockup`.

`create_session` stores any `terminal`. `observe` checked each row only against the current commitment, so all 48 rows landed and the last `next_commitment` (the chain's real C_48) became `commitment` even when it differed from `terminal`. Then `settle` failed with `ChainIncomplete`, and `expire_incomplete` failed with `NotExpired` because it required `next_index < n_obs`. No instruction could leave Running, so `claim` stayed `WrongState` and every deposit was locked. This was reproduced on Surfpool against `3942c14`: after 48 rows and time travel past `replay_deadline`, `settle` gave 6011, `expire` gave 6013, `claim` gave 6002, and 380 PLAY stayed in the vaults. `security_settle_complete_index_wrong_terminal` covered the `ChainIncomplete` error but not the missing refund path.

**Fix:**
1. `observe` requires `next_commitment == terminal` on the last row (`BadCommitment`), so the stuck state can't be reached.
2. `expire_incomplete` refunds any Running session past `replay_deadline` unless `next_index == n_obs && commitment == terminal`. This backstop also frees a session already stuck.

**Tests:** `tests/terminal_lockup.rs`:
- last row rejected → expire → claim refunds every deposit;
- stuck state expires after the deadline;
- an honest session still settles to 827387 / 863980 and can't be expired.

`lock_expire_running_complete_not_expired` now sets `commitment = terminal`, so its fixture is truly complete.

**Not done:** `create_session` could also require `terminal == chain::end_hash(dataset_id, N)`. It isn't needed for funds safety after fix 1, and was left out as a new create rule shortly before the freeze (see `docs/DECISIONS.md`).

### Low — `set_entry_quote` had no deadline

**File:** `programs/macropaths/src/instructions/set_entry_quote.rs`.

**Fix:** `0f73c0e`, merged as #31.

The state table (§1.7) allows a quote only while deposits are open, but the handler checked `Open` and nothing else. Because `lock_and_start` is authority-only and not forced, a session could sit Open past `deposit_deadline` and the authority could still write or rewrite the quote until the first cover froze it. The handler now requires `now <= deposit_deadline` (L30-33) before the range and frozen checks. `security_set_entry_quote_past_deadline` pins it on an existing quote and on a fresh one.

### Open, medium — cover price is set unilaterally by the authority (design, issue #30)

**Files:** `programs/macropaths/src/instructions/set_entry_quote.rs`, `buy_cover.rs`.

`buy_cover` takes `product` and `units` and no `max_price`; the buyer pays whatever `quote.p[product]` says at execution (buy_cover.rs L100-102). `seller_fund` takes no `min_price`, so the seller's escrow is committed at any quote the authority later sets. The quote freezes only on the first buy (buy_cover.rs L168), so before that the authority can `set_entry_quote` and `buy_cover` in one transaction and reprice against either side. This is a product rule, not a funds-safety bug: the authority already controls the session, and the frozen quote means every buyer in a session pays the same price. Fix is a `max_price` argument on `buy_cover`, a `min_price` on `seller_fund` or a seller signature on the quote, or freezing the quote at `set_entry_quote`. Post-hackathon; tracked in #30.

### Open, low — three small gaps (issue #30)

- **Dust grief via cover.** `sweep_dust` requires `cover_claimed_count == cover_count` (sweep_dust.rs L61-64). A 1-unit cover bought from a throwaway key and never claimed blocks the sweep, the same class as a 1-unit `Position` that is never claimed. Same mitigation as positions: a claim-on-behalf path or a time-based override, neither in the spec.
- **`seller_withdraw` has no state gate.** By spec. The `escrow == [0, 0]` check means withdrawal cannot touch escrowed cover; it is noted here so nobody reads the n/a cell as an omission.
- **No events on `claim_cover`, `seller_settle`, or `seller_withdraw`.** `observe`, `settle`, `claim`, and `buy_cover` emit; the three wave 3 payout paths do not, so the keeper and indexer reconstruct them from account diffs.

## Deliberately not changed

- `state.rs`, `math.rs`, `chain.rs`, `constants.rs`, `common/mod.rs`, and other agents' tests.
- `Session::signer_seeds` stays in `state.rs`. The crate asserts a little-endian target, the returned slices borrow `self`, and the bytes are the authority, the little-endian `session_id`, and the stored bump. `claim`, `sweep_dust`, `buy_cover`, `claim_cover`, `seller_settle`, and `seller_withdraw` check that those seeds derive the session before signing.
- `math::step_cooling` still `expect`s when `new_peak - x` does not fit in `i64`. That aborts the one `observe` and does not advance `next_index`, so `expire_incomplete` can still move the session to Refunding. The published series does not reach it. Closing it means changing `math.rs`, which this brief does not own.
- `create_session` still accepts whatever mint the authority passes, including one whose freeze authority is set. The spec's checks are `d_cap > 0`, `a_cap > 0`, and `now < deposit_deadline < replay_deadline`. Rejecting freeze authority would be a new product rule.
- `lock_and_start` was not deadline-gated at `0edeefe`, so after `deposit_deadline` it and `expire_incomplete` could both succeed and whichever landed first won. `c4312f0` added `now <= deposit_deadline` (lock_and_start.rs L17); the race is closed.
- Wave 3 handlers were empty at `0edeefe` and are live at `41d108a`. They enforce the spec's state and deadline checks and the wallet mint and owner checks before any transfer, and they store the canonical bump from `ctx.bumps` on `Seller` (seller_fund.rs L73-74), `EntryQuote` (set_entry_quote.rs L47), and `Cover` (buy_cover.rs L150-154). `buy_cover`, `seller_settle`, `seller_withdraw`, and `claim_cover` validate `bump = stored`. A zero bump fails closed. A handler that stored a non-canonical bump would be pattern 2; nothing does that.
- `seller_settle` enforces "forward only" through `seller.settled[product]` (seller_settle.rs L65-68, L98). It does not move the session state; `settle` and `expire_incomplete` own that.

## Countersign

Countersigned by Dev: @daveck11 (2026-10-25), at 41d108a. Open items tracked in #30.
