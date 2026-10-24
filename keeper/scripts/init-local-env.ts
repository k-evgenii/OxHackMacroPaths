/**
 * Create a throwaway keypair and an env file pointing at a LOCAL validator.
 *
 *   npm run tsx scripts/init-local-env.ts <dir> [rpcUrl]
 *
 * Writes <dir>/keeper-local.json and <dir>/local.env. Then run scripts with
 * DOTENV_PATH=<dir>/local.env. Keep <dir> outside the repo.
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { Keypair } from "@solana/web3.js";

const dir = process.argv[2];
const rpcUrl = process.argv[3] ?? "http://127.0.0.1:8899";
if (!dir) {
  console.error("usage: init-local-env.ts <dir> [rpcUrl]");
  process.exit(2);
}
const abs = path.resolve(dir);
mkdirSync(abs, { recursive: true });
const kpPath = path.join(abs, "keeper-local.json");
if (!existsSync(kpPath)) {
  writeFileSync(kpPath, JSON.stringify(Array.from(Keypair.generate().secretKey)), { mode: 0o600 });
}
const envPath = path.join(abs, "local.env");
writeFileSync(envPath, `RPC_URL=${rpcUrl}\nKEEPER_KEYPAIR=${kpPath}\n`, { mode: 0o600 });
console.log(`wrote ${envPath} and ${kpPath}`);
