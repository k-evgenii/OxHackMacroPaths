/**
 * Replay (task 13): post the observations from data/cpi-yoy-replay.json in order, at least
 * --interval-ms apart (minimum 2000), each only after the previous one is confirmed.
 *
 *   pixi run npm --prefix keeper run replay -- [options]
 *
 *   --interval-ms <ms>     gap between rows (default 2000, minimum 2000)
 *   --limit <n>            post at most n rows this run (default: all)
 *   --replay <file>        default data/cpi-yoy-replay.json
 *   --idl <file>           default packages/client/idl.json
 *   --session-file <file>  default data/session.json
 *
 * Resume: on start it reads Session.next_index and continues from there.
 *
 * Never double-posts a row, even across a kill and restart: before each row is broadcast, the
 * sender's onSigned hook writes {index, signature, lastValidBlockHeight} to data/replay-pending.json.
 * On start, if that file names the row the session still expects, we wait until the signature is
 * confirmed (row done) or provably dead (blockhash expired and still unknown) before building a new
 * transaction. Within a run, tx.ts gives the same guarantee. The chain itself also rejects a second
 * post of the same index (WrongIndex), so a duplicate could only ever fail, never apply twice.
 */
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { Transaction } from "@solana/web3.js";
import { getSignatureState, isBlockhashExpired, sendAndConfirmWithRetry, TransactionFailedError } from "./tx.js";
import { bn, big, enumName, instruction } from "./program.js";
import { clusterTime, fetchSession, loadCtx, type Ctx } from "./ops.js";

export const MIN_INTERVAL_MS = 2000;

export interface ReplayRow {
  i: number;
  period_id: number;
  value: number | string;
  C_i: string;
  C_next: string;
}

