// Run: npx tsx --test keeper/src/seller.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Keypair, PublicKey } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import anchor, { type Idl } from "@anchor-lang/core";
import {
  claimCoverIx,
  clampQuote,
  coverAddress,
  decimalToMillionths,
  pricesFromForecast,
  QUOTE_MAX,
  QUOTE_MIN,
} from "./seller.js";

const { BorshCoder } = anchor;

// The program's own IDL: claim_cover is only ever built from it, so the test uses it as-is.
const idl = JSON.parse(readFileSync(new URL("../../packages/client/idl.json", import.meta.url), "utf8")) as Idl;

test("clampQuote: V + floor(sigma/2), bounded by 0.05 and 0.95", () => {
  assert.equal(QUOTE_MIN, 50_000n);
  assert.equal(QUOTE_MAX, 950_000n);
  assert.equal(decimalToMillionths("0.40"), 400_000n);
  assert.equal(decimalToMillionths("0.2"), 200_000n);
  assert.equal(decimalToMillionths("0.1234567"), 123_456n);
  assert.equal(clampQuote(400_000n, 200_000n), 500_000n);
  assert.equal(clampQuote(0n, 0n), QUOTE_MIN);
  assert.equal(clampQuote(900_000n, 200_000n), QUOTE_MAX);
});

test("pricesFromForecast: row 0, both products", () => {
  assert.deepEqual(pricesFromForecast([{ V: "0.40", sigma: "0.20" }]), [500_000n, 500_000n]);
  assert.deepEqual(pricesFromForecast({ rows: [{ V: 0.01, sigma: 0 }] }), [QUOTE_MIN, QUOTE_MIN]);
  assert.throws(() => pricesFromForecast([]), /no row 0/);
  assert.throws(() => pricesFromForecast([{ mean: "0.4" }]), /V and sigma/);
});

test("claimCoverIx: IDL account order, cover PDA, owner is the only signer", () => {
  const program = new PublicKey(idl.address);
  const session = Keypair.generate().publicKey;
  const owner = Keypair.generate().publicKey;
  const ownerTa = Keypair.generate().publicKey;
  const v0 = Keypair.generate().publicKey;
  const v1 = Keypair.generate().publicKey;
  const ix = claimCoverIx(idl, session, owner, ownerTa, [v0, v1]);
  const cover = PublicKey.findProgramAddressSync([Buffer.from("cover"), session.toBuffer(), owner.toBuffer()], program)[0];
  assert.ok(coverAddress(program, session, owner).equals(cover));

  const spec = idl.instructions.find((i) => i.name === "claim_cover");
  assert.ok(spec, "IDL has claim_cover");
  assert.deepEqual(
    spec.accounts.map((a) => a.name),
    ["owner", "session", "cover", "owner_ta", "vault_0", "vault_1", "token_program"],
  );
  assert.ok(ix.programId.equals(program));
  assert.deepEqual(
    ix.keys.map((k) => k.pubkey.toBase58()),
    [owner, session, cover, ownerTa, v0, v1, TOKEN_PROGRAM_ID].map((k) => k.toBase58()),
  );
  assert.deepEqual(
    ix.keys.map((k) => [k.isSigner, k.isWritable]),
    [[true, false], [false, true], [false, true], [false, true], [false, true], [false, true], [false, false]],
  );
  // No args: the data is just the 8-byte discriminator from the IDL.
  assert.deepEqual([...ix.data], spec.discriminator);
  assert.equal(new BorshCoder(idl).instruction.decode(ix.data)?.name, "claim_cover");
});
