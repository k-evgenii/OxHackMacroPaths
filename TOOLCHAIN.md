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
| Node / Python (pixi) | 20.20.2 / 3.12.15 | provided by `pixi.toml` + `pixi.lock` |
| Rust (rustup) | 1.89.0 in the repo | installed by the Solana installer; pinned by `rust-toolchain.toml` |
| Solana CLI | 3.1.10 | `curl --proto '=https' --tlsv1.2 -sSfL https://solana-install.solana.workers.dev \| bash` |
| Anchor CLI | **1.0.2** | `avm install 1.0.2 && avm use 1.0.2` |
| Surfpool | 1.6.1 | installed by the Solana installer above; fallback `curl -sL https://run.surfpool.run/ \| bash` |
| Devnet wallet | n/a | see below |

Check with `pixi run versions`, then `solana --version`, `anchor --version`, `surfpool --version`.

## Gotchas

- **The Solana installer installs Anchor 1.1.2, not 1.0.2.** Always run `avm install 1.0.2 && avm use 1.0.2` afterwards, and confirm `anchor --version` prints `anchor-cli 1.0.2`.
- **Node: use pixi.** Outside pixi you get system Node 18.19.1; the project's Node 20 only applies inside `pixi run ...` or `pixi shell`.
- **Rust: rustup only.** Inside the repo `rust-toolchain.toml` selects 1.89.0; elsewhere rustup's default (1.99.1) applies. Pixi must not contain Rust: it would shadow rustup's `cargo`, and `anchor build` then fails with `no such command: +1.89.0-sbpf-solana-...`.
- **Anchor crates are pinned with `=1.0.2`.** A plain `"1.0.2"` in Cargo means `^1.0.2` and silently resolved to 1.2.1.
- **`npm audit` reports 6 issues** (2 high), all inside `@anchor-lang/core` / `@solana/web3.js` v1. They are dev-only test deps; the offered fixes are breaking downgrades or web3.js v3. Left as is.
- **Program ID.** `target/deploy/macropaths-keypair.json` (not in git) must match `declare_id!`. On a fresh clone `anchor build` makes a new keypair: get the shared one from the program owner, or run `anchor keys sync` locally and do not commit it. Open decision for the program owner.
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

## Testing

```bash
pixi run test            # ~1 s: versions, PATH, repo hygiene
pixi run test-program    # anchor test: LiteSVM calls initialize
pixi run test-surfpool   # deploy to a local Surfnet and call initialize via the TS client
```

Details and layout: tests/README.md.

## Status

- Done: apt packages, pixi env, Solana, Anchor 1.0.2, Surfpool, smoke build (`anchor build` 2m53s).
- Open: Evgenii's devnet balance is 0 SOL (airdrop rate-limited); Surfpool-backed `anchor test` not set up.
