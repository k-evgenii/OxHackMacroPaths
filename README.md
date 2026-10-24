# OxHackMacroPaths

## Development environment

The local toolchain is managed by [Pixi](https://pixi.sh). The manifest and
lockfile cover Windows, WSL/Linux, Intel macOS, and Apple Silicon macOS. They
pin the shared Node.js, Rust, Python, native build, and data-science tools.

Install Pixi on Windows:

```powershell
winget install --id prefix-dev.pixi --exact
```

Install Pixi on macOS/Linux/WSL:

```bash
curl -fsSL https://pixi.sh/install.sh | bash
```

Create the exact locked environment and verify the tools:

```bash
pixi install --locked
pixi run versions
```

Run a command inside the environment with `pixi run <command>`, or activate an
interactive shell with `pixi shell`.

The optional JupyterLab environment is separate from the default environment:

```bash
pixi install --locked --environment notebook
pixi run --environment notebook jupyter
```

Shared data tasks are available as the corresponding source files are added:

```bash
pixi run prepare
pixi run vectors
pixi run forecast
```

### Solana and Anchor (WSL2)

Solana CLI and Anchor are not installed through Pixi. On Windows, install and
run them inside WSL2; their installer manages the Solana-specific Rust
toolchain separately from the general Rust version pinned here.

In an Ubuntu WSL terminal, review and run Solana's official installer:

```bash
curl --proto '=https' --tlsv1.2 -sSfL https://solana-install.solana.workers.dev | bash
```

Restart the WSL terminal, then select the project version of Anchor:

```bash
avm install 1.0.2
avm use 1.0.2
```

Verify the complete toolchain:

```bash
rustc --version
solana --version
anchor --version
surfpool --version
node --version
yarn --version
```
