/**
 * Transaction sending with retries that can never double-post.
 *
 * Why double-posting is impossible
 * --------------------------------
 * A Solana transaction is only valid while its recent blockhash is valid, i.e.
 * until the chain's block height passes the `lastValidBlockHeight` returned
 * alongside the blockhash. After that, no validator can ever include it.
 *
 * So for each attempt we:
 *   1. fetch a blockhash + lastValidBlockHeight, build and sign the tx, and
 *      record its signature (via `onSigned`) BEFORE anything is broadcast;
 *   2. send it, then rebroadcast the SAME signed bytes while polling its status
 *      (rebroadcasting identical bytes is harmless: a signature can only ever
 *      be processed once);
 *   3. only when the FINALIZED block height is past lastValidBlockHeight (so no
 *      fork, now or later, can include the tx) AND a fresh status lookup with
 *      `searchTransactionHistory` still does not know the signature, do we
 *      conclude the attempt never landed and never will, and rebuild with a
 *      fresh blockhash.
 *
 * At any moment at most one signed transaction is "live" (could still land),
 * and a new one is only created once the previous one is provably dead. An RPC
 * error during the final check is treated as "unknown", never as "not found":
 * we keep checking rather than resubmitting on uncertainty.
 *
 * Assumption: all calls go to the same RPC endpoint (one `Connection`), so the
 * block height and the signature history come from the same node's view.
 *
 * Logging: signatures and slots are public and are logged. The RPC URL is not;
 * error messages are scrubbed of `connection.rpcEndpoint` before surfacing.
 */
import {
  SendTransactionError,
  Transaction,
  VersionedTransaction,
  type Commitment,
  type Connection,
  type Signer,
  type SignatureStatus,
  type TransactionError,
} from "@solana/web3.js";
import { utils } from "@anchor-lang/core";
import { redactUrl } from "./env.js";

const bs58 = utils.bytes.bs58;

export type BuiltTx = Transaction | VersionedTransaction;

/**
 * Builds the transaction for one attempt. Must use the given blockhash. Called
 * again (with a fresh blockhash) only after the previous attempt provably
 * expired, so it must be a pure function of the intended action.
 */
export type TxBuilder = (blockhash: string, lastValidBlockHeight: number) => BuiltTx | Promise<BuiltTx>;

export interface SendOptions {
  /** Skip RPC simulation on the first send of each attempt. Default false. */
  skipPreflight?: boolean;
  /** Commitment to wait for: "confirmed" (default) or "finalized". */
  commitment?: "confirmed" | "finalized";
  /** Max number of distinct signed transactions (blockhashes). Default 3. */
  maxAttempts?: number;
  /** How often to rebroadcast the signed bytes. Default 2000 ms. */
  rebroadcastIntervalMs?: number;
  /** How often to poll signature status. Default 500 ms. */
  pollIntervalMs?: number;
  /** Base backoff between attempts (doubles each attempt). Default 1000 ms. */
  backoffMs?: number;
  /** Prefix for log lines. */
  label?: string;
  /** Logger; default console.log. Pass `() => {}` to silence. */
  log?: (msg: string) => void;
  /**
   * Called with the signature after signing and BEFORE the first broadcast of
   * each attempt. Persist it here for crash-resume (see getSignatureState).
   */
  onSigned?: (signature: string, attempt: number, lastValidBlockHeight: number) => void | Promise<void>;
}

export interface SendResult {
  signature: string;
  slot: number;
  /** Number of distinct signed transactions used (1 = first blockhash). */
  attempts: number;
}

/** The transaction landed and failed on-chain. Never retried. */
export class TransactionFailedError extends Error {
  constructor(
    public readonly signature: string,
    public readonly txError: TransactionError,
    public readonly logs: string[] | undefined,
    public readonly slot: number | undefined,
  ) {
    super(
      `transaction ${signature} failed on-chain: ${JSON.stringify(txError)}` +
        (logs?.length ? `\nlogs:\n  ${logs.join("\n  ")}` : ""),
    );
    this.name = "TransactionFailedError";
  }
}

