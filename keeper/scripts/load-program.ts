/**
 * Load a built program (.so) into a LOCAL Surfpool at its declared address, without the program
 * keypair, via the surfnet_writeProgram cheatcode.
 *
 *   DOTENV_PATH=/tmp/keeper-local/local.env pixi run npm --prefix keeper run program:load -- <so> <programId>
 *
 * Only for local testing: refuses to run unless RPC_URL points at localhost.
 */
import { readFileSync } from "node:fs";
import { PublicKey } from "@solana/web3.js";
import { getConfig, getConnection } from "../src/env.js";

const [so, id] = process.argv.slice(2);
if (!so || !id) {
  console.error("usage: load-program.ts <program.so> <programId>");
  process.exit(2);
}
const cfg = getConfig();
if (!["127.0.0.1", "localhost", "::1", "[::1]"].includes(cfg.rpcHost)) {
  console.error(`refusing to run: RPC_URL host is ${cfg.rpcHost}, expected a local Surfpool`);
  process.exit(2);
}
const programId = new PublicKey(id);
const elf = readFileSync(so);
const CHUNK = 1 << 20; // 1 MiB of bytes = 2 MiB of hex, under Surfpool's 5 MB RPC limit

for (let offset = 0; offset < elf.length; offset += CHUNK) {
  const res = await fetch(cfg.RPC_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "surfnet_writeProgram",
      params: [programId.toBase58(), elf.subarray(offset, offset + CHUNK).toString("hex"), offset],
    }),
  });
  const body = (await res.json()) as { error?: { message?: string } };
  if (body.error) throw new Error(`surfnet_writeProgram at offset ${offset}: ${body.error.message ?? "error"}`);
}
const info = await getConnection().getAccountInfo(programId);
if (!info?.executable) throw new Error(`${programId.toBase58()} is not executable after loading`);
console.log(`loaded ${elf.length} bytes at ${programId.toBase58()} (owner ${info.owner.toBase58()})`);
