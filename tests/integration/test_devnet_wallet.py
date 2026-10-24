"""Opt-in: `pixi run pytest -m devnet`. Needs network and a funded devnet wallet."""
import pytest

from conftest import run

pytestmark = pytest.mark.devnet


def test_devnet_balance_is_positive():
    r = run(["solana", "balance", "--url", "devnet"], timeout=60)
    assert r.returncode == 0, r.stderr
    assert float(r.stdout.split()[0]) > 0, "0 SOL: use https://faucet.solana.com with `solana address`"
