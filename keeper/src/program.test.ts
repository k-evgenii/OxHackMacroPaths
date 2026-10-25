// Run: npx tsx --test keeper/src/program.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { Keypair, PublicKey } from "@solana/web3.js";
import anchor, { type Idl } from "@anchor-lang/core";

import { readFileSync } from "node:fs";
import { accountMetas, big, enumName, instruction, parsePlay, play, positionPda, requireProgram, type SessionFile } from "./program.js";
import { DEFAULT_SEED, describeSession, parseSides, vaultLine } from "./ops.js";

const { BN, BorshCoder } = anchor;
const PROGRAM = "FvT786RtMTtbdXWemA9zgA9rfwhvxFsKY1ypiMMNwMbS";

// deposit and lock_and_start as in cursor_main's IDL.
const idl = {
  address: PROGRAM,
  metadata: { name: "macropaths", version: "0.1.0", spec: "0.1.0" },
  instructions: [
    {
      name: "deposit",
      discriminator: [242, 35, 198, 137, 82, 225, 242, 182],
      accounts: [
        { name: "owner", writable: true, signer: true },
        { name: "session", writable: true },
        { name: "position", writable: true },
        { name: "owner_ta", writable: true },
        { name: "vault_0", writable: true },
        { name: "vault_1", writable: true },
        { name: "token_program" },
        { name: "system_program" },
      ],
      args: [{ name: "amounts", type: { array: ["u64", 4] } }],
    },
    {
      name: "lock_and_start",
      discriminator: [1, 2, 3, 4, 5, 6, 7, 8],
      accounts: [{ name: "authority", signer: true }, { name: "session", writable: true }],
      args: [],
    },
  ],
} as unknown as Idl;

test("describeSession names scores, budgets, claims and the four side totals", () => {
  const vectors = JSON.parse(readFileSync(new URL("../../tests/vectors.json", import.meta.url), "utf8"));
  const sides = parseSides(DEFAULT_SEED, parsePlay);
  const s1 = BigInt(vectors.final.s1);
  const s2 = BigInt(vectors.final.s2);
  const n = Number(vectors.commitment.N);
  const text = describeSession({
    state: { Settled: {} },
    next_index: n,
    n_obs: n,
    side_totals: sides,
    matched: [sides[0], sides[2]],
    scores: [s1, s2],
    p_budget: sides,
    r_budget: sides,
    position_count: 1,
    claimed_count: 1,
  }).join("\n");
  const scoreLine = `${(Number(s1) / 1e6).toFixed(6)}, ${(Number(s2) / 1e6).toFixed(6)}`;
  assert.match(text, new RegExp(`scores\\s+${scoreLine.replaceAll(".", "\\.")}`));
  assert.match(text, /side totals\s+90, 100, 90, 100 PLAY/);
  assert.match(text, /p_budget\s+90, 100, 90, 100 PLAY/);
  assert.match(text, /r_budget\s+90, 100, 90, 100 PLAY/);
  assert.match(text, /claimed_count\/position_count 1\/1/);
  assert.equal(vaultLine(0n, 0n), "vaults       0, 0 PLAY");
});

test("play / parsePlay: 6-decimal base units", () => {
  assert.equal(play(90_000_000n), "90");
  assert.equal(play(148_929_660n), "148.92966");
  assert.equal(play(1n), "0.000001");
  assert.equal(play(-10_500_000n), "-10.5");
  assert.equal(parsePlay("90"), 90_000_000n);
  assert.equal(parsePlay("0.5"), 500_000n);
  assert.equal(parsePlay("1.000001"), 1_000_001n);
  assert.throws(() => parsePlay("1.0000001"));
  assert.throws(() => parsePlay("-1"));
  assert.deepEqual(parseSides("90,100,90,100", parsePlay), [90_000_000n, 100_000_000n, 90_000_000n, 100_000_000n]);
  assert.throws(() => parseSides("90,100", parsePlay), /4 comma-separated/);
});

test("enumName and big", () => {
  assert.equal(enumName({ Running: {} }), "running");
  assert.equal(enumName({ open: {} }), "open");
  assert.throws(() => enumName(3));
  assert.equal(big(new BN("18446744073709551615")), 18446744073709551615n);
  assert.equal(big(7), 7n);
  assert.throws(() => big("7"));
});

test("instruction: deposit encodes amounts with accounts in IDL order", () => {
  const owner = Keypair.generate().publicKey;
  const session = Keypair.generate().publicKey;
  const [position] = positionPda(new PublicKey(PROGRAM), session, owner);
  assert.ok(position.equals(PublicKey.findProgramAddressSync([Buffer.from("position"), session.toBuffer(), owner.toBuffer()], new PublicKey(PROGRAM))[0]));
  const known = Object.fromEntries(
    ["owner_ta", "vault_0", "vault_1", "token_program", "system_program"].map((k) => [k, Keypair.generate().publicKey]),
  );
  const ix = instruction(idl, "deposit", { amounts: [1n, 2n, 3n, 4n].map((v) => new BN(v.toString())) }, { ...known, owner, session, position, extra: owner });
  assert.equal(ix.keys.length, 8);
  assert.ok(ix.keys[0]!.pubkey.equals(owner) && ix.keys[0]!.isSigner && ix.keys[0]!.isWritable);
  assert.ok(ix.keys[2]!.pubkey.equals(position));
  const dec = new BorshCoder(idl).instruction.decode(ix.data);
  assert.deepEqual((dec?.data as any).amounts.map((b: any) => b.toString()), ["1", "2", "3", "4"]);
  assert.throws(() => accountMetas(idl, "lock_and_start", { session }), /unknown account authority/);
  assert.throws(() => accountMetas(idl, "nope", {}), /no nope instruction/);
});

test("requireProgram: session file must be for the IDL's program", () => {
  const f = { programId: PROGRAM } as unknown as SessionFile;
  requireProgram(idl, f);
  assert.throws(() => requireProgram(idl, { ...f, programId: "x" }), /session file is for program x/);
});
