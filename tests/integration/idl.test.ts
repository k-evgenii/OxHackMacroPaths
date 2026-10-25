// Reads the IDL of the program deployed on the provider cluster.
// Started by test_surfpool_smoke.py, which sets ANCHOR_PROVIDER_URL and ANCHOR_WALLET.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { AnchorProvider, Program, setProvider, type Idl } from "@anchor-lang/core";

const idl = JSON.parse(readFileSync("target/idl/macropaths.json", "utf8")) as Idl;

describe("macropaths", () => {
  const provider = AnchorProvider.env();
  setProvider(provider);
  const program = new Program(idl, provider);

  it("reads 14 instructions from the deployed program IDL", async () => {
    const info = await provider.connection.getAccountInfo(program.programId);
    assert.ok(info?.executable, "program is not deployed");
    assert.equal(program.idl.instructions.length, 14);
  });
});
