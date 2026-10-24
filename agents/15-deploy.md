# 15 deploy

**Goal.** Deploy to devnet, run one full session there, and publish the program ID, session address and explorer links.

**Branch and worktree.** `agent/15-deploy`, worktree `~/wt/15-deploy` (see `agents/README.md` Setup). Wave 4.

**Read first.** `AGENTS.md`; `docs/program-spec.md` §1.8; `agents/README.md` (PR template, conflict rules). Existing code to follow: `programs/macropaths/tests/common/mod.rs` (harness, after 01 merges) and the instruction files already in `programs/macropaths/src/instructions/`.

**May assume merged.** 11, 14. Do not start before the orchestrator has posted `main moved` for those. Rebase on `main` whenever it posts again.

**Before step 1.** In your worktree: `pixi install --locked && anchor build && cargo test -p macropaths` green.

**Rules.** Integer arithmetic only, `checked_*`, `u128` intermediates, floors everywhere. Every expected number in a test comes from `tests/vectors.json`. Edit only the files under "Files you own"; add lines to shared files, never remove others'. If the spec is silent, ask the orchestrator and wait.

## Scope and steps

**Files you own:** `Anchor.toml` (`[programs.devnet]`, `cluster = "devnet"`), `.env.example` (`PROGRAM_ID`, `PLAY_MINT`, `SESSION`), `packages/client/idl.json`, `README.md` deployment section, `docs/deployments.md`.
1. Get the shared program keypair from the orchestrator (never commit it); `anchor keys sync`; confirm `declare_id!` matches.
2. `anchor build && anchor deploy --provider.cluster devnet` with the funded devnet wallet; record program ID, deploy signature, slot.
3. Run agent 14's `run.ts` against devnet with the Helius/QuickNode `RPC_URL`; run `replay.ts` once fully; record session address, first and last `observe` signatures, settle signature.
4. Regenerate `packages/client/idl.json` from the deployed build; write explorer links (`https://explorer.solana.com/address/<id>?cluster=devnet`) into `README.md` and `docs/deployments.md`.
5. Hand the session address to Ari in chat.

## Acceptance and hand-off

**Acceptance:** explorer shows the program and a settled session with `scores = [827387, 863980]`.

Open a PR with the template in `agents/README.md`, paste the acceptance output verbatim, then post the Hand-off line in chat with the commit SHA.
