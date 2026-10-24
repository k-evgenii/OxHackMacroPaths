# Tests

Run everything through pixi so Node 20 and pytest are the pinned ones (Rust 1.89 comes from rustup + `rust-toolchain.toml`).

| Command | What it proves | Time |
|---|---|---|
| `pixi run test` (= `test-env`) | Tool versions (Node 20, Rust 1.89 from rustup, Python 3.12, Solana 3.x, Anchor 1.0.2, Surfpool), Solana tools on PATH in a non-login shell, no keypairs in git, ignore rules, `keys/` holds only public keys | ~1 s |
| `pixi run test-program` | `anchor test`: builds the program and calls `initialize` in LiteSVM (`programs/macropaths/tests/`) | ~2 min first build, then seconds |
| `pixi run test-surfpool` | Builds the program, starts a local Surfnet (offline), deploys it, checks it is executable, and calls `initialize` through the Anchor TS client (`initialize.test.ts`) | ~20 s after a build |
| `pixi run pytest -m devnet` | Your devnet wallet has SOL (fails until the faucet gives you some) | ~5 s |

Run `pixi run test` after `./scripts/setup.sh` and before pushing.

## Layout

```
tests/
  conftest.py              helpers (run, free_port); opt-in markers
  env/                     fast checks of the machine and repo
  integration/             slow or networked end-to-end tests (pytest drives Surfpool; *.test.ts are the client calls)
```

Where later tests go (create the folder when the code exists):

| Code under test | Test location |
|---|---|
| Maths / forecast (Python) | `tests/python/` plus golden vectors in `tests/vectors/` made by `tests/make_vectors.py` |
| Anchor program | `programs/macropaths/tests/` (Rust, LiteSVM) |
| Keeper | `keeper/test/` |
| Program called through the client | `tests/integration/*.test.ts`, run against Surfpool by `test_surfpool_smoke.py` |

## Gotchas

- `test-program` and `test-surfpool` need `npm install` once (for the TS client) and an `anchor build`; both run inside pixi.
- The Surfpool test skips if `target/deploy/macropaths-keypair.json` doesn't match `declare_id!` (fresh clone); see TOOLCHAIN.md "Program ID".
- Tests never touch `~/.config/solana/id.json`; Surfpool tests make a throwaway keypair.
- The Surfpool test needs the Solana CLI to find the websocket on RPC port + 1.
