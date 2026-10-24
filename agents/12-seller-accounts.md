# 12 seller-accounts

**Goal.** Fill seller_fund and set_entry_quote for the funded-seller extension.

**Branch and worktree.** `agent/12-seller-accounts`, worktree `~/wt/12-seller-accounts` (see `agents/README.md` Setup). Wave 3.

**Read first.** `AGENTS.md`; `docs/program-spec.md` §1.8 seller_fund, set_entry_quote; §1.2 Seller, EntryQuote; `agents/README.md` (PR template, conflict rules). Existing code to follow: `programs/macropaths/tests/common/mod.rs` (harness, after 01 merges) and the instruction files already in `programs/macropaths/src/instructions/`.

**May assume merged.** 10 (and gate G2 declared). Do not start before the orchestrator has posted `main moved` for those. Rebase on `main` whenever it posts again.

**Before step 1.** In your worktree: `pixi install --locked && anchor build && cargo test -p macropaths` green.

**Rules.** Integer arithmetic only, `checked_*`, `u128` intermediates, floors everywhere. Every expected number in a test comes from `tests/vectors.json`. Edit only the files under "Files you own"; add lines to shared files, never remove others'. If the spec is silent, ask the orchestrator and wait.

## Scope and steps

**Files you own:** `instructions/seller_fund.rs`, `instructions/set_entry_quote.rs`, `tests/seller_accounts.rs`. (`state.rs` already has the structs from 01.)
1. Fill both handlers per §1.8.
2. Tests: (a) fund 500 PLAY → `Seller.free_cash == 500e6`, seller_ta balance, `seller` pubkey set; (b) second fund by a different wallet → `WrongSeller`; (c) fund in Running → `WrongState`; (d) quote `[400000, 300000]` → stored, `is_set`; (e) `[40000, 300000]` → `QuoteOutOfRange`; `[400000, 960000]` → `QuoteOutOfRange`; (f) quote overwritten before any buy → new values; (g) quote by non-authority → constraint failure; (h) quote in Running → `WrongState`.

## Acceptance and hand-off

**Acceptance:** `cargo test -p macropaths seller_accounts`.

Open a PR with the template in `agents/README.md`, paste the acceptance output verbatim, then post the Hand-off line in chat with the commit SHA.
