import assert from "node:assert/strict";
import * as anchor from "@anchor-lang/core";
import { Program } from "@anchor-lang/core";
import { Macropaths } from "../target/types/macropaths";

describe("macropaths", () => {
  anchor.setProvider(anchor.AnchorProvider.env());

  const program = anchor.workspace.macropaths as Program<Macropaths>;

  it("loads an IDL with 14 instructions", () => {
    assert.equal(program.idl?.instructions.length, 14);
  });
});
