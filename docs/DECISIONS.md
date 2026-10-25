# Decisions

Decisions that aren't settled in code yet, with who made them and why. Add new ones at the top.

## 2026-10-24: Terminal-lockup fix is `observe` + `expire`, in the freeze build

**Decided by:** Phill. A teammate found the bug in review and asked for help.

**Context:** if `terminal` isn't the chain's real C_48, all 48 observes pass, `settle` fails (`ChainIncomplete`), and `expire_incomplete` fails (it needed `next_index < n_obs`), so every deposit is locked forever. See `docs/security-review.md`, "High: terminal lockup".

**Decision:**
- **Scope:**
  - `observe` rejects the last row unless `next_commitment == terminal`.
  - `expire_incomplete` refunds any Running session past `replay_deadline` that can't settle.
  - **Not** adding the third option, a `create_session` check that `terminal == chain::end_hash(dataset_id, N)`. It would reject a bad session before deposits, but fix 1 already makes funds safe, and it's a new create rule shortly before the freeze.
- **Timing:** in the freeze build, so G2 and the devnet deploy use the fixed program, and the pitch line "expire_incomplete refunds everyone if the replay stalls" stays true.

**Recorded collisions with existing specs and tests:**
- `docs/program-spec.md` §1.7/§1.8: the `expire_incomplete` rule was `next_index < n_obs`, and is now `!(next_index == n_obs && commitment == terminal)`. `observe` gained the last-row terminal check.
- `tests/lock_expire.rs` `lock_expire_running_complete_not_expired`: its fixture had `next_index == n_obs` but `commitment == C_0`, which is the stuck state, and it asserted `NotExpired`. It now also sets `commitment = terminal`, so it still checks that a complete session can't expire.
- If the teammate's own fix differs (for example, adding the `create_session` check, or no backstop), record the difference here before merging either one.

## 2026-10-24: The program is the `cursor_main` layout

**Decided by:** Dev and Evgenii

**Decision:** `create_session(session_id, k, d_cap, a_cap, deposit_deadline, replay_deadline, dataset_id, c0, terminal)`, and `observe` can be called by anyone (no signer). PR #7's `nonce + SessionParams` layout won't be merged; it was written before the agent swarm started. The keeper supports only this layout. `keeper/src/session.ts` `checkIdl` fails if the IDL's `create_session` args differ.
