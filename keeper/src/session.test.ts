// Run: npx tsx --test keeper/src/session.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Keypair, PublicKey, SystemProgram, SYSVAR_RENT_PUBKEY } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import anchor, { type Idl } from "@anchor-lang/core";

import {
  compareSession,
  createSessionArgs,
  createSessionIx,
  createSessionKeys,
  checkIdl,
  expectedSession,
  flatten,
  parseReplay,
  sessionPda,
  vaultPda,
  type SessionInputs,
} from "./session.js";

const { BorshCoder } = anchor;
const PROGRAM = "FvT786RtMTtbdXWemA9zgA9rfwhvxFsKY1ypiMMNwMbS";
const DISC = [242, 193, 143, 179, 150, 25, 122, 227];
const meta = { name: "macropaths", version: "0.1.0", spec: "0.1.0" };
const hash = { array: ["u8", 32] };

// create_session as in cursor_main's IDL.
const flatIdl = {
  address: PROGRAM,
  metadata: meta,
  instructions: [
    {
      name: "create_session",
      discriminator: DISC,
      accounts: [
        { name: "authority", writable: true, signer: true },
        { name: "session", writable: true },
        { name: "play_mint" },
        { name: "vault_0", writable: true },
        { name: "vault_1", writable: true },
        { name: "token_program" },
        { name: "system_program" },
        { name: "rent" },
      ],
      args: [
        { name: "session_id", type: "u64" },
        { name: "k", type: "i64" },
        { name: "d_cap", type: "i64" },
        { name: "a_cap", type: "i64" },
        { name: "deposit_deadline", type: "i64" },
        { name: "replay_deadline", type: "i64" },
        { name: "dataset_id", type: hash },
        { name: "c0", type: hash },
        { name: "terminal", type: hash },
      ],
    },
  ],
} as unknown as Idl;

// Replay values from the committed vectors (the same numbers prepare.ts writes to cpi-yoy-replay.json).
const vectors = JSON.parse(readFileSync(new URL("../../tests/vectors.json", import.meta.url), "utf8"));
const c = vectors.commitment;
const replay = parseReplay({
  format: "macropaths-replay-v1",
  dataset_id: c.dataset_id,
  C_0: c.C_0,
  C_N: c.C_N,
  N: c.N,
  first_period_id: c.first_period_id,
  K: c.K,
  D_cap: c.D_cap,
  A_cap: c.A_cap,
  source: { series_id: c.series_id, sha256_of_raw: vectors.provenance.sha256_of_raw },
});

const creator = Keypair.generate().publicKey;
const inputs: SessionInputs = {
  id: 1_729_790_000n,
  creator,
  mint: Keypair.generate().publicKey,
  depositDeadline: 1_729_790_600n,
  replayDeadline: 1_729_794_200n,
};

test("parseReplay: reads the committed v1 values", () => {
  assert.equal(replay.datasetId.toString("hex"), "328f498b394e988f88f763947e0c656cb0e988321c3f66228c8549946401143e");
  assert.equal(replay.c0.toString("hex"), "fdae7619c863f7802333c08e1e66f5ef0001aaae4ad02334b36e6a919d64768a");
  assert.equal(replay.cN.toString("hex"), "b5a06c8e2aa10b7fe1339666afb92af7a30cf98e318efde9acdc4a6c5733abef");
  assert.equal(replay.n, 48);
  assert.deepEqual([replay.k, replay.dCap, replay.aCap], [40_000n, 80_000n, 800_000n]);
  assert.throws(() => parseReplay({ format: "other" }), /format/);
  assert.throws(() => parseReplay({ format: "macropaths-replay-v1", dataset_id: "00" }), /dataset_id/);
});

test("checkIdl: accepts cursor_main's create_session, rejects anything else", () => {
  checkIdl(flatIdl);
  const odd = structuredClone(flatIdl) as any;
  odd.instructions[0].args = [{ name: "nonce", type: "u64" }, { name: "params", type: "u8" }];
  assert.throws(() => checkIdl(odd), /unexpected create_session args: nonce, params/);
  assert.throws(() => checkIdl({ ...flatIdl, instructions: [] } as Idl), /no create_session/);
});

test("PDAs: session and vault seeds", () => {
  const program = new PublicKey(PROGRAM);
  const le = Buffer.alloc(8);
  le.writeBigUInt64LE(inputs.id);
  const [s] = sessionPda(program, creator, inputs.id);
  assert.ok(s.equals(PublicKey.findProgramAddressSync([Buffer.from("session"), creator.toBuffer(), le], program)[0]));
  const [v1] = vaultPda(program, s, 1);
  assert.ok(v1.equals(PublicKey.findProgramAddressSync([Buffer.from("vault"), s.toBuffer(), Buffer.from([1])], program)[0]));
});

test("create_session instruction round-trips through the coder with replay values", () => {
  const ix = createSessionIx(flatIdl, replay, inputs);
  const dec = new BorshCoder(flatIdl).instruction.decode(ix.data);
  assert.equal(dec?.name, "create_session");
  const got = flatten(dec?.data);
  assert.deepEqual(got, {
    session_id: "1729790000",
    k: "40000",
    d_cap: "80000",
    a_cap: "800000",
    deposit_deadline: "1729790600",
    replay_deadline: "1729794200",
    dataset_id: c.dataset_id,
    c0: c.C_0,
    terminal: c.C_N,
  });
});

test("createSessionKeys: IDL order, flags and addresses", () => {
  const program = new PublicKey(PROGRAM);
  const [s] = sessionPda(program, creator, inputs.id);
  const flat = createSessionKeys(flatIdl, inputs);
  assert.deepEqual(
    flat.map((k) => k.pubkey.toBase58()),
    [creator, s, inputs.mint, vaultPda(program, s, 0)[0], vaultPda(program, s, 1)[0], TOKEN_PROGRAM_ID, SystemProgram.programId, SYSVAR_RENT_PUBKEY].map((p) => p.toBase58()),
  );
  assert.deepEqual(flat[0], { pubkey: creator, isSigner: true, isWritable: true });
  assert.equal(flat[2]?.isWritable, false);
  const odd = structuredClone(flatIdl) as any;
  odd.instructions[0].accounts.push({ name: "oracle" });
  assert.throws(() => createSessionKeys(odd, inputs), /unknown account oracle/);
});

test("expectedSession + compareSession: match, mismatch and missing fields", () => {
  const exp = expectedSession(flatIdl, replay, inputs);
  assert.equal(exp["commitment"], c.C_0);
  assert.equal(exp["state"], "open");
  assert.equal(exp["n_obs"], "48");
  // A decoded account is flattened the same way, enums as { Variant: {} }.
  const decoded = flatten({ ...Object.fromEntries(Object.entries(exp)), state: { Open: {} } });
  assert.ok(compareSession(exp, decoded).every((x) => x.ok));
  const bad = compareSession(exp, { ...decoded, k: "0" });
  assert.deepEqual(bad.filter((x) => !x.ok).map((x) => x.field), ["k"]);
  const { authority: _, ...missing } = decoded;
  assert.equal(compareSession(exp, missing).find((x) => x.field === "authority")?.actual, undefined);
});
