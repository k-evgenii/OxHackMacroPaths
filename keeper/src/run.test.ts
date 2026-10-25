// Run: npx tsx --test keeper/src/run.test.ts
//
// session:create is a script (run.ts runs main() on import), so it is driven as a child process
// with an RPC_URL nothing listens on. The overwrite guard must fire before any cluster access,
// so a refusal is the only way the command can exit without a connection error.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Keypair } from "@solana/web3.js";
import { writeSessionFile } from "./program.js";

const keeperDir = fileURLToPath(new URL("..", import.meta.url));
const tsx = path.join(keeperDir, "node_modules", ".bin", "tsx");

const dir = mkdtempSync(path.join(tmpdir(), "keeper-run-test-"));
const keeperKeypair = path.join(dir, "keeper.json");
writeFileSync(keeperKeypair, JSON.stringify(Array.from(Keypair.generate().secretKey)));
writeFileSync(path.join(dir, "empty.env"), "");
const outFile = path.join(dir, "session.json");
const prevSession = Keypair.generate().publicKey.toBase58();
writeSessionFile(outFile, {
  programId: "FvT786RtMTtbdXWemA9zgA9rfwhvxFsKY1ypiMMNwMbS",
  session: prevSession,
  vaults: [Keypair.generate().publicKey.toBase58(), Keypair.generate().publicKey.toBase58()],
  mint: Keypair.generate().publicKey.toBase58(),
  sessionId: "1001",
  creator: Keypair.generate().publicKey.toBase58(),
  depositDeadline: "1729790600",
  replayDeadline: "1729794200",
  createSignature: null,
});

/** session:create with --out pointing at the existing file and a replay file that does not exist. */
function sessionCreate(extra: string[]): { status: number | null; out: string } {
  const r = spawnSync(tsx, ["src/run.ts", "--out", outFile, "--replay", path.join(dir, "missing-replay.json"), ...extra], {
    cwd: keeperDir,
    encoding: "utf8",
    timeout: 120_000,
    env: {
      ...process.env,
      DOTENV_PATH: path.join(dir, "empty.env"),
      RPC_URL: "http://127.0.0.1:1",
      KEEPER_KEYPAIR: keeperKeypair,
    },
  });
  return { status: r.status, out: `${r.stdout}${r.stderr}` };
}

const REFUSAL = /already describes session/;

test("session:create refuses to replace an existing --out file without --session-id or --force", () => {
  const r = sessionCreate([]);
  assert.notEqual(r.status, 0, r.out);
  assert.match(r.out, REFUSAL, r.out);
  assert.match(r.out, new RegExp(`session ${prevSession} \\(session_id 1001\\)`), r.out);
  assert.match(r.out, /--session-id 1001/, r.out);
  assert.match(r.out, /--force/, r.out);
  // It stopped before the replay file was read or the cluster was contacted.
  assert.doesNotMatch(r.out, /missing-replay|ECONNREFUSED|fetch failed/, r.out);
});

test("session:create proceeds past the guard with --force or an explicit --session-id", () => {
  for (const extra of [["--force"], ["--session-id", "1001"]]) {
    const r = sessionCreate(extra);
    assert.doesNotMatch(r.out, REFUSAL, `${extra.join(" ")}: ${r.out}`);
    // The next step is loading the replay file, which this test deliberately points at nothing.
    assert.notEqual(r.status, 0, r.out);
    assert.match(r.out, /missing-replay\.json/, `${extra.join(" ")}: ${r.out}`);
  }
});
