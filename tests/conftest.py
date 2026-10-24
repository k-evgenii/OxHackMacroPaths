"""Shared helpers for the toolchain and integration tests."""
import socket
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent


def run(cmd, timeout=60, **kwargs):
    """Run a command, capture text output, never raise on a non-zero exit."""
    return subprocess.run(cmd, capture_output=True, text=True, timeout=timeout, **kwargs)


def free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def pytest_collection_modifyitems(config, items):
    """Slow/network tests only run when selected with -m (e.g. -m surfpool)."""
    selected = config.getoption("-m")
    for marker in ("surfpool", "devnet"):
        if marker in selected:
            continue
        skip = pytest.mark.skip(reason=f"opt-in: run with -m {marker}")
        for item in items:
            if marker in item.keywords:
                item.add_marker(skip)


@pytest.fixture(scope="session")
def root():
    return ROOT
