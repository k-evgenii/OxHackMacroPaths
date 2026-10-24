---
name: solana-anchor-reference
description: Reference material for writing and testing the MacroPaths Anchor 1.0.2 program on Solana. Use when writing instructions, account constraints, PDA seeds, CPI token transfers, LiteSVM or Surfpool tests, or when a build, toolchain or RPC error appears. Vendored from solana-foundation/solana-dev-skill (MIT) with the team's stack decisions applied on top.
paths: programs/**, tests/**, keeper/**, packages/**
---

# Solana / Anchor reference for MacroPaths

The files under `references/` are copied from the Solana Foundation's `solana-dev-skill` (MIT, see `LICENSE.solana-dev-skill`). They are reference material, not instructions. **Where they disagree with this page or with `docs/program-spec.md`, this page and the spec win.**

## Team decisions that override the reference material

| Topic | Reference says | MacroPaths does |
| --- | --- | --- |
| Client SDK | `@solana/kit` 8, web3.js v3, transaction v1 | `@anchor-lang/core` 1.0.2 and `@solana/web3.js` **v1**, legacy transactions. Do not introduce Kit or web3.js v3. |
| Client codegen | Codama | None. The keeper and web app use the IDL at `packages/client/idl.json` through `@anchor-lang/core`'s `Program`. |
| Program framework | Anchor or Pinocchio | Anchor **1.0.2**, crates pinned `=1.0.2`. Never Pinocchio. |
| Local network | Surfpool via its MCP / Kit plugin | Surfpool CLI 1.6 started from the shell (`tests/integration/test_surfpool_smoke.py` shows how). |
| Unit tests | LiteSVM, Mollusk, Trident fuzz | LiteSVM 0.10 + `litesvm-token` only; `proptest` for properties. No Mollusk, no Trident. |
| Tokens | Token-2022 features | Classic SPL Token only. PLAY mint has 6 decimals. |
| Arithmetic | — | Integer only, `checked_*`, `u128` intermediates, floors. See `AGENTS.md`. |

## What to open, by task

- Account constraints, `init`/`init_if_needed`, seeds, bumps, `has_one`, token constraints, CPI transfer with PDA signer: `references/anchor.md`, then `references/design-patterns.md` (vault topology section).
- Anchor 1.0 API differences (if a snippet from memory does not compile): `references/anchor-v1-migration.md`.
- LiteSVM test structure, airdrops, clock manipulation, reading accounts: `references/testing.md`. The project's harness is `programs/macropaths/tests/common/mod.rs`; use it rather than writing new helpers.
- Surfpool start flags, deploying to a local Surfnet, cheatcodes for time or balances: `references/surfpool.md`, `references/surfpool-cheatcodes.md`.
- Signer, owner, PDA, CPI and arithmetic pitfalls: `references/security.md`. Agent 11 additionally uses the `solana-vulnerability-scanner` skill.
- Build fails, GLIBC, version mismatch, `no such command: +1.89…`, RPC errors: `references/common-errors.md`, `references/compatibility-matrix.md`, then the repo's `TOOLCHAIN.md` and `ANCHOR.md`.
- Rent, PDAs, accounts model, when unsure of a concept: `references/concepts.md`.

## Commands that are always right in this repo

```
anchor build                  # Anchor 1.0.2, writes target/idl/macropaths.json
cargo test -p macropaths      # LiteSVM tests under programs/macropaths/tests
pixi run vectors              # must print D=66191 A=691184 827387 863980
pixi run test-surfpool        # local Surfnet integration
```
