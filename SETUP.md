# MacroPaths — environment setup

Works on Windows (via WSL2), macOS and Linux. Every command below is typed by hand so nothing depends on a shell script. Do this tonight on every machine; the first `anchor test` passing is the gate.

## 0. Windows only: WSL2 first

The Solana toolchain does not build natively on Windows. All Solana work happens inside WSL2 (Ubuntu). Node, pixi, Cursor and VS Code can live on Windows and attach to WSL, but run every command in this document **inside the WSL terminal**.

```powershell
# PowerShell as administrator, once
wsl --install -d Ubuntu-24.04
# reboot, open "Ubuntu" from the Start menu, create a user
```

Inside Ubuntu:

```bash
sudo apt update && sudo apt install -y build-essential curl git
```

VS Code: install the "WSL" extension and use `code .` from the Ubuntu terminal so the editor runs against the Linux filesystem. Keep the repo under `~/` in WSL, not under `/mnt/c/` — builds are 5–10× slower on the Windows mount.

## 1. pixi

```bash
curl -fsSL https://pixi.sh/install.sh | bash
exec $SHELL    # reload PATH
pixi --version
```

## 2. Create the project and add runtimes

```bash
mkdir macropaths && cd macropaths
pixi init
```

Runtimes and build dependencies:

```bash
pixi add "rust>=1.85" "nodejs=20.*" "python=3.12.*"
pixi add pkg-config openssl clang cmake make git
pixi add libudev            # Linux / WSL only — skip on macOS
```

Python data and forecast stack (packages P1 and P5):

```bash
pixi add pandas numpy scipy statsmodels requests pyarrow matplotlib
pixi add jupyterlab         # optional
```

Add tasks to `pixi.toml` so the keeper owner and the data owner share commands:

```toml
[tasks]
prepare  = "python data/prepare.py"
vectors  = "python tests/make_vectors.py"
forecast = "python forecast/ar1.py"
```

From here on, run everything through the environment:

```bash
pixi shell          # opens a shell with rust/node/python on PATH
```

## 3. Solana CLI, Anchor 1.0.2, Surfpool

Inside `pixi shell`:

```bash
curl --proto '=https' --tlsv1.2 -sSfL https://solana-install.solana.workers.dev | bash
```

The installer adds a line to your shell rc. Reload, then pin Anchor:

```bash
exec $SHELL
avm install 1.0.2 && avm use 1.0.2
```

If `avm` is missing after the installer:

```bash
cargo install --git https://github.com/solana-foundation/anchor avm --locked --force
avm install 1.0.2 && avm use 1.0.2
```

Surfpool, if the installer did not include it:

```bash
curl -sL https://run.surfpool.run/ | bash
```

Verify:

```bash
rustc --version && node --version && python --version
solana --version      # solana-cli 3.x
anchor --version      # anchor-cli 1.0.2
surfpool --version
```

## 4. Repo layout and the Anchor program

```bash
anchor init macropaths --no-git
# anchor init makes a subfolder; move its contents up so programs/ sits at the repo root
shopt -s dotglob && mv macropaths/* . && rmdir macropaths && shopt -u dotglob
mkdir -p data forecast packages/client keeper web
```

Pin the crates in `programs/macropaths/Cargo.toml`:

```toml
[dependencies]
anchor-lang = { version = "1.0.2", features = ["init-if-needed"] }
anchor-spl  = "1.0.2"

[features]
idl-build = ["anchor-lang/idl-build", "anchor-spl/idl-build"]
```

(Keep the other `[features]` lines the template generated.) Then:

```bash
anchor build
anchor test        # runs the template test against Surfpool
```

If both pass, the environment is done. Everything below is packages.

## 5. Node packages

Root (Anchor TypeScript tests):

```bash
npm install --save-dev @anchor-lang/core @solana/web3.js@1 @solana/spl-token \
  mocha chai ts-mocha @types/mocha @types/chai typescript tsx
```

Keeper:

```bash
cd keeper && npm init -y
npm install @anchor-lang/core @solana/web3.js@1 @solana/spl-token csv-parse dotenv
npm install --save-dev typescript tsx @types/node
cd ..
```

Web:

```bash
npx create-next-app@latest web --ts --tailwind --eslint --app --src-dir --no-import-alias --use-npm
cd web
npm install @anchor-lang/core @solana/web3.js@1 @solana/spl-token \
  @solana/wallet-adapter-react @solana/wallet-adapter-react-ui @solana/wallet-adapter-wallets \
  recharts qrcode.react
cd ..
```

If the frontend owner chooses Solana Kit instead, replace `@anchor-lang/core @solana/web3.js@1` with `@solana/kit @solana/react-hooks` in all three places and generate the client with Codama. Do not mix the two stacks.

## 6. Data

No API key needed. Inside `pixi shell`:

```bash
cd data
for S in CPIAUCNS UNRATE FEDFUNDS DFF DGS10 DGS2 T10Y2Y T5YIE ICSA; do
  curl -fsSL "https://fred.stlouisfed.org/graph/fredgraph.csv?id=$S" -o "$S.csv"
done
cd ..
```

Windows users without WSL for this step only: open each URL in a browser and save, e.g. https://fred.stlouisfed.org/graph/fredgraph.csv?id=CPIAUCNS

## 7. Devnet wallet and RPC

```bash
solana config set --url devnet
solana-keygen new --no-bip39-passphrase
solana airdrop 2        # repeat a few times tonight; rate-limited
solana balance
```

Get a free devnet RPC key from Helius or QuickNode and put it in `.env` as `RPC_URL=...`. The public endpoint will throttle under demo load.

## 8. Agent skills (optional, five minutes)

```bash
npx skills add https://github.com/solana-foundation/solana-dev-skill
claude mcp add --transport http solana-mcp-server https://mcp.solana.com/mcp
```

## 9. Not installed on purpose

No oracle crates (`pyth-solana-receiver-sdk`, `chainlink_solana`), no Metaplex, no Token-2022, no Helius SDK. Add only if the live-adapter stretch is reached.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| `anchor build` fails with GLIBC errors | You are on an old Ubuntu in WSL; use 24.04 |
| `avm` not found after install | `export PATH="$HOME/.cargo/bin:$HOME/.avm/bin:$PATH"` and reload |
| `solana` not found | `export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"` |
| Build extremely slow on WSL | Repo is under `/mnt/c`; move it to `~/` |
| `anchor test` cannot start Surfpool | `surfpool --version`; reinstall with the one-liner in §3 |
| npm `ERESOLVE` on wallet adapter | `npm install --legacy-peer-deps` |



The remaining dependencies from SETUP.md cannot belong in pixi.lock:
- npm packages → package.json and package-lock.json
- Anchor crates → Cargo.toml and Cargo.lock
- Solana CLI, Anchor CLI, Surfpool → installed separately inside WSL
Those can be installed after the Anchor, keeper, and web project structures are created.