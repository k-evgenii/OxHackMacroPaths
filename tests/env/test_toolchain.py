"""Toolchain versions and PATH. Run through pixi: `pixi run test-env`."""
import os
import shutil
import sys

from conftest import ROOT, run


def test_python_is_312():
    assert sys.version_info[:2] == (3, 12)


def test_node_is_20():
    r = run(["node", "--version"])
    assert r.stdout.startswith("v20."), f"{r.stdout!r} (run via `pixi run`, system Node is 18)"


def test_rust_is_189_in_repo():
    """Pinned by rust-toolchain.toml; outside the repo rustup's default may differ."""
    r = run(["rustc", "--version"], cwd=ROOT)
    assert r.stdout.startswith("rustc 1.89."), r.stdout + r.stderr


def test_cargo_and_rustc_come_from_rustup():
    """Pixi must not ship its own Rust: Anchor calls `cargo +<solana toolchain>`, which only rustup understands."""
    rustup_bin = os.path.expanduser("~/.cargo/bin")
    for tool in ("cargo", "rustc"):
        path = shutil.which(tool)
        assert path and os.path.dirname(path) == rustup_bin, f"{tool} resolves to {path}, expected {rustup_bin}"


def test_solana_is_3x():
    r = run(["solana", "--version"])
    assert r.stdout.startswith("solana-cli 3."), r.stdout + r.stderr


def test_anchor_is_pinned_and_needs_no_download():
    r = run(["anchor", "--version"], timeout=120)
    assert r.stdout.strip() == "anchor-cli 1.0.2", r.stdout + r.stderr
    assert "Installing" not in r.stdout + r.stderr, "anchor tried to download Solana tooling"


def test_avm_current_is_102():
    """Read avm's local marker; `avm list` hits the network and is flaky."""
    marker = os.path.expanduser("~/.avm/.version")
    assert os.path.isfile(marker), "avm has no active version: run `avm use 1.0.2`"
    assert open(marker).read().strip() == "1.0.2"


def test_surfpool_runs():
    r = run(["surfpool", "--version"])
    assert r.returncode == 0 and r.stdout.startswith("surfpool"), r.stdout + r.stderr


def test_solana_tools_on_path_in_non_login_shell():
    """Regression: the Solana installer only edited ~/.profile, so VS Code terminals lost agave-install."""
    env = {"HOME": os.environ["HOME"], "PATH": "/usr/bin:/bin"}
    r = run(["bash", "-ic", "command -v agave-install solana avm"], env=env)
    found = [l for l in r.stdout.splitlines() if l.startswith("/")]
    assert len(found) == 3, f"expected 3 tools on PATH, got {found!r}; fix ~/.bashrc (see ANCHOR.md)"
