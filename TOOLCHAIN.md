# Toolchain: what everyone needs, and what was verified

Verified on WSL2 Ubuntu 24.04.3 on 2026-10-24. Everything runs inside WSL, with the repo under `~/` (not `/mnt/c`).
Step-by-step background is in SETUP.md. This file is the checklist plus the gotchas hit while doing it.

## Quick path: run the installer

```bash
git clone <repo> ~/OxHackMacroPaths && cd ~/OxHackMacroPaths
./scripts/setup.sh            # add --smoke to also build a throwaway Anchor project
```

It asks for your sudo password once (apt), is safe to re-run, and does everything below. The manual list is kept for reference and troubleshooting.

## Every teammate needs all of this

| Tool | Version | How |
|---|---|---|
| apt packages | n/a | `sudo apt update && sudo apt install -y build-essential pkg-config libssl-dev libudev-dev clang cmake` (the only step that needs sudo) |
| pixi | 0.83.0 | `curl -fsSL https://pixi.sh/install.sh \| bash`, then `pixi install --locked` in the repo |
| Node / Rust / Python (pixi) | 20.20.2 / 1.89.0 / 3.12.15 | provided by `pixi.toml` + `pixi.lock`; do not edit them |
| Solana CLI | 3.1.10 | `curl --proto '=https' --tlsv1.2 -sSfL https://solana-install.solana.workers.dev \| bash` |
| Anchor CLI | **1.0.2** | `avm install 1.0.2 && avm use 1.0.2` |
| Surfpool | 1.6.1 | installed by the Solana installer above; fallback `curl -sL https://run.surfpool.run/ \| bash` |
| Devnet wallet | n/a | see below |

Check with `pixi run versions`, then `solana --version`, `anchor --version`, `surfpool --version`.

## Gotchas

- **The Solana installer installs Anchor 1.1.2, not 1.0.2.** Always run `avm install 1.0.2 && avm use 1.0.2` afterwards, and confirm `anchor --version` prints `anchor-cli 1.0.2`.
- **Two Node and two Rust versions exist.** Outside pixi you get system Node 18.19.1 and Rust 1.99.1 (from the Solana installer). The project versions only apply inside `pixi run ...` or `pixi shell`. Use those for project work.
- **PATH after install.** If a command is not found, add to `~/.bashrc`:
  `export PATH="$HOME/.cargo/bin:$HOME/.avm/bin:$HOME/.local/share/solana/install/active_release/bin:$HOME/.local/bin:$HOME/.pixi/bin:$PATH"`
- **First `anchor build` is slow** (about 3 minutes here); later builds are much faster.
- **`anchor test` on the stock template does NOT use Surfpool.** `Anchor.toml` has `test = "cargo test"` and the template has no tests, so it prints "running 0 tests" and exits 0. A pass there only proves the program compiles. A real Surfpool test setup is still open.
- **`anchor init` printed "No such file or directory"** (probably the yarn step) but still produced a working project. Not yet investigated.
- **Solana installer also installs an agent skill** (`solana-dev`) into `~/.agents/skills`. Review it before trusting it.

## Devnet wallet (each person makes their own)

```bash
solana config set --url devnet
solana-keygen new --no-bip39-passphrase --silent   # writes ~/.config/solana/id.json, outside the repo
solana address                                      # this is your public key; add it to keys/README.md
solana airdrop 2                                    # rate-limited; repeat later or use https://faucet.solana.com
solana balance
```

Never print, paste or commit the keypair file. Only the public key is safe to share.

## Status

- Done: apt packages, pixi env, Solana, Anchor 1.0.2, Surfpool, smoke build (`anchor build` 2m53s).
- Open: Evgenii's devnet balance is 0 SOL (airdrop rate-limited); Surfpool-backed `anchor test` not set up.