export interface Pending {
  session: string;
  index: number;
  signature: string;
  lastValidBlockHeight: number;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function loadRows(file: string): ReplayRow[] {
  const rows = (JSON.parse(readFileSync(file, "utf8")) as { rows?: ReplayRow[] }).rows;
  if (!Array.isArray(rows)) throw new Error(`${file}: no rows`);
  rows.forEach((r, k) => {
    if (r.i !== k) throw new Error(`${file}: row ${k} has i = ${r.i}`);
  });
  return rows;
}

function observeIx(ctx: Ctx, row: ReplayRow) {
  return instruction(
    ctx.idl,
    "observe",
    {
      index: row.i,
      period_id: row.period_id,
      value: bn(BigInt(row.value)),
      next_commitment: [...Buffer.from(row.C_next, "hex")],
    },
    // controller is only used by layouts whose observe has a signer.
    { session: ctx.session, controller: ctx.keeper.publicKey },
  );
}

/**
 * Wait until a transaction signed by an earlier run is settled one way or the other. Returns once
 * it is confirmed, failed, or can never land; never returns while it might still land.
 */
async function resolvePending(ctx: Ctx, p: Pending): Promise<void> {
  console.log(`row ${p.index}: earlier run signed ${p.signature}; checking it before posting again`);
  for (;;) {
    let st;
    try {
      st = await getSignatureState(ctx.connection, p.signature);
    } catch {
      await sleep(1000); // RPC error is "unknown", not "not found": ask again
      continue;
    }
    if (st.state === "confirmed" || st.state === "finalized") {
      console.log(`row ${p.index}: earlier transaction is ${st.state} at slot ${st.slot}`);
      return;
    }
    if (st.state === "failed") {
      console.log(`row ${p.index}: earlier transaction failed on-chain (${JSON.stringify(st.err)})`);
      return;
    }
    if (st.state === "unknown") {
      let expired = false;
      try {
        expired = await isBlockhashExpired(ctx.connection, p.lastValidBlockHeight);
      } catch {
        /* unknown: keep waiting */
      }
      if (expired) {
        // Same rule as tx.ts: a definite "unknown" after expiry means it can never land.
        try {
          if ((await getSignatureState(ctx.connection, p.signature)).state === "unknown") {
            console.log(`row ${p.index}: earlier transaction expired without landing; safe to post`);
            return;
          }
        } catch {
          /* ask again */
        }
      }
    }
    await sleep(1000);
  }
}

const { values: args } = parseArgs({
  options: {
    "interval-ms": { type: "string", default: String(MIN_INTERVAL_MS) },
    limit: { type: "string" },
    replay: { type: "string" },
    idl: { type: "string" },
    "session-file": { type: "string" },
  },
});

async function main(): Promise<number> {
  const interval = Number(args["interval-ms"]);
  if (!Number.isInteger(interval) || interval < MIN_INTERVAL_MS) {
    throw new Error(`--interval-ms must be an integer >= ${MIN_INTERVAL_MS}`);
  }
  const limit = args.limit === undefined ? Infinity : Number(args.limit);
  const ctx = loadCtx({ idl: args.idl, sessionFile: args["session-file"] });
  const rows = loadRows(path.resolve(ctx.repoRoot, args.replay ?? "data/cpi-yoy-replay.json"));
  const pendingFile = path.resolve(ctx.repoRoot, "data/replay-pending.json");
  const session = ctx.session.toBase58();

  let s = await fetchSession(ctx);
  const n = Number(s.n_obs);
  if (rows.length !== n) throw new Error(`replay file has ${rows.length} rows, session expects ${n}`);
  const state = enumName(s.state);
  if (state === "settled" || (state === "running" && s.next_index === n)) {
    console.log(`replay: all ${n} observations already posted (session ${state})`);
    return 0;
  }
  if (state !== "running") throw new Error(`cannot replay: session is ${state}${state === "open" ? "; lock it first" : ""}`);

  // A row signed by an earlier run that the session still expects: settle it first.
  if (existsSync(pendingFile)) {
    const p = JSON.parse(readFileSync(pendingFile, "utf8")) as Pending;
    if (p.session === session && p.index === s.next_index) {
      await resolvePending(ctx, p);
      s = await fetchSession(ctx);
    }
    rmSync(pendingFile);
  }

  console.log(`replay: session ${session}, resuming at row ${s.next_index} of ${n}, every ${interval} ms`);
  let lastSent = 0;
  let posted = 0;
  while (s.next_index < n && posted < limit) {
    const i = Number(s.next_index);
    const row = rows[i]!;
    // The session's current commitment must be this row's C_i, or this is the wrong replay file.
    const current = Buffer.from(s.commitment).toString("hex");
    if (current !== row.C_i) throw new Error(`row ${i}: session commitment ${current} is not C_${i} ${row.C_i}`);
    if ((await clusterTime(ctx.connection)) > big(s.replay_deadline)) throw new Error("replay deadline has passed");

    const wait = lastSent + interval - Date.now();
    if (wait > 0) await sleep(wait);
    lastSent = Date.now();

    const ix = observeIx(ctx, row);
    try {
      const res = await sendAndConfirmWithRetry(
        ctx.connection,
        (blockhash) => new Transaction({ feePayer: ctx.keeper.publicKey, recentBlockhash: blockhash }).add(ix),
        [ctx.keeper],
        {
          label: `observe ${i}`,
          log: () => {},
          onSigned: (signature, _attempt, lastValidBlockHeight) => {
            const p: Pending = { session, index: i, signature, lastValidBlockHeight };
            writeFileSync(pendingFile, JSON.stringify(p) + "\n");
          },
        },
      );
      console.log(`row ${String(i).padStart(2)} ${row.period_id} x=${row.value}  ${res.signature}`);
      posted++;
    } catch (e) {
      // Someone else (observe is permissionless) may have posted this row first.
      if (!(e instanceof TransactionFailedError)) throw e;
      const now = await fetchSession(ctx);
      if (Number(now.next_index) <= i) throw e;
      console.log(`row ${i}: already posted by another transaction; continuing`);
    }
    s = await fetchSession(ctx);
    if (Number(s.next_index) <= i) throw new Error(`row ${i} confirmed but next_index is still ${s.next_index}`);
  }
  if (existsSync(pendingFile)) rmSync(pendingFile);

  if (s.next_index === n) {
    const done = Buffer.from(s.commitment).equals(Buffer.from(s.terminal));
    console.log(`replay: ${n} of ${n} posted; commitment ${done ? "equals C_N" : "DOES NOT equal C_N"}`);
    console.log(`D=${big(s.max_decline)} A=${big(s.excess_acc)}; next: npm run admin -- settle`);
    return done ? 0 : 1;
  }
  console.log(`replay: stopped at row ${s.next_index} of ${n} (--limit ${limit})`);
  return 0;
}

main().then(
  (code) => process.exit(code),
  (e: unknown) => {
    console.error(`error: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  },
);
