# Anchor: getting started and fixing a broken install

Target: **anchor-cli 1.0.2** on WSL2 Ubuntu 24.04. Everything here runs in the WSL terminal, with the repo under `~/`.
The fastest fix for most problems is to run `./scripts/setup.sh`, which is safe to re-run. Details are in TOOLCHAIN.md.

## 1. Is Anchor installed correctly?

```bash
anchor --version     # must print: anchor-cli 1.0.2
avm list             # installed versions; the active one is marked
which anchor         # expect ~/.cargo/bin/anchor
```

`anchor` is a thin launcher. `avm` (Anchor Version Manager) picks which real version it runs.

## 2. Install / repair

Anchor needs Rust and the Solana CLI first. The Solana installer provides all three:

```bash
curl --proto '=https' --tlsv1.2 -sSfL https://solana-install.solana.workers.dev | bash
exec $SHELL
avm install 1.0.2 && avm use 1.0.2
anchor --version
```

**That installer ships a newer Anchor (1.1.2 when we ran it).** So the `avm use 1.0.2` line is not optional. Mixing versions with the repo's `anchor-lang = "1.0.2"` gives confusing build errors.

## 3. Common problems

| Symptom | Cause / fix |
|---|---|
| `anchor: command not found` or `avm: command not found` | PATH. Add to `~/.bashrc`, then `exec $SHELL`: `export PATH="$HOME/.cargo/bin:$HOME/.avm/bin:$HOME/.local/share/solana/install/active_release/bin:$HOME/.local/bin:$HOME/.pixi/bin:$PATH"` |
| `Command not installed: agave-install. Installing from ...` when running `anchor` | Solana's bin folder is not on PATH in non-login shells (VS Code terminal). The Solana installer only edits `~/.profile`. Fix: `echo 'export PATH="$HOME/.local/share/solana/install/active_release/bin:$HOME/.avm/bin:$PATH"' >> ~/.bashrc && source ~/.bashrc`. `./scripts/setup.sh` now does this for you |
| `anchor --version` shows 1.1.x | Run `avm use 1.0.2` |
| `avm` missing after the installer | `cargo install --git https://github.com/solana-foundation/anchor avm --locked --force`, then `avm install 1.0.2 && avm use 1.0.2` |
| `linker 'cc' not found`, `openssl`, `libudev`, or `clang` errors | Missing apt packages: `sudo apt install -y build-essential pkg-config libssl-dev libudev-dev clang cmake` |
| GLIBC errors on `anchor build` | Wrong Ubuntu. Use 24.04 (`lsb_release -a`) |
| Very slow builds | Repo is on `/mnt/c/...`. Move it to `~/` in WSL |
| `solana: command not found` | PATH line above (the `solana/install/active_release/bin` part) |
| `anchor init` prints "No such file or directory" | Seen here, project still got created. Probably the yarn step; ignore if `anchor build` works |
| `error: no such command: +1.89.0-sbpf-solana-v1.52` on `anchor build` | A non-rustup `cargo` is first on PATH (`which cargo` should be `~/.cargo/bin/cargo`). The repo's pixi env no longer ships Rust; if you see this, `pixi install --locked` on the latest branch, or remove other Rust installs from PATH |
| `rustc` / `node` versions look wrong | Rust 1.89 applies inside the repo (`rust-toolchain.toml`), 1.99 elsewhere. Node 20 only applies inside `pixi run ...` or `pixi shell`; system Node is 18 |
| Airdrop fails with "rate limit" | Normal on devnet. Retry later or use https://faucet.solana.com |

## 4. First build (about 3 minutes the first time)

```bash
mkdir -p ~/smoke && cd ~/smoke
anchor init smoke --no-git
cd smoke
anchor build
anchor test
```

**Warning about `anchor test`:** the stock 1.0.2 template runs `cargo test` (see `[scripts]` in `Anchor.toml`) and has no tests. It prints "running 0 tests" and exits 0. That proves the program compiles, not that your logic works, and it does not use Surfpool.

## 5. How a project is laid out

```
Anchor.toml            cluster, wallet path, program IDs, the test command
Cargo.toml             Rust workspace
rust-toolchain.toml    pins Rust 1.89.0
programs/<name>/src/
  lib.rs               #[program] module: the entry points (instructions)
  instructions/        one file per instruction (handler + accounts struct)
  state/               account data structs (what is stored on-chain)
  constants.rs  error.rs
migrations/  app/      deploy scripts / frontend placeholder
target/                build output and the program keypair (never commit)
```

## 6. Concepts to learn first

- **Program**: the on-chain code. It is stateless; data lives in separate accounts.
- **Account**: a blob of data owned by a program. Every instruction lists the accounts it reads or writes.
- **Instruction**: one callable function. In Anchor, `#[derive(Accounts)]` declares which accounts it needs and checks them.
- **PDA** (program derived address): an account address derived from seeds, owned by the program. No private key exists for it.
- **Signer**: an account that must have signed the transaction (usually your wallet).
- **Rent / fees**: accounts need SOL to exist, and every transaction costs a small fee. On devnet, SOL is free from the faucet.

Good first reading: https://www.anchor-lang.com/docs. After that, open `programs/smoke/src/` in a fresh template and trace how `initialize` flows from `lib.rs` into `instructions/`.

## 7. Wallets

Anchor signs with `~/.config/solana/id.json` (set in `Anchor.toml`). Create your own with `solana-keygen new --no-bip39-passphrase --silent`. **Never share or commit that file**; only the public key (`solana address`) is safe to post. See `keys/README.md`.
