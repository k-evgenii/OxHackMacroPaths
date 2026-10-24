# Decisions

Decisions that aren't settled in code yet, with who made them and why. Add new ones at the top.

## 2026-10-24: Keeper supports both `create_session` layouts, chosen by the IDL

**Decided by:** Phill (keeper owner)

**Context:** Two `create_session` signatures exist, and neither is on `main` with a body yet:

| | Dev, PR #7 (`dev/state-idl`) | Evgenii, `cursor_main` |
|---|---|---|
| Args | `nonce: u64, params: SessionParams` | `session_id: u64, k, d_cap, a_cap, deposit_deadline, replay_deadline: i64, dataset_id, c0, terminal: [u8; 32]` |
| Term sheet | `products[2] = { kind, direction, threshold, cap }`, plus `term_sheet_hash`, `source_digest`, `series_code`, `start_period`, `expected_count` | flat `k`, `d_cap`, `a_cap` |
| Accounts | `creator, session, mint, vault_0, vault_1, token_program, system_program` | `authority, session, play_mint, vault_0, vault_1, token_program, system_program, rent` |
| `observe` signer | `controller` | none (permissionless) |

Both use the same PDA seeds: `["session", creator, id u64 LE]` and `["vault", session, [0 | 1]]`.

**Decision:** `keeper/src/session.ts` reads the args of `create_session` in `packages/client/idl.json`:
- `nonce, params` selects the **params** layout (PR #7);
- `session_id, …` selects the **flat** layout (`cursor_main`).

Anything else is an error. PDAs, mint creation, parameter loading and the read-back check are shared. When one layout is chosen for `main`, delete the other branch of `createSessionArgs` and `expectedSession`.

**Why:** Task 10 could start without waiting for Dev and Evgenii to agree, and whichever layout lands works without rewriting the keeper.

**Params layout, demo term sheet:** product 0 = `{ MaxMove, +1, threshold 0, cap D_cap }`; product 1 = `{ Accumulate, +1, threshold K, cap A_cap }`. These are the demo values in PR #7's `state.rs`. K and both caps come from `data/cpi-yoy-replay.json`.

## 2026-10-24: `term_sheet_hash` = zeros, `source_digest` = raw-file hash (params layout)

**Decided by:** Phill (keeper owner)

**Context:** PR #7's `SessionParams` has `term_sheet_hash` and `source_digest`, but nothing in either branch says how to compute them. Both are opaque to the program: it only stores them. `dataset_id` (spec: `docs/commitment-chain.md` v1) already binds the 60 CPI levels, N, the first period, K and both caps.

**Decision:**
- `source_digest` = `source.sha256_of_raw` from `data/cpi-yoy-replay.json`, the SHA-256 of the raw FRED CSV.
- `term_sheet_hash` = 32 zero bytes until Dev defines it.

**Why:** `source_digest` naturally means the raw-file hash, and the keeper already has it. Zeros make it obvious that `term_sheet_hash` is unset, rather than inventing an encoding that would later conflict with Dev's.

**Revisit when:** Dev defines `term_sheet_hash`, or PR #7 drops either field.