/** The RPC rejected the transaction before broadcasting it (e.g. simulation failed). */
export class TransactionRejectedError extends Error {
  constructor(
    public readonly signature: string,
    message: string,
    public readonly logs: string[] | undefined,
  ) {
    super(
      `transaction ${signature} rejected by RPC: ${message}` +
        (logs?.length ? `\nlogs:\n  ${logs.join("\n  ")}` : ""),
    );
    this.name = "TransactionRejectedError";
  }
}

/** Every attempt's blockhash expired without the tx landing. Safe to retry later. */
export class TransactionExpiredError extends Error {
  constructor(public readonly signatures: string[]) {
    super(`transaction not landed after ${signatures.length} attempt(s), all expired: ${signatures.join(", ")}`);
    this.name = "TransactionExpiredError";
  }
}

export type SignatureState =
  | { state: "unknown" }
  | { state: "processed" | "confirmed" | "finalized"; slot: number }
  | { state: "failed"; slot: number; err: TransactionError };

/**
 * Look up a signature, including transaction history. "unknown" means the node
 * has no record of it; combine with `isBlockhashExpired` before concluding it
 * can never land. Throws on RPC errors (callers must not read that as unknown).
 */
export async function getSignatureState(connection: Connection, signature: string): Promise<SignatureState> {
  const { value } = await connection.getSignatureStatuses([signature], { searchTransactionHistory: true });
  return toState(value[0] ?? null);
}

/** True once the finalized block height is past `lastValidBlockHeight`. */
export async function isBlockhashExpired(connection: Connection, lastValidBlockHeight: number): Promise<boolean> {
  return (await connection.getBlockHeight("finalized")) > lastValidBlockHeight;
}

function toState(s: SignatureStatus | null): SignatureState {
  if (!s) return { state: "unknown" };
  if (s.err) return { state: "failed", slot: s.slot, err: s.err };
  return { state: s.confirmationStatus ?? "processed", slot: s.slot };
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function scrub(connection: Connection, msg: string): string {
  const ep = connection.rpcEndpoint;
  return ep ? msg.split(ep).join(redactUrl(ep)) : msg;
}

function errMsg(connection: Connection, e: unknown): string {
  return scrub(connection, e instanceof Error ? e.message : String(e));
}

function signAndSerialize(tx: BuiltTx, signers: Signer[]): { signature: string; raw: Buffer } {
  if (tx instanceof VersionedTransaction) {
    tx.sign(signers);
    const sig = tx.signatures[0];
    if (!sig || sig.every((b) => b === 0)) throw new Error("versioned tx has no fee-payer signature after signing");
    return { signature: bs58.encode(sig), raw: Buffer.from(tx.serialize()) };
  }
  if (!tx.feePayer) {
    const payer = signers[0];
    if (!payer) throw new Error("no signers and no feePayer set");
    tx.feePayer = payer.publicKey;
  }
  tx.partialSign(...signers);
  if (!tx.signature) throw new Error("legacy tx has no fee-payer signature after signing");
  return { signature: bs58.encode(tx.signature), raw: tx.serialize() };
}

/** A send error that means "the RPC refused this tx" rather than a network blip. */
function isRejection(e: unknown): e is SendTransactionError {
  if (!(e instanceof SendTransactionError)) return false;
  // A lagging node may not know a fresh blockhash yet: transient.
  return !/blockhash not found/i.test(e.message);
}

async function fetchLogs(connection: Connection, signature: string): Promise<string[] | undefined> {
  for (let i = 0; i < 5; i++) {
    try {
      const tx = await connection.getTransaction(signature, {
        commitment: "confirmed",
        maxSupportedTransactionVersion: 0,
      });
      if (tx?.meta?.logMessages) return tx.meta.logMessages;
    } catch {
      /* best effort */
    }
    await sleep(400);
  }
  return undefined;
}

async function withTransientRetry<T>(
  connection: Connection,
  what: string,
  fn: () => Promise<T>,
  log: (m: string) => void,
  tries = 8,
): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (e) {
      if (i >= tries) throw new Error(`${what} failed after ${tries} tries: ${errMsg(connection, e)}`);
      log(`${what} failed (transient, retry ${i}/${tries - 1}): ${errMsg(connection, e)}`);
      await sleep(Math.min(500 * 2 ** (i - 1), 8000));
    }
  }
}

