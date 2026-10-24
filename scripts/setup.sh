#!/usr/bin/env bash
# MacroPaths toolchain installer for WSL2 Ubuntu 24.04 (also fine on native Ubuntu/Debian).
# Safe to re-run: every step is skipped if already done.
#   ./scripts/setup.sh           install + verify
#   ./scripts/setup.sh --smoke   also build a throwaway Anchor project in ~/smoke
# Needs sudo once (apt). Never prints or writes your keypair into the repo.
set -euo pipefail

ANCHOR_VERSION="1.0.2"
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SMOKE=0; [[ "${1:-}" == "--smoke" ]] && SMOKE=1

step() { printf '\n==> %s\n' "$*"; }
die()  { printf '\nFAILED: %s\n' "$*" >&2; exit 1; }

export PATH="$HOME/.pixi/bin:$HOME/.cargo/bin:$HOME/.avm/bin:$HOME/.local/share/solana/install/active_release/bin:$HOME/.local/bin:$PATH"

[[ "$(uname -s)" == "Linux" ]] || die "Linux/WSL only. On Windows, run this inside the Ubuntu (WSL) terminal."
case "$REPO_DIR" in /mnt/*) die "Repo is on the Windows mount ($REPO_DIR). Clone it under ~/ in WSL; builds are 5-10x slower on /mnt." ;; esac

step "1/6 apt packages (needs sudo)"
PKGS=(build-essential pkg-config libssl-dev libudev-dev clang cmake curl git)
MISSING=()
for p in "${PKGS[@]}"; do dpkg -s "$p" >/dev/null 2>&1 || MISSING+=("$p"); done
if ((${#MISSING[@]})); then
  sudo apt update && sudo apt install -y "${PKGS[@]}" || die "apt install failed"
else
  echo "all present"
fi

step "2/6 pixi + locked project environment"
command -v pixi >/dev/null || curl -fsSL https://pixi.sh/install.sh | bash
command -v pixi >/dev/null || die "pixi not on PATH after install"
(cd "$REPO_DIR" && pixi install --locked && pixi run -q versions) || die "pixi install --locked failed"

step "3/6 Solana CLI + Anchor + Surfpool"
if ! command -v solana >/dev/null || ! command -v avm >/dev/null; then
  curl --proto '=https' --tlsv1.2 -sSfL https://solana-install.solana.workers.dev | bash
fi
command -v solana >/dev/null || die "solana not found after install"
if ! command -v avm >/dev/null; then
  cargo install --git https://github.com/solana-foundation/anchor avm --locked --force
fi
command -v avm >/dev/null || die "avm not found after install"

# The Solana installer only edits ~/.profile (login shells); VS Code/WSL terminals read ~/.bashrc.
if ! grep -qs 'solana/install/active_release/bin' "$HOME/.bashrc"; then
  printf '\n# Solana CLI (added by MacroPaths setup.sh)\nexport PATH="$HOME/.local/share/solana/install/active_release/bin:$HOME/.avm/bin:$PATH"\n' >> "$HOME/.bashrc"
fi

step "4/6 Pin Anchor $ANCHOR_VERSION (the installer ships a newer one)"
if [[ "$(anchor --version 2>/dev/null)" != "anchor-cli $ANCHOR_VERSION" ]]; then
  avm install "$ANCHOR_VERSION" && avm use "$ANCHOR_VERSION"
fi
[[ "$(anchor --version)" == "anchor-cli $ANCHOR_VERSION" ]] || die "anchor is not $ANCHOR_VERSION"

command -v surfpool >/dev/null || curl -sL https://run.surfpool.run/ | bash
command -v surfpool >/dev/null || die "surfpool not found"

step "5/6 Devnet wallet"
solana config set --url devnet >/dev/null
KEY="$HOME/.config/solana/id.json"
if [[ -f "$KEY" ]]; then
  echo "keypair already exists, leaving it alone"
else
  solana-keygen new --no-bip39-passphrase --silent
fi
echo "Your PUBLIC key (safe to share): $(solana address)"
echo "Keypair file (NEVER share or commit): $KEY"
solana airdrop 2 >/dev/null 2>&1 || echo "airdrop rate-limited; retry later or use https://faucet.solana.com"
echo "devnet balance: $(solana balance 2>/dev/null || echo unknown)"

step "6/6 Versions"
(cd "$REPO_DIR" && echo "-- project env (use via 'pixi run' / 'pixi shell') --" && pixi run -q versions)
echo "-- global --"
solana --version; anchor --version; surfpool --version

if ((SMOKE)); then
  step "Smoke build (throwaway project in ~/smoke)"
  rm -rf "$HOME/smoke" && mkdir -p "$HOME/smoke" && cd "$HOME/smoke"
  anchor init smoke --no-git || true
  cd smoke && time anchor build
fi

cat <<MSG

Done. Notes:
 - Open a NEW terminal (or: source ~/.bashrc) so PATH changes apply.
 - Run project commands through 'pixi run ...' or 'pixi shell' to get Node 20 / Rust 1.89.
 - Add your public key as a row in keys/README.md. Never commit the keypair.
MSG
