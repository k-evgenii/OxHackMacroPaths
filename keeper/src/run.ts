/**
 * run.ts: part 1 (task 10) creates the PLAY mint, calls create_session with the parameters from
 * data/cpi-yoy-replay.json and reads every field of the new Session back; part 2 (task 16) seeds
 * the four sides from the keeper.
 *
 *   pixi run npm --prefix keeper run session:create -- [options]
 *
 *   --replay <file>          replay file from prepare.ts (default data/cpi-yoy-replay.json)
 *   --idl <file>             program IDL (default packages/client/idl.json)
 *   --session-id <u64>       nonce / session_id seed (default: the cluster's unix time)
 *   --mint <pubkey>          reuse an existing 6-decimal mint instead of creating one
 *   --deposit-window <secs>  deposit_deadline = cluster time + this (default 600)
 *   --replay-window <secs>   replay_deadline = deposit_deadline + this (default 3600)
 *   --out <file>             where to write the session addresses (default data/session.json)
 *   --seed <a,b,c,d|none>    PLAY per side to seed from the keeper (default 90,100,90,100)
 *   --force                  replace an existing --out file even without --session-id
 *
 * Re-running with the same --session-id after the session exists does not send anything: it
 * reads the inputs back from --out and repeats the field check, and seeding only tops the keeper's
 * position up to the targets. Exits 1 if any field differs (and then does not seed).
 *
 * Without --session-id the id is the cluster time, so every run would create a new session and
 * silently replace --out, which is the only record of the previous one. When --out already exists
 * and --session-id is not given, the command refuses before touching the cluster unless --force.
 */
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  type Connection,
} from "@solana/web3.js";
import {
  createInitializeMint2Instruction,
  getMinimumBalanceForRentExemptMint,
  getMint,
  MINT_SIZE,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { getConfig, getConnection, loadKeypair } from "./env.js";
import { sendAndConfirmWithRetry } from "./tx.js";
import {
  compareSession,
  createSessionIx,
  decodeSession,
  checkIdl,
  expectedSession,
  loadIdl,
  loadReplay,
  PLAY_DECIMALS,
  sessionPda,
  vaultPda,
  type SessionInputs,
} from "./session.js";
import { parsePlay, readSessionFile, writeSessionFile, type SessionFile } from "./program.js";
import { clusterTime, DEFAULT_SEED, describeSession, fetchSession, loadCtx, parseSides, seedSides } from "./ops.js";

async function createMint(connection: Connection, payer: Keypair): Promise<PublicKey> {
  const mint = Keypair.generate();
  const lamports = await getMinimumBalanceForRentExemptMint(connection);
  await sendAndConfirmWithRetry(
    connection,
    (blockhash) =>
      new Transaction({ feePayer: payer.publicKey, recentBlockhash: blockhash }).add(
        SystemProgram.createAccount({
          fromPubkey: payer.publicKey,
          newAccountPubkey: mint.publicKey,
          space: MINT_SIZE,
          lamports,
          programId: TOKEN_PROGRAM_ID,
        }),
        createInitializeMint2Instruction(mint.publicKey, PLAY_DECIMALS, payer.publicKey, null),
      ),
    [payer, mint],
    { label: "mint" },
  );
  return mint.publicKey;
}

function toInputs(f: SessionFile): SessionInputs {
  return {
    id: BigInt(f.sessionId),
    creator: new PublicKey(f.creator),
    mint: new PublicKey(f.mint),
    depositDeadline: BigInt(f.depositDeadline),
    replayDeadline: BigInt(f.replayDeadline),
  };
}

const { values: args } = parseArgs({
  options: {
    replay: { type: "string" },
    idl: { type: "string" },
    "session-id": { type: "string" },
    mint: { type: "string" },
    "deposit-window": { type: "string", default: "600" },
    "replay-window": { type: "string", default: "3600" },
    out: { type: "string" },
    seed: { type: "string", default: DEFAULT_SEED },
    force: { type: "boolean", default: false },
  },
});

/**
 * The refusal for an existing --out file when no --session-id was given, or null to proceed.
 * `prev` is that file's content. Pure; it runs before any cluster access (run.test.ts drives it through the CLI).
 */
function overwriteRefusal(
  outFile: string,
  prev: SessionFile | undefined,
  opts: { sessionId: string | undefined; force: boolean },
): string | null {
  if (opts.sessionId !== undefined || opts.force || !prev) return null;
  return (
    `${outFile} already describes session ${prev.session} (session_id ${prev.sessionId}); ` +
    `re-run with --session-id ${prev.sessionId} to re-check it, --out <other file> for a new session, ` +
    `or --force to replace it`
  );
}

async function main(): Promise<number> {
  const cfg = getConfig();
  const fromRoot = (p: string | undefined, dflt: string) => path.resolve(cfg.repoRoot, p ?? dflt);
  const replayFile = fromRoot(args.replay, "data/cpi-yoy-replay.json");
  const outFile = fromRoot(args.out, "data/session.json");

  // Refuse to replace an existing session file before anything is loaded or sent.
  const refusal = overwriteRefusal(
    path.relative(cfg.repoRoot, outFile),
    existsSync(outFile) ? readSessionFile(outFile) : undefined,
    { sessionId: args["session-id"], force: args.force },
  );
  if (refusal) throw new Error(refusal);

  const replay = loadReplay(replayFile);
  const idl = loadIdl(fromRoot(args.idl, "packages/client/idl.json"));
  checkIdl(idl);
  const programId = new PublicKey(idl.address);
  const connection = getConnection("confirmed");
  const keeper = loadKeypair();

  console.log(`rpc host ${cfg.rpcHost}, keeper ${keeper.publicKey.toBase58()}`);
  console.log(`program ${programId.toBase58()}`);
  console.log(`replay ${path.relative(cfg.repoRoot, replayFile)}: dataset_id ${replay.datasetId.toString("hex")}`);

  const program = await connection.getAccountInfo(programId);
  if (!program?.executable) throw new Error(`no executable program at ${programId.toBase58()} on ${cfg.rpcHost}`);

  const now = await clusterTime(connection);
  const id = BigInt(args["session-id"] ?? now.toString());
  const [session] = sessionPda(programId, keeper.publicKey, id);

  let inputs: SessionInputs;
  let createSignature: string | null = null;

  if (await connection.getAccountInfo(session)) {
    // Already created: never resend. Take the inputs it was created with from the session file.
    const prev = existsSync(outFile) ? readSessionFile(outFile) : undefined;
    if (prev?.session !== session.toBase58()) {
      throw new Error(`session ${session.toBase58()} already exists and ${outFile} does not describe it; use a new --session-id`);
    }
    console.log(`session ${session.toBase58()} already exists; checking it against ${path.relative(cfg.repoRoot, outFile)}`);
    inputs = toInputs(prev);
    createSignature = prev.createSignature;
  } else {
    let mint: PublicKey;
    if (args.mint) {
      mint = new PublicKey(args.mint);
      const m = await getMint(connection, mint);
      if (m.decimals !== PLAY_DECIMALS) throw new Error(`mint ${mint.toBase58()} has ${m.decimals} decimals, expected ${PLAY_DECIMALS}`);
      console.log(`using PLAY mint ${mint.toBase58()}`);
    } else {
      mint = await createMint(connection, keeper);
      console.log(`created PLAY mint ${mint.toBase58()} (${PLAY_DECIMALS} decimals, authority keeper)`);
    }
    const depositDeadline = now + BigInt(args["deposit-window"]);
    inputs = {
      id,
      creator: keeper.publicKey,
      mint,
      depositDeadline,
      replayDeadline: depositDeadline + BigInt(args["replay-window"]),
    };
    const ix = createSessionIx(idl, replay, inputs);
    const res = await sendAndConfirmWithRetry(
      connection,
      (blockhash) => new Transaction({ feePayer: keeper.publicKey, recentBlockhash: blockhash }).add(ix),
      [keeper],
      { label: "create_session" },
    );
    createSignature = res.signature;
  }

  const file: SessionFile = {
    programId: programId.toBase58(),
    session: session.toBase58(),
    vaults: [vaultPda(programId, session, 0)[0].toBase58(), vaultPda(programId, session, 1)[0].toBase58()],
    mint: inputs.mint.toBase58(),
    sessionId: inputs.id.toString(),
    creator: inputs.creator.toBase58(),
    depositDeadline: inputs.depositDeadline.toString(),
    replayDeadline: inputs.replayDeadline.toString(),
    createSignature,
  };
  mkdirSync(path.dirname(outFile), { recursive: true });
  writeSessionFile(outFile, file);

  console.log(`session ${file.session}`);
  console.log(`vaults  ${file.vaults[0]} ${file.vaults[1]}`);
  console.log(`wrote ${path.relative(cfg.repoRoot, outFile)}`);

  const account = await connection.getAccountInfo(session);
  if (!account) throw new Error(`session ${session.toBase58()} not found after create_session`);
  if (!account.owner.equals(programId)) throw new Error(`session is owned by ${account.owner.toBase58()}, not the program`);
  const checks = compareSession(expectedSession(idl, replay, inputs), decodeSession(idl, account.data));
  const width = Math.max(...checks.map((c) => c.field.length));
  for (const c of checks) {
    const shown = c.ok ? c.expected : `${c.actual ?? "<missing>"} != expected ${c.expected}`;
    console.log(`${c.ok ? "ok  " : "FAIL"} ${c.field.padEnd(width)} ${shown}`);
  }
  const bad = checks.filter((c) => !c.ok).length;
  console.log(bad === 0 ? `read-back: all ${checks.length} fields match` : `read-back: ${bad} of ${checks.length} fields differ`);
  if (bad > 0) return 1;

  // Part 2: seed the four sides from the keeper.
  if (args.seed === "none") return 0;
  const ctx = loadCtx({ idl: args.idl, sessionFile: outFile });
  await seedSides(ctx, parseSides(args.seed, parsePlay));
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
