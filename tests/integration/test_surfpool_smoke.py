"""Opt-in: `pixi run test-surfpool`. Builds the repo program, deploys it to a local Surfnet and calls it.

Proves: anchor build works, Surfpool starts offline, the program deploys and is executable, and the
Anchor TS client (tests/integration/initialize.test.ts) can call `initialize` on it.
"""
import json
import os
import signal
import subprocess
import time
import urllib.request

import pytest

from conftest import ROOT, free_port, run

pytestmark = pytest.mark.surfpool

PROGRAM_KEYPAIR = ROOT / "target/deploy/macropaths-keypair.json"


def rpc(url, method, params=None):
    body = json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params or []}).encode()
    req = urllib.request.Request(url, body, {"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=10) as resp:
        return json.load(resp)


def declared_id():
    for line in (ROOT / "programs/macropaths/src/lib.rs").read_text().splitlines():
        if line.startswith("declare_id!"):
            return line.split('"')[1]
    raise AssertionError("no declare_id! in lib.rs")


@pytest.fixture(scope="module")
def built():
    r = run(["anchor", "build"], cwd=ROOT, timeout=900)
    assert r.returncode == 0, r.stdout[-2000:] + r.stderr[-2000:]
    keypair_id = run(["solana-keygen", "pubkey", str(PROGRAM_KEYPAIR)]).stdout.strip()
    if keypair_id != declared_id():
        pytest.skip(
            f"program keypair {keypair_id} != declare_id! {declared_id()}: get the program keypair from the "
            "program owner, or run `anchor keys sync` locally and do not commit the change"
        )
    return keypair_id


@pytest.fixture(scope="module")
def surfnet(tmp_path_factory):
    port = free_port()  # the Solana CLI expects the websocket on RPC port + 1
    log = (tmp_path_factory.mktemp("surfpool") / "surfpool.log").open("w")
    proc = subprocess.Popen(
        ["surfpool", "start", "--offline", "--no-deploy", "--no-tui", "--no-studio", "--ci", "--yes",
         "--port", str(port), "--ws-port", str(port + 1)],
        stdout=log, stderr=subprocess.STDOUT, start_new_session=True,
        cwd=tmp_path_factory.mktemp("surfpool-cwd"),
    )
    url = f"http://127.0.0.1:{port}"
    try:
        for _ in range(60):
            assert proc.poll() is None, f"surfpool exited early, see {log.name}"
            try:
                if rpc(url, "getHealth").get("result") == "ok":
                    break
            except OSError:
                pass
            time.sleep(1)
        else:
            pytest.fail(f"surfpool not healthy after 60s, see {log.name}")
        yield url
    finally:
        os.killpg(proc.pid, signal.SIGTERM)
        try:
            proc.wait(timeout=15)
        except subprocess.TimeoutExpired:
            os.killpg(proc.pid, signal.SIGKILL)


@pytest.fixture(scope="module")
def payer(tmp_path_factory, surfnet):
    path = tmp_path_factory.mktemp("payer") / "payer.json"
    run(["solana-keygen", "new", "--no-bip39-passphrase", "--silent", "-o", str(path)])
    r = run(["solana", "airdrop", "10", "--url", surfnet, "--keypair", str(path)], timeout=60)
    assert r.returncode == 0, r.stderr
    return path


@pytest.fixture(scope="module")
def deployed(built, surfnet, payer):
    r = run(["solana", "program", "deploy", str(ROOT / "target/deploy/macropaths.so"), "--url", surfnet,
             "--keypair", str(payer), "--program-id", str(PROGRAM_KEYPAIR)], timeout=120)
    assert r.returncode == 0, r.stdout + r.stderr
    return built


def test_program_is_executable(deployed, surfnet):
    info = rpc(surfnet, "getAccountInfo", [deployed, {"encoding": "base64"}])["result"]["value"]
    assert info is not None and info["executable"] is True


def test_client_calls_initialize(deployed, surfnet, payer):
    env = {**os.environ, "ANCHOR_PROVIDER_URL": surfnet, "ANCHOR_WALLET": str(payer)}
    r = run(["npm", "run", "-s", "test:client"], cwd=ROOT, env=env, timeout=180)
    assert r.returncode == 0, r.stdout[-3000:] + r.stderr[-3000:]
