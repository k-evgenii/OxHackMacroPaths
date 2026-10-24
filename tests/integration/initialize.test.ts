// Calls `initialize` through the Anchor TS client against a running validator.
// Started by test_surfpool_smoke.py, which sets ANCHOR_PROVIDER_URL and ANCHOR_WALLET.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { AnchorProvider, Program, setProvider, type Idl } from "@anchor-lang/core";

const idl = JSON.parse(readFileSync("target/idl/macropaths.json", "utf8")) as Idl;

describe("macropaths", () => {
  const provider = AnchorProvider.env();
  setProvider(provider);
  const program = new Program(idl, provider);

  it("initialize confirms and logs the greeting", async () => {
    const sig = await program.methods.initialize().rpc({ commitment: "confirmed" });
    const tx = await provider.connection.getTransaction(sig, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0,
    });
    assert.equal(tx?.meta?.err, null);
    assert.ok(tx?.meta?.logMessages?.some((l) => l.includes("Greetings from")), "missing greeting log");
  });
});
