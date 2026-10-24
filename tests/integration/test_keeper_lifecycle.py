"""Keeper demo path on a local Surfnet.

Drives Phill's keeper CLI (create, lock, replay, settle) and a resume drill.
Does not edit anything under keeper/. Opt-in: ``pixi run test-surfpool``.
"""
import os
import re
import time
from pathlib import Path

import pytest

from conftest import ROOT, free_port, run
from test_surfpool_smoke import declared_id, payer, surfnet

pytestmark = pytest.mark.surfpool

# Imported so pytest registers the shared Surfnet and payer fixtures.
assert surfnet and payer and free_port

SNAPSHOT = ROOT / "data" / "snapshots" / "CPIAUCNS.json"
PENDING = ROOT / "data" / "replay-pending.json"
SO = ROOT / "target" / "deploy" / "macropaths.so"


@pytest.fixture(scope="module")
def built():
    """Program binary for ``program:load``. That cheatcode does not need the program keypair,
    so this build uses ``--ignore-keys`` and does not skip on a mismatched keypair."""
    if not SO.is_file():
        r = run(["anchor", "build", "--ignore-keys"], cwd=ROOT, timeout=900)
        assert r.returncode == 0, r.stdout[-2000:] + r.stderr[-2000:]
    assert SO.is_file(), "target/deploy/macropaths.so missing"
    return declared_id()


def _env(dotenv_path: Path) -> dict:
    env = os.environ.copy()
    env["DOTENV_PATH"] = str(dotenv_path)
    # dotenv does not override variables already set in the parent.
    env.pop("RPC_URL", None)
    env.pop("KEEPER_KEYPAIR", None)
    return env


def _write_dotenv(path: Path, rpc_url: str, keypair: Path) -> None:
    path.write_text(f"RPC_URL={rpc_url}\nKEEPER_KEYPAIR={keypair}\n")


def _keeper(args: list, dotenv_path: Path, timeout: int):
    if PENDING.exists():
        PENDING.unlink()
    return run(
        ["npm", "--prefix", "keeper", "run", *args],
        cwd=ROOT,
        env=_env(dotenv_path),
        timeout=timeout,
    )


def _check(r, what: str) -> str:
    out = (r.stdout or "") + (r.stderr or "")
    assert r.returncode == 0, f"{what} failed ({r.returncode}):\n{out[-4000:]}"
    return out


def _posted_rows(out: str) -> list[int]:
    return [int(n) for n in re.findall(r"(?m)^row\s+(\d+)\s+\d+", out)]


def test_keeper_lifecycle(built, surfnet, payer, tmp_path):
    if not SNAPSHOT.is_file():
        fetched = run(["pixi", "run", "fetch"], cwd=ROOT, timeout=180)
        assert fetched.returncode == 0, fetched.stdout[-2000:] + fetched.stderr[-2000:]
    assert SNAPSHOT.is_file(), "data/snapshots/CPIAUCNS.json missing after fetch"

    prepared = run(
        ["pixi", "run", "npx", "tsx", "keeper/src/prepare.ts"],
        cwd=ROOT,
        timeout=120,
    )
    assert prepared.returncode == 0, prepared.stdout[-2000:] + prepared.stderr[-2000:]
    assert (ROOT / "data" / "cpi-yoy-replay.json").is_file()

    dotenv = tmp_path / "keeper.env"
    _write_dotenv(dotenv, surfnet, payer)
    program_id = built

    loaded = _keeper(
        ["program:load", "--", str(SO), program_id],
        dotenv,
        timeout=120,
    )
    _check(loaded, "program:load")

    session_a = tmp_path / "session-a.json"
    created = _keeper(
        [
            "session:create",
            "--",
            "--deposit-window",
            "600",
            "--replay-window",
            "3600",
            "--seed",
            "90,100,90,100",
            "--session-id",
            "1001",
            "--out",
            str(session_a),
        ],
        dotenv,
        timeout=180,
    )
    _check(created, "session:create")

    # lock_and_start returns PastDeadline once deposit_deadline has passed.
    locked = _keeper(
        ["admin", "--", "lock", "--session-file", str(session_a)],
        dotenv,
        timeout=120,
    )
    lock_out = _check(locked, "admin lock")
    assert "running" in lock_out

    started = time.perf_counter()
    replay = _keeper(
        [
            "replay",
            "--",
            "--interval-ms",
            "2000",
            "--session-file",
            str(session_a),
        ],
        dotenv,
        timeout=600,
    )
    wall_ms = int((time.perf_counter() - started) * 1000)
    replay_out = _check(replay, "replay")
    assert "48 of 48 posted" in replay_out
    assert "equals C_N" in replay_out
    print(f"KEEPER_REPLAY_WALL_CLOCK_MS={wall_ms}")
    print("KEEPER_REPLAY_INTERVAL_MS=2000")
    print("KEEPER_REPLAY_ZERO_MS=skipped; keeper minimum interval is 2000 ms")

    again = _keeper(
        ["replay", "--", "--interval-ms", "2000", "--session-file", str(session_a)],
        dotenv,
        timeout=120,
    )
    again_out = _check(again, "replay again")
    assert "already posted" in again_out

    settled = _keeper(
        ["admin", "--", "settle", "--session-file", str(session_a)],
        dotenv,
        timeout=120,
    )
    _check(settled, "admin settle")
    status = _keeper(
        ["admin", "--", "status", "--session-file", str(session_a)],
        dotenv,
        timeout=60,
    )
    status_out = _check(status, "admin status")
    assert "827387" in status_out
    assert "863980" in status_out

    # Recovery drill on a second session: 20 rows, then resume at row 20.
    session_b = tmp_path / "session-b.json"
    created_b = _keeper(
        [
            "session:create",
            "--",
            "--deposit-window",
            "600",
            "--replay-window",
            "3600",
            "--seed",
            "90,100,90,100",
            "--session-id",
            "1002",
            "--out",
            str(session_b),
        ],
        dotenv,
        timeout=180,
    )
    _check(created_b, "session:create recovery")
    locked_b = _keeper(
        ["admin", "--", "lock", "--session-file", str(session_b)],
        dotenv,
        timeout=120,
    )
    _check(locked_b, "admin lock recovery")

    first = _keeper(
        [
            "replay",
            "--",
            "--interval-ms",
            "2000",
            "--limit",
            "20",
            "--session-file",
            str(session_b),
        ],
        dotenv,
        timeout=240,
    )
    first_out = _check(first, "replay limit 20")
    assert "resuming at row 0 of 48" in first_out
    assert "stopped at row 20 of 48" in first_out
    first_rows = _posted_rows(first_out)
    assert first_rows == list(range(20)), first_rows

    second = _keeper(
        [
            "replay",
            "--",
            "--interval-ms",
            "2000",
            "--session-file",
            str(session_b),
        ],
        dotenv,
        timeout=400,
    )
    second_out = _check(second, "replay resume")
    assert "resuming at row 20 of 48" in second_out
    assert "48 of 48 posted" in second_out
    second_rows = _posted_rows(second_out)
    assert second_rows == list(range(20, 48)), second_rows
    print(f"KEEPER_RECOVERY_FIRST_ROWS={len(first_rows)}")
    print(f"KEEPER_RECOVERY_SECOND_ROWS={len(second_rows)}")
