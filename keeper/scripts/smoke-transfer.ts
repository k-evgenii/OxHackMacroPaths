/**
 * Smoke test for sendAndConfirmWithRetry against a LOCAL validator only.
 *
 *   DOTENV_PATH=/path/to/local.env npm run smoke:transfer [-- --expiry]
 *
 * 1. airdrop to the keeper, transfer 0.1 SOL to a fresh address;
 * 2. on-chain failure (skipPreflight): must throw TransactionFailedError after
 *    exactly one signed tx;
 * 3. preflight rejection: must throw TransactionRejectedError after one tx;
 * 4. (--expiry) first attempt uses a bogus blockhash, so it can never land;
 *    must rebuild once the blockhash expires and succeed with attempts = 2.
 */
import { Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import { describeEnv, getConfig, getConnection, loadKeypair } from "../src/env.js";
import {
  sendAndConfirmWithRetry,
  TransactionFailedError,
  TransactionRejectedError,
  type TxBuilder,
} from "../src/tx.js";

const cfg = getConfig();
if (!["127.0.0.1", "localhost", "::1", "[::1]"].includes(cfg.rpcHost)) {
  console.error(`refusing to run: RPC_URL host is ${cfg.rpcHost}, expected a local validator`);
  process.exit(2);
}
for (const l of describeEnv()) console.log(l);

const connection = getConnection("confirmed");
const payer = loadKeypair();
const sol = (l: number) => `${(l / LAMPORTS_PER_SOL).toFixed(6)} SOL`;

function transfer(to: PublicKey, lamports: number, counter: { builds: number }): TxBuilder {
  return (blockhash) => {
    counter.builds++;
    return new Transaction({ feePayer: payer.publicKey, recentBlockhash: blockhash }).add(
      SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: to, lamports }),
    );
  };
}

async function airdrop(to: PublicKey, lamports: number) {
  const sig = await connection.requestAirdrop(to, lamports);
  const bh = await connection.getLatestBlockhash();
  await connection.confirmTransaction({ signature: sig, ...bh }, "confirmed");
  console.log(`airdrop ${sol(lamports)} -> ${to.toBase58()}: ${sig}`);
}

let failures = 0;
const check = (ok: boolean, what: string) => {
  console.log(`${ok ? "PASS" : "FAIL"}: ${what}`);
  if (!ok) failures++;
};

// 1. happy path
await airdrop(payer.publicKey, 2 * LAMPORTS_PER_SOL);
const recipient = Keypair.generate().publicKey;
const before = { payer: await connection.getBalance(payer.publicKey), recipient: await connection.getBalance(recipient) };
console.log(`before: payer ${sol(before.payer)}, recipient ${sol(before.recipient)}`);
{
  const c = { builds: 0 };
  const res = await sendAndConfirmWithRetry(connection, transfer(recipient, 0.1 * LAMPORTS_PER_SOL, c), [payer], {
    label: "transfer",
  });
  const after = { payer: await connection.getBalance(payer.publicKey), recipient: await connection.getBalance(recipient) };
  console.log(`after:  payer ${sol(after.payer)}, recipient ${sol(after.recipient)}`);
  console.log(`result: signature ${res.signature}, slot ${res.slot}, attempts ${res.attempts}`);
  check(after.recipient - before.recipient === 0.1 * LAMPORTS_PER_SOL, "recipient received exactly 0.1 SOL");
  check(res.attempts === 1 && c.builds === 1, "one attempt, one build");
}

// 2. on-chain failure: more lamports than the balance, preflight skipped
{
  const c = { builds: 0 };
  const signed: string[] = [];
  const bal = await connection.getBalance(payer.publicKey);
  try {
    await sendAndConfirmWithRetry(connection, transfer(recipient, bal + LAMPORTS_PER_SOL, c), [payer], {
      label: "overspend",
      skipPreflight: true,
      onSigned: (s) => void signed.push(s),
    });
    check(false, "overspend should have thrown");
  } catch (e) {
    check(e instanceof TransactionFailedError, `overspend threw TransactionFailedError (${(e as Error).name})`);
    if (e instanceof TransactionFailedError) {
      console.log(`  error: ${JSON.stringify(e.txError)}; ${e.logs?.length ?? 0} log lines`);
      e.logs?.forEach((l) => console.log(`    ${l}`));
    }
  }
  check(c.builds === 1 && signed.length === 1, `overspend built/signed once (builds ${c.builds}, signed ${signed.length})`);
}

// 3. preflight rejection
{
  const c = { builds: 0 };
  const bal = await connection.getBalance(payer.publicKey);
  try {
    await sendAndConfirmWithRetry(connection, transfer(recipient, bal + LAMPORTS_PER_SOL, c), [payer], {
      label: "overspend-preflight",
    });
    check(false, "preflight overspend should have thrown");
  } catch (e) {
    check(e instanceof TransactionRejectedError, `preflight overspend threw TransactionRejectedError (${(e as Error).name})`);
  }
  check(c.builds === 1, `preflight overspend built once (builds ${c.builds})`);
}

// 4. expiry -> rebuild
if (process.argv.includes("--expiry")) {
  let builds = 0;
  const bogus = Keypair.generate().publicKey.toBase58(); // never a real blockhash
  const before4 = await connection.getBalance(recipient);
  const t0 = Date.now();
  const res = await sendAndConfirmWithRetry(
    connection,
    (blockhash) => {
      builds++;
      return new Transaction({ feePayer: payer.publicKey, recentBlockhash: builds === 1 ? bogus : blockhash }).add(
        SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: recipient, lamports: 12345 }),
      );
    },
    [payer],
    { label: "expiry", skipPreflight: true, backoffMs: 200 },
  );
  const delta = (await connection.getBalance(recipient)) - before4;
  console.log(`expiry: ${res.signature} attempts ${res.attempts} in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  check(res.attempts === 2 && builds === 2, "expired attempt was rebuilt exactly once");
  check(delta === 12345, `recipient credited exactly once (delta ${delta})`);
}

console.log(failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
