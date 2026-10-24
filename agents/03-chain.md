# 03 chain

**Goal.** Implement the commitment chain byte-identically in Rust, Python and TypeScript and add the real 49 commitments to tests/vectors.json.

**Branch and worktree.** `agent/03-chain`, worktree `~/wt/03-chain` (see `agents/README.md` Setup). Wave 0.

**Read first.** `AGENTS.md`; `docs/program-spec.md` §1.6; `agents/README.md` (PR template, conflict rules). Existing code to follow: `programs/macropaths/tests/common/mod.rs` (harness, after 01 merges) and the instruction files already in `programs/macropaths/src/instructions/`.

**May assume merged.** none. Do not start before the orchestrator has posted `main moved` for those. Rebase on `main` whenever it posts again.

**Before step 1.** In your worktree: `pixi install --locked && anchor build && cargo test -p macropaths` green.

**Rules.** Integer arithmetic only, `checked_*`, `u128` intermediates, floors everywhere. Every expected number in a test comes from `tests/vectors.json`. Edit only the files under "Files you own"; add lines to shared files, never remove others'. If the spec is silent, ask the orchestrator and wait.

## Scope and steps

**Files you own:** `programs/macropaths/src/chain.rs`, `programs/macropaths/tests/chain_vectors.rs`, `pub mod chain;` in `lib.rs`, `docs/commitment-chain.md`, the `chain` section of `tests/make_vectors.py` and `tests/vectors.json`, `keeper/src/prepare.ts` (chain output only), `keeper/src/prepare.test.ts`.
1. Write `docs/commitment-chain.md` = spec §1.6 plus a worked byte dump of `C_48` and `C_47` for the real data.
2. Rust `chain.rs`: `pub fn dataset_id(source_url: &str, retrieved_at: &str, sha_hex: &str) -> [u8;32]`, `pub fn end_hash(dataset_id: &[u8;32], n: u32) -> [u8;32]`, `pub fn obs_hash(dataset_id, i: u32, period_id: u32, value: i64, next: &[u8;32]) -> [u8;32]` using `hashv`.
3. Python: add `def chain(snapshot, rows)` to `tests/make_vectors.py` producing `{"dataset_id": hex, "period_ids": [...], "commitments": [C_0 … C_48 hex]}` with `hashlib.sha256` and `struct.pack("<I")`, `("<q")`; write it under key `"chain"` in `vectors.json`. Re-run `pixi run vectors`; the acceptance line must still print.
4. TypeScript: in `prepare.ts` add `datasetId`, `endHash`, `obsHash`, `buildChain(rows)` using `node:crypto`; write `data/cpi-yoy-replay.json` with `{dataset_id, rows:[{t, period_id, x, next_commitment}], c0, terminal}`; `--check tests/vectors.json` now also compares all 49 commitments.
5. `chain_vectors.rs`: read `vectors.json.chain`; assert `end_hash == commitments[48]`, every `obs_hash(i) == commitments[i]`, and `dataset_id` from the snapshot's three strings matches.

## Acceptance and hand-off

**Acceptance:** `cargo test -p macropaths chain_` green; `pixi run vectors` prints the line; `pixi run -- npx tsx keeper/src/prepare.ts --check tests/vectors.json` prints `chain ok 49/49`. Hand-off: `agent 03 done: … chain 49/49 in Rust, Python, TS`.

Open a PR with the template in `agents/README.md`, paste the acceptance output verbatim, then post the Hand-off line in chat with the commit SHA.
