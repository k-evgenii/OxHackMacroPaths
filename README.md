# OxHackMacroPaths

## MacroPaths on devnet: what to look at

### What it is

MacroPaths is a Solana program that pays out on the *path* of US CPI inflation,
not just its end value: two products, **Cooling** (how far year-on-year CPI fell
from its running peak) and **Excess** (how long and how far it stayed above 4%),
each settle to a score in millionths. Each product has two sides that deposit
PLAY tokens; the smaller side is the matched collateral, and settlement splits the
matched pot by the score while the unmatched remainder is refunded. The 48 monthly
CPI rows (Jan 2021 to Dec 2024) are replayed on devnet against a pre-committed
SHA-256 hash chain, so the keeper cannot alter, skip or reorder a row after the
session is created.

What this does and does not show:

- **Reproducible replay (deployed).** The 2021–24 replay can be recomputed by anyone
  from the committed data and rules ([docs/verify.md](docs/verify.md)). The chain is
  built from data that already exists, so it says nothing about future months.
- **Attested live data (proposed, not built).** A live session would trust a named
  attester to post each month after release; the hash makes the log append-only but
  cannot show a value is correct ([docs/live-mode.md](docs/live-mode.md)).
- **Forecasts and quotes are advisory.** Settlement uses only the realised path. The
  matched pool's implied price is 0.5, which favours one side whenever the expected
  score is not 0.5; cover is priced by a declared seller policy
  ([docs/pricing.md](docs/pricing.md)). Only the CPI session is
  executable; fuel, diesel and loan-rate products are design or proposal only
  ([docs/products.md](docs/products.md)). Wording we can and cannot use:
  [docs/pitch-claims.md](docs/pitch-claims.md).

### Deployed program and reference session

All on devnet. Details and the deployed commit are in [docs/deployments.md](docs/deployments.md).

