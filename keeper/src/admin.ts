/**
 * Session admin (task 16): seed, lock, settle and status for the session in data/session.json.
 *
 *   pixi run npm --prefix keeper run admin -- <seed|lock|settle|status> [options]
 *
 *   --amounts <a,b,c,d>    seed: PLAY per side (default 90,100,90,100; side order as in Session)
 *   --idl <file>           program IDL (default packages/client/idl.json)
 *   --session-file <file>  default data/session.json
 *
 * Every command reads the session first and sends nothing if the step is already done.
 */
import { parseArgs } from "node:util";
import {
  DEFAULT_SEED,
  describeSession,
  fetchSession,
  loadCtx,
  lockSession,
  parseSides,
  seedSides,
  settleSession,
} from "./ops.js";
import { parsePlay } from "./program.js";

const { values: args, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    amounts: { type: "string", default: DEFAULT_SEED },
    idl: { type: "string" },
    "session-file": { type: "string" },
  },
});

async function main(): Promise<number> {
  const cmd = positionals[0];
  if (!cmd || !["seed", "lock", "settle", "status"].includes(cmd)) {
    console.error("usage: admin.ts <seed|lock|settle|status> [--amounts a,b,c,d] [--idl f] [--session-file f]");
    return 2;
  }
  const ctx = loadCtx({ idl: args.idl, sessionFile: args["session-file"] });
  console.log(`session ${ctx.session.toBase58()}`);
  if (cmd === "seed") await seedSides(ctx, parseSides(args.amounts, parsePlay));
  if (cmd === "lock") await lockSession(ctx);
  if (cmd === "settle") await settleSession(ctx);
  for (const line of describeSession(await fetchSession(ctx))) console.log(line);
  return 0;
}

main().then(
  (code) => process.exit(code),
  (e: unknown) => {
    console.error(`error: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  },
);
