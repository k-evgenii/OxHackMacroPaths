# Security review

Reviewed on `agent/11-security` at base `0edeefe` (`cursor_main`, including 01b). Before any edit, the only open pull request into `cursor_main` was #23 (01b, already merged as `20667a9`). There were no GitHub issues. PR #7 is Dev's layout pull request into `main`, not a fix in progress here. This review did not touch padding or the `u32` row index.

Fix commit: `25cadea` (`sec: bind seller_fund's mint to the session`).

## Pattern coverage

| # | Pattern | Verdict | Evidence |
| --- | --- | --- | --- |
| 1 | Arbitrary CPI | clear | No `invoke` or `invoke_signed`. `deposit`, `claim`, and `sweep_dust` call `anchor_spl::token::transfer` with `CpiContext::new(token::ID)` or `new_with_signer(token::ID, ...)`. Every token account struct declares `token_program: Program<'info, Token>`. `deposit`, `claim`, and `sweep_dust` also `require` that key equals `token::ID`. |
| 2 | Improper PDA validation | clear | `create_session`, the vaults, `deposit`'s position, `seller_fund`, `set_entry_quote`, and `buy_cover`'s cover use `seeds` plus canonical `bump`. `claim` and `sweep_dust` re-derive the session with `create_program_address` and the bump stored at that init before they sign. Later instructions that use `bump = account.bump` read the bump the canonical init stored. No instruction takes a bump argument. |
| 3 | Missing ownership check | clear | Sessions, positions, sellers, quotes, and covers are `Account<'info, T>`. Token accounts are `Account<'info, TokenAccount>`. Mints are `Account<'info, Mint>`. No `UncheckedAccount` and no `try_from_slice`. |
| 4 | Missing signer check | clear | `authority`, `owner`, `buyer`, and `seller_wallet` are `Signer`. `lock_and_start`, `sweep_dust`, and `set_entry_quote` use `has_one = authority`. `claim` and `claim_cover` use `has_one = owner`. `seller_withdraw` requires `seller.seller == seller_wallet`. |
| 5 | Sysvar account check | clear | `now` comes from `Clock::get()`. `create_session` takes `Sysvar<'info, Rent>`. The lockfile resolves `solana-clock` 3.2.1, which is past the 1.8.1 sysvar-address fix. No instruction accepts a raw sysvar account from the caller. |
| 6 | Improper instruction introspection | n/a | No `load_instruction_at`, `load_current_index`, or `get_instruction_relative`. |

## Instruction matrix

Handler is `live` or `pending (wave 3)`. Other cells are ✔, ✘, or n/a.

| Instruction | Handler | PDA seeds and bump | Owner | Mint | Token program | Signer / has_one | State before transfer | Deadline | Arithmetic | init_if_needed | Distinct accounts | Permissionless forward-only | CPI is SPL token only |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| create_session | live | ✔ | ✔ | ✔ | ✔ | ✔ | n/a | ✔ | ✔ | n/a | ✔ | n/a | ✔ |
| deposit | live | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | n/a | ✔ |
| lock_and_start | live | n/a | ✔ | n/a | n/a | ✔ | ✔ | n/a | ✔ | n/a | n/a | n/a | n/a |
| observe | live | n/a | ✔ | n/a | n/a | n/a | ✔ | ✔ | ✔ | n/a | n/a | ✔ | n/a |
| settle | live | n/a | ✔ | n/a | n/a | n/a | ✔ | n/a | ✔ | n/a | n/a | ✔ | n/a |
| claim | live | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | n/a | ✔ | n/a | ✔ | n/a | ✔ |
| expire_incomplete | live | n/a | ✔ | n/a | n/a | n/a | ✔ | ✔ | ✔ | n/a | n/a | ✔ | n/a |
| sweep_dust | live | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | n/a | ✔ | n/a | ✔ | n/a | ✔ |
| seller_fund | pending (wave 3) | ✔ | ✔ | ✔ | ✔ | ✔ | n/a | n/a | n/a | ✔ | n/a | n/a | ✔ |
| set_entry_quote | pending (wave 3) | ✔ | ✔ | n/a | n/a | ✔ | n/a | n/a | n/a | ✔ | n/a | n/a | n/a |
| buy_cover | pending (wave 3) | ✔ | ✔ | n/a | ✔ | ✔ | n/a | n/a | n/a | ✔ | ✔ | n/a | ✔ |
| claim_cover | pending (wave 3) | ✔ | ✔ | n/a | ✔ | ✔ | n/a | n/a | n/a | n/a | ✔ | n/a | ✔ |
| seller_settle | pending (wave 3) | ✔ | ✔ | n/a | ✔ | n/a | n/a | n/a | n/a | n/a | n/a | n/a | ✔ |
| seller_withdraw | pending (wave 3) | ✔ | ✔ | n/a | ✔ | ✔ | n/a | n/a | n/a | n/a | ✔ | n/a | ✔ |

