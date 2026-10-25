/**
 * Session admin: seed, lock, settle, expire, claim, sweep and status for the session in data/session.json.
 *
 *   pixi run npm --prefix keeper run admin -- <seed|lock|settle|status|expire|sweep|claim|seller> [options]
 *
 *   --amounts <a,b,c,d>    seed: PLAY per side (default 90,100,90,100; side order as in Session)
 *   --idl <file>           program IDL (default packages/client/idl.json)
 *   --session-file <file>  default data/session.json
 *   --treasury <pubkey>    sweep: receives the vault dust (PLAY account created if missing)
 *   --keypair <file>       claim: position owner (default: the keeper from .env). seller buy: buyer.
 *                          seller claim-cover: cover owner
 *   seller fund <PLAY>
 *   seller quote --p0 <millionths> --p1 <millionths> [--from-forecast forecast/table.json]
 *   seller buy --product <0|1> --units <PLAY> --keypair <file>
 *   seller claim-cover --keypair <file>    (after settle; sweep needs every cover claimed)
 *   seller settle --product <0|1>
 *   seller withdraw <PLAY>
 *
 * Every command reads the session first and sends nothing if the step is already done.
 */
import path from "node:path";
import { existsSync } from "node:fs";
import { parseArgs } from "node:util";
import { PublicKey } from "@solana/web3.js";
import { expandHome, loadKeypair } from "./env.js";
import {
  DEFAULT_SEED,
  claimPosition,
  expireSession,
  loadCtx,
  lockSession,
  parseSides,
  seedSides,
  settleSession,
  statusLines,
  sweepDust,
  type Ctx,
} from "./ops.js";
import { parsePlay } from "./program.js";
import { buyCover, claimCover, fundSeller, loadForecastPrices, quoteSeller, settleSeller, withdrawSeller } from "./seller.js";

const USAGE =
  "usage: admin.ts <seed|lock|settle|status|expire|sweep|claim|seller> [--amounts a,b,c,d] [--idl f] [--session-file f] [--treasury <pubkey>] [--keypair <file>]";

const { values: args, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    amounts: { type: "string", default: DEFAULT_SEED },
    idl: { type: "string" },
    "session-file": { type: "string" },
    treasury: { type: "string" },
    keypair: { type: "string" },
    p0: { type: "string" },
    p1: { type: "string" },
    "from-forecast": { type: "string" },
    product: { type: "string" },
    units: { type: "string" },
  },
});

function keypairPath(raw: string, repoRoot: string): string {
  const expanded = expandHome(raw);
  return path.isAbsolute(expanded) ? expanded : path.resolve(repoRoot, expanded);
}

function parseMillionths(s: string, which: string): bigint {
  if (!/^\d+$/.test(s.trim())) throw new Error(`${which} must be millionths, got ${s}`);
  return BigInt(s.trim());
}

function parseProduct(s: string | undefined): 0 | 1 {
  if (s !== "0" && s !== "1") throw new Error("product must be 0 or 1");
  return s === "0" ? 0 : 1;
}

async function runSeller(ctx: Ctx): Promise<number> {
  const sub = positionals[1];
  if (sub === "fund") {
    const amount = positionals[2];
    if (!amount) {
      console.error("usage: admin.ts seller fund <PLAY>");
      return 2;
    }
    await fundSeller(ctx, parsePlay(amount));
    return 0;
  }
  if (sub === "quote") {
    let p0: bigint;
    let p1: bigint;
    const forecast = args["from-forecast"];
    if (forecast) {
      const file = path.resolve(ctx.repoRoot, forecast);
      if (existsSync(file)) {
        [p0, p1] = loadForecastPrices(file);
      } else if (args.p0 && args.p1) {
        p0 = parseMillionths(args.p0, "p0");
        p1 = parseMillionths(args.p1, "p1");
      } else {
        throw new Error(`${file} not found; pass --p0 and --p1`);
      }
    } else if (args.p0 && args.p1) {
      p0 = parseMillionths(args.p0, "p0");
      p1 = parseMillionths(args.p1, "p1");
    } else {
      console.error("usage: admin.ts seller quote --p0 <millionths> --p1 <millionths> [--from-forecast <file>]");
      return 2;
    }
    await quoteSeller(ctx, p0, p1);
    return 0;
  }
  if (sub === "buy") {
    if (!args.units || !args.keypair) {
      console.error("usage: admin.ts seller buy --product <0|1> --units <PLAY> --keypair <file>");
      return 2;
    }
    await buyCover(ctx, parseProduct(args.product), parsePlay(args.units), loadKeypair(keypairPath(args.keypair, ctx.repoRoot)));
    return 0;
  }
  if (sub === "claim-cover" || sub === "claim") {
    if (!args.keypair) {
      console.error("usage: admin.ts seller claim-cover --keypair <file>");
      return 2;
    }
    await claimCover(ctx, loadKeypair(keypairPath(args.keypair, ctx.repoRoot)));
    return 0;
  }
  if (sub === "settle") {
    await settleSeller(ctx, parseProduct(args.product));
    return 0;
  }
  if (sub === "withdraw") {
    const amount = positionals[2];
    if (!amount) {
      console.error("usage: admin.ts seller withdraw <PLAY>");
      return 2;
    }
    await withdrawSeller(ctx, parsePlay(amount));
    return 0;
  }
  console.error("usage: admin.ts seller <fund|quote|buy|claim-cover|settle|withdraw>");
  return 2;
}

async function main(): Promise<number> {
  const cmd = positionals[0];
  if (!cmd || !["seed", "lock", "settle", "status", "expire", "sweep", "claim", "seller"].includes(cmd)) {
    console.error(USAGE);
    return 2;
  }
  if (cmd === "sweep" && !args.treasury) {
    console.error("usage: admin.ts sweep --treasury <pubkey>");
    return 2;
  }
  const ctx = loadCtx({ idl: args.idl, sessionFile: args["session-file"] });
  console.log(`session ${ctx.session.toBase58()}`);
  if (cmd === "seed") await seedSides(ctx, parseSides(args.amounts, parsePlay));
  if (cmd === "lock") await lockSession(ctx);
  if (cmd === "settle") await settleSession(ctx);
  if (cmd === "expire") await expireSession(ctx);
  if (cmd === "sweep") await sweepDust(ctx, new PublicKey(args.treasury!));
  if (cmd === "claim") {
    // No --keypair: the keeper's own position (the seeder), read from .env like every other command.
    await claimPosition(ctx, args.keypair ? loadKeypair(keypairPath(args.keypair, ctx.repoRoot)) : loadKeypair());
  }
  if (cmd === "seller") {
    const code = await runSeller(ctx);
    if (code !== 0) return code;
  }
  for (const line of await statusLines(ctx)) console.log(line);
  return 0;
}

main().then(
  (code) => process.exit(code),
  (e: unknown) => {
    console.error(`error: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  },
);