| What | Id / link |
|---|---|
| Program | [`FvT786RtMTtbdXWemA9zgA9rfwhvxFsKY1ypiMMNwMbS`](https://explorer.solana.com/address/FvT786RtMTtbdXWemA9zgA9rfwhvxFsKY1ypiMMNwMbS?cluster=devnet) |
| Deployed commit | `dab88ff43ed988a112b192702b474db8f2cbcdc7` |
| Upgrade authority | `DwZ3j9GQZZTegHocho27JQfY7HZfCt8HNRceqe2hrJLV` |
| Reference session A (settled, read-only) | [`B89zLLRMtmwAKP5idiUt6ffzfetNo6xRZBbXpDVaBVju`](https://explorer.solana.com/address/B89zLLRMtmwAKP5idiUt6ffzfetNo6xRZBbXpDVaBVju?cluster=devnet) |
| create_session | [tx](https://explorer.solana.com/tx/2Brpr2T3oEaPQqAvkFxeQBAkQEDB2UZ9r2tYF2GnPq1paC2Ct2o67SfyqCYx5sHsNQ5THkLHzMoGkAMPeVyiSaR4?cluster=devnet) |
| lock_and_start | [tx](https://explorer.solana.com/tx/vAi1jotFXBc8MRaWRiLC9vBrNfd6vnWY58edJf4w7h8gigUKzRMdS6H8QsA4yAL76yRAgirXr6xGoYKQ6QQS9GF?cluster=devnet) |
| first observe (row 0) | [tx](https://explorer.solana.com/tx/4rrUGVz4eVjHNi23Bh2R5uCeGNpQj88L57k4uu8zVsR9NuSEhSXACgeR77h8pjB3WcTAP2HqjeBSqBAnBsSddpeA?cluster=devnet) |
| last observe (row 47) | [tx](https://explorer.solana.com/tx/4vWs7z2LnXRVEppvYz2pec6jaDmGEzQxsfRvdxZdoJyCcUx46zHKMGKGEPbKzdK4g7ofcebGoHvCEGt2HjZqEZXv?cluster=devnet) |
| settle | [tx](https://explorer.solana.com/tx/3hq1yZunZwcaK6vsZgJ1ggVsQ6PS1eT57FuhBkpgXipvGgoyAaNG1JAkNua6a1j1izUWQjf5Kg58ySoxNZy7E2Xv?cluster=devnet) |

The settled scores on that session are `827387` (Cooling) and `863980` (Excess),
in millionths.

### Reproduce the numbers

Needs Pixi (install below), plus rustup and Anchor 1.0.2 for the Rust tests
(see [TOOLCHAIN.md](TOOLCHAIN.md)). No wallet or RPC is needed for any of this.

```bash
pixi install --locked
pixi run fetch            # downloads CPIAUCNS from FRED into data/snapshots/
pixi run vectors          # rebuilds tests/vectors.json from the snapshot
```

The last line `pixi run vectors` prints is `D=66191 A=691184 827387 863980`; the
line before it is `dataset_id=... C_0=... C_N=...`, which must match the values in
[docs/verify.md](docs/verify.md).

```bash
anchor build --ignore-keys && cargo test -p macropaths    # LiteSVM; 117 passing at the deployed commit
```

`--ignore-keys` is needed because a fresh clone generates its own program keypair
that does not match `declare_id!`; the tests load the program under the declared
id and do not use the keypair file.

### Run the web app

The frontend is in `web/` (see [web/README.md](web/README.md)):

```bash
pixi install --locked
(cd packages/client && npm ci)
(cd web && npm ci)
cp web/.env.example web/.env.local
(cd web && npm run dev)
```

The app opens on reference session A (`NEXT_PUBLIC_DEFAULT_SESSION` in
`web/.env.example`). Set `RPC_URL` in `web/.env.local` to a keyed devnet endpoint
(Helius, QuickNode or similar): the public endpoint rate-limits `getTransaction`.
`NEXT_PUBLIC_USE_FIXTURES=1` serves the committed fixtures for session A without
any RPC.

### Verify the chain yourself

[docs/verify.md](docs/verify.md) walks through recomputing `dataset_id`, `C_0` and
`C_N` from the public FRED series, comparing them with the `dataset_id`,
`commitment` and `terminal` fields of the on-chain Session account, checking the
two scores by hand from `D` and `A`, and reproducing the worked payout of
33,827,340 PLAY base units for a buyer who put 10 PLAY on each product.

### Where things live

- `programs/macropaths/`: the Anchor program (`math.rs`, `chain.rs`, `state.rs`, `instructions/`) and its LiteSVM tests.
- `keeper/`: the off-chain keeper that fetches CPI, builds the chain (`src/prepare.ts`), creates sessions and replays the 48 rows. See [keeper/README.md](keeper/README.md).
- `web/`, `packages/client/` and `packages/ui/`: the Next.js frontend, the typed read client (its `idl.json` is also what the keeper loads) and shared UI components.
- `data/`: `fetch.py` and `series.toml`, the declared series and their gap rules. Snapshots are fetched, not committed.
- `forecast/`: the advisory forecast (`ar1.py` writes `table.json`), the caps manifest (`manifest.py`), the rolling-origin backtest and the 11-origin walk-forward. Advisory only; settlement uses the realised path.
- `research/`: the research notebook, the candidate products and the planner (`export_artifact.py` writes `forecast/planner.json`).
- `tests/`: `make_vectors.py` and the committed `vectors.json` that every implementation is pinned to; `pixi run test` for toolchain checks.
- `docs/`: [program-spec.md](docs/program-spec.md), [commitment-chain.md](docs/commitment-chain.md), [deployments.md](docs/deployments.md), [verify.md](docs/verify.md), [security-review.md](docs/security-review.md), [live-mode.md](docs/live-mode.md), [pricing.md](docs/pricing.md), [products.md](docs/products.md), [pitch-claims.md](docs/pitch-claims.md), [twin-windows.md](docs/twin-windows.md), [demo-manifest.md](docs/demo-manifest.md).

## Development environment

The local toolchain is managed by [Pixi](https://pixi.sh). The manifest and
lockfile cover Windows, WSL/Linux, Intel macOS, and Apple Silicon macOS. They
pin the shared Node.js, Python, native build, and data-science tools. Rust is
not in pixi: it comes from rustup (installed by the Solana installer below) and
is pinned to 1.89.0 by `rust-toolchain.toml`, because Anchor needs rustup's
`cargo +toolchain` support.

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

Shared data tasks, in order (the snapshots are fetched from FRED, not committed):

```bash
pixi run fetch --series CPIAUCNS --series GASREGW --series GASDESW --series DFF
pixi run vectors            # tests/vectors.json, the reference every implementation is pinned to
pixi run manifest           # forecast/manifest.json: caps by the declared rule, data rules, proposals
pixi run forecast           # forecast/table.json: AR(1) and random-walk forecasts, seller quotes
pixi run planner-artifact   # forecast/planner.json
pixi run walkforward        # forecast/walkforward.json and .md
pixi run test-planner
```

### Solana and Anchor (WSL2)

Solana CLI and Anchor are not installed through Pixi. On Windows, install and
run them inside WSL2; their installer also installs rustup, which provides
both the project Rust (1.89.0) and the Solana-specific build toolchain.

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

## Tests

```bash
pixi run test            # fast toolchain and repo checks
pixi run test-surfpool   # slow: builds and deploys to a local Surfnet
```

See [tests/README.md](tests/README.md).