Notes on cells that are easy to misread:

- **deposit / lock / observe / settle / expire PDA.** Those instructions do not sign for the session. The session is `Account<'info, Session>`, so it is owned by this program, and the only creator is `create_session`'s canonical `init`. Vault pubkeys are checked against `session.vaults`, which that init wrote from the vault PDAs.
- **claim / sweep PDA.** `require_session_pda` runs before the signed transfer. It uses the bump stored at canonical init.
- **Distinct accounts.** `deposit`, `claim`, and `sweep_dust` reject `vault_0 == vault_1`. Passing the same token account as `owner_ta` and a vault is `ConstraintDuplicateMutableAccount` (2040) under Anchor 1.0.2. `security_deposit_owner_ta_is_vault` and `security_claim_owner_ta_is_vault` pin that.
- **Deadline n/a.** The spec does not put a deadline on `lock_and_start`, `settle`, `claim`, or `sweep_dust`. `deposit` uses `now <= deposit_deadline`. `observe` uses `now <= replay_deadline`. `expire_incomplete` is the deadline instruction.
- **Stub state, deadline, mint, and permissionless cells** are n/a where the empty handler neither transfers nor writes the product fields. The struct still declares the PDA, owner, signer, and token-program checks above. Wave 3 has to enforce Open / deadline / wallet mint and owner in the handler before any transfer. See "deliberately not changed".
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

## Arithmetic pass

Searched `programs/macropaths/src/instructions/` for `as u64`, `as i64`, `as u32`, and for `+`, `-`, `*` on amounts.

- No `as u64`, `as i64`, or `as u32`.
- `create_session`: `N_OBS as usize` widens the `u32` constant into the `[i64; 48]` array length. `N_OBS` is 48.
- `observe`: `index as usize` is reached only after `index < n_obs` and `index < values.len()`. Widening, then bounded by the array.
- `buy_cover` and `seller_settle`: `usize::from(product)` is an infallible `u8` conversion, used only to index `session.vaults`.
- Token amounts use `checked_add` or `math::*`, and `None` maps to `MathOverflow`. `lock_and_start` uses `min` only.

## Findings

### High — seller token account can be created for the wrong mint

**File:** `programs/macropaths/src/instructions/seller_fund.rs` (the `play_mint` constraint).

**Fix:** `25cadea`.

`seller_ta` is `init_if_needed` with `token::mint = play_mint` in the account struct. The handler is empty, but Anchor still initializes the account. `play_mint` was any mint. One seller token account exists per session, so the first caller chose its mint forever. `security_seller_fund_wrong_mint` observed `InitializeAccount3` succeeding before the fix. The constraint `play_mint.key() == session.play_mint` rejects that with `WrongMint`, and neither the seller account nor the seller token account is created.

## Deliberately not changed

- `state.rs`, `math.rs`, `chain.rs`, `constants.rs`, `common/mod.rs`, and other agents' tests.
- `Session::signer_seeds` stays in `state.rs`. The crate asserts a little-endian target, the returned slices borrow `self`, and the bytes are the authority, the little-endian `session_id`, and the stored bump. `claim` and `sweep_dust` check that those seeds derive the session before signing.
- `math::step_cooling` still `expect`s when `new_peak - x` does not fit in `i64`. That aborts the one `observe` and does not advance `next_index`, so `expire_incomplete` can still move the session to Refunding. The published series does not reach it. Closing it means changing `math.rs`, which this brief does not own.
- `create_session` still accepts whatever mint the authority passes, including one whose freeze authority is set. The spec's checks are `d_cap > 0`, `a_cap > 0`, and `now < deposit_deadline < replay_deadline`. Rejecting freeze authority would be a new product rule.
- `lock_and_start` is not deadline-gated. After `deposit_deadline`, `lock_and_start` and `expire_incomplete` can both succeed; whichever lands first wins. The spec does not forbid the lock.
- Wave 3 handlers stay empty. Before they transfer, they need the spec's state and deadline checks, wallet mint and owner checks, and they must store the canonical bump from `ctx.bumps` on `Seller`, `EntryQuote`, and `Cover`. `buy_cover`, `seller_settle`, `seller_withdraw`, and `claim_cover` validate `bump = stored`. A zero bump fails closed. A handler that stored a non-canonical bump would be pattern 2; nothing does that today.
- `seller_settle` does not yet enforce "forward only". The empty handler cannot move state. That cell is n/a until the handler exists.

## Countersign

Countersigned by Dev: ____ (date)
