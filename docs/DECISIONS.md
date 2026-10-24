# Decisions

Decisions that aren't settled in code yet, with who made them and why. Add new ones at the top.

## 2026-10-24: The program is the `cursor_main` layout

**Decided by:** Dev and Evgenii

**Decision:** `create_session(session_id, k, d_cap, a_cap, deposit_deadline, replay_deadline, dataset_id, c0, terminal)`, and `observe` can be called by anyone (no signer). PR #7's `nonce + SessionParams` layout won't be merged; it was written before the agent swarm started. The keeper supports only this layout. `keeper/src/session.ts` `checkIdl` fails if the IDL's `create_session` args differ.
