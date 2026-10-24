"""No secrets or keypairs in git, and the ignore rules that protect us are in place."""
import re
from pathlib import Path

import pytest

from conftest import ROOT, run

KEYPAIR_JSON = re.compile(r"\[\s*(\d{1,3}\s*,\s*){63}\d{1,3}\s*\]")
KEYPAIR_NAMES = re.compile(r"(^|/)(id\.json|[^/]*-keypair\.json)$")
B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"


def tracked():
    return run(["git", "ls-files"], cwd=ROOT).stdout.splitlines()


def b58_decode(s):
    n = 0
    for ch in s:
        n = n * 58 + B58.index(ch)
    body = n.to_bytes((n.bit_length() + 7) // 8, "big")
    return b"\0" * (len(s) - len(s.lstrip("1"))) + body


def test_no_keypair_files_tracked():
    bad = [f for f in tracked() if KEYPAIR_NAMES.search(f)]
    assert not bad, bad


def test_no_keypair_contents_tracked():
    bad = []
    for f in tracked():
        p = ROOT / f
        if p.suffix in {".json", ".txt", ".key", ""} and p.is_file() and p.stat().st_size < 4096:
            if KEYPAIR_JSON.search(p.read_text(errors="ignore")):
                bad.append(f)
    assert not bad, f"keypair-shaped content in {bad}"


@pytest.mark.parametrize("path", ["target/x", "node_modules/x", ".env", ".anchor/x"])
def test_gitignore_covers(path):
    assert run(["git", "check-ignore", "-q", path], cwd=ROOT).returncode == 0, path


def test_keys_folder_holds_only_public_keys():
    for p in (ROOT / "keys").iterdir():
        if p.name == "README.md":
            continue
        assert p.suffix == ".pub", f"unexpected file in keys/: {p.name}"
        assert len(b58_decode(p.read_text().strip())) == 32, f"{p.name} is not a 32-byte address"
