# 13 cover

**Goal.** Fill buy_cover, claim_cover, seller_settle and seller_withdraw, with the extension tests E-1 to E-8.

**Branch and worktree.** `agent/13-cover`, worktree `~/wt/13-cover` (see `agents/README.md` Setup). Wave 3.

**Read first.** `AGENTS.md`; `docs/program-spec.md` §1.8 buy_cover, claim_cover, seller_settle, seller_withdraw; §1.5 cover_split, cover_claim; `agents/README.md` (PR template, conflict rules). Existing code to follow: `programs/macropaths/tests/common/mod.rs` (harness, after 01 merges) and the instruction files already in `programs/macropaths/src/instructions/`.

**May assume merged.** 12. Do not start before the orchestrator has posted `main moved` for those. Rebase on `main` whenever it posts again.

**Before step 1.** In your worktree: `pixi install --locked && anchor build && cargo test -p macropaths` green.

**Rules.** Integer arithmetic only, `checked_*`, `u128` intermediates, floors everywhere. Every expected number in a test comes from `tests/vectors.json`. Edit only the files under "Files you own"; add lines to shared files, never remove others'. If the spec is silent, ask the orchestrator and wait.

## Scope and steps

**Files you own:** `instructions/buy_cover.rs`, `instructions/claim_cover.rs`, `instructions/seller_settle.rs`, `instructions/seller_withdraw.rs`, `tests/cover.rs`.
1. Fill the four handlers per §1.8.
2. Tests E-1…E-8 (extension doc §8) made concrete: (E1) buy 20 units of product 1 at `p = 300000` (`cover_split(300000, 20e6) == (6e6, 14e6)`): vault_1 up 20e6, `free_cash` down 14e6, `escrow[1] == 14e6`, `n_sold[1] == 20e6`, `Cover.units[1] == 20e6`, `premium_paid[1] == 6e6`, `quote.frozen`; (E2) buy exceeding `(1−p)·units > free_cash` → `InsufficientSellerFunds`; (E3) `set_entry_quote` after the buy → `QuoteFrozen`; after lock → `WrongState`; (E4) two buys by one buyer accumulate; expire → `claim_cover` refunds exactly `premium_paid`, `seller_settle` returns exactly `escrow`; (E5) full replay then `claim_cover` pays `cover_claim(863980, 20e6) == 17_279_600` and `seller_settle(1)` pays `20e6 − 17_279_600`, sum `== n_sold`; repeat with the session's product 0 for `s = 827387`; (E6) dust: two buyers with 3 and 2 units at `s = 500000`-like score is not reachable with the real chain, so assert the inequality `Σ buyer claims + seller remainder ≤ n_sold` and dust `≥ 0` on the real scores; (E7) `seller_withdraw` while `escrow[1] > 0` → `SellerEscrowOutstanding`; after both `seller_settle` → succeeds, balance moves; (E8) pool deposit and cover on the same product in one session: run both; pool claims and cover claims and seller remainder all paid; vault ends with dust only; `sweep_dust` succeeds only after `claim_cover` and both `seller_settle`.

## Acceptance and hand-off

**Acceptance:** `cargo test -p macropaths cover`; hand-off includes `17279600`.

Open a PR with the template in `agents/README.md`, paste the acceptance output verbatim, then post the Hand-off line in chat with the commit SHA.