export async function sendAndConfirmWithRetry(
  connection: Connection,
  buildTx: TxBuilder,
  signers: Signer[],
  opts: SendOptions = {},
): Promise<SendResult> {
  const {
    skipPreflight = false,
    commitment = "confirmed",
    maxAttempts = 3,
    rebroadcastIntervalMs = 2000,
    pollIntervalMs = 500,
    backoffMs = 1000,
    label = "tx",
    log: rawLog = console.log,
    onSigned,
  } = opts;
  const log = (m: string) => rawLog(`[${label}] ${scrub(connection, m)}`);
  const done = (s: SignatureStatus) =>
    commitment === "finalized"
      ? s.confirmationStatus === "finalized"
      : s.confirmationStatus === "confirmed" || s.confirmationStatus === "finalized";

  const signatures: string[] = [];

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const { blockhash, lastValidBlockHeight } = await withTransientRetry(
      connection,
      "getLatestBlockhash",
      () => connection.getLatestBlockhash("confirmed" as Commitment),
      log,
    );
    const tx = await buildTx(blockhash, lastValidBlockHeight);
    const { signature, raw } = signAndSerialize(tx, signers);
    signatures.push(signature);
    await onSigned?.(signature, attempt, lastValidBlockHeight);
    log(`attempt ${attempt}/${maxAttempts}: signed ${signature} (lastValidBlockHeight ${lastValidBlockHeight})`);

    // Initial send. Preflight (if enabled) only here; rebroadcasts skip it.
    try {
      await connection.sendRawTransaction(raw, { skipPreflight, maxRetries: 0, preflightCommitment: "confirmed" });
    } catch (e) {
      if (isRejection(e)) {
        // Rejected by the RPC (simulation failure etc.): it was not forwarded,
        // and the same bytes would be rejected again. Deterministic, so throw.
        throw new TransactionRejectedError(signature, scrub(connection, e.message), e.logs);
      }
      log(`send failed (transient, will rebroadcast): ${errMsg(connection, e)}`);
    }
    let lastBroadcast = Date.now();

    // Poll until confirmed, failed, or provably expired.
    for (;;) {
      let status: SignatureStatus | null | undefined; // undefined = RPC error
      try {
        status = (await connection.getSignatureStatuses([signature], { searchTransactionHistory: true })).value[0];
      } catch (e) {
        log(`status poll failed (transient): ${errMsg(connection, e)}`);
      }

      if (status) {
        if (status.err) {
          log(`${signature} failed on-chain at slot ${status.slot}; not retrying`);
          throw new TransactionFailedError(signature, status.err, await fetchLogs(connection, signature), status.slot);
        }
        if (done(status)) {
          log(`${signature} ${status.confirmationStatus} at slot ${status.slot} (attempt ${attempt})`);
          return { signature, slot: status.slot, attempts: attempt };
        }
        // Landed but not yet at the target commitment: keep waiting, never resubmit.
      } else if (status === null) {
        // Unknown to the node. Has the blockhash expired for good?
        let expired = false;
        try {
          expired = await isBlockhashExpired(connection, lastValidBlockHeight);
        } catch (e) {
          log(`block height check failed (transient): ${errMsg(connection, e)}`);
        }
        if (expired) {
          // Final check AFTER expiry is established. Must be a definite answer.
          const final = await withTransientRetry(
            connection,
            "final status check",
            () => getSignatureState(connection, signature),
            log,
            1_000_000, // never give up into a resubmit on uncertainty
          );
          if (final.state === "unknown") {
            log(`${signature} expired without landing; safe to rebuild`);
            break;
          }
          log(`${signature} found in final check (${final.state}); continuing to wait`);
          continue;
        }
      }

      if (Date.now() - lastBroadcast >= rebroadcastIntervalMs) {
        try {
          await connection.sendRawTransaction(raw, { skipPreflight: true, maxRetries: 0 });
        } catch {
          /* rebroadcast errors (incl. "already processed") are irrelevant */
        }
        lastBroadcast = Date.now();
      }
      await sleep(pollIntervalMs);
    }

    if (attempt < maxAttempts) {
      const wait = backoffMs * 2 ** (attempt - 1);
      log(`backing off ${wait} ms before attempt ${attempt + 1}`);
      await sleep(wait);
    }
  }
  throw new TransactionExpiredError(signatures);
}
