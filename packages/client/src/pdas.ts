import { PublicKey } from "@solana/web3.js";
import { PROGRAM_ID, SEEDS } from "./constants";

const find = (seeds: Uint8Array[]): [PublicKey, number] => PublicKey.findProgramAddressSync(seeds, PROGRAM_ID);

function u64le(v: bigint): Uint8Array {
  if (v < 0n || v >= 1n << 64n) throw new RangeError("session id out of u64 range");
  const b = new Uint8Array(8);
  new DataView(b.buffer).setBigUint64(0, v, true);
  return b;
}

/** ["session", authority, session_id u64 LE] */
export function sessionPda(authority: PublicKey, sessionId: bigint): [PublicKey, number] {
  return find([SEEDS.session, authority.toBytes(), u64le(sessionId)]);
}
/** ["vault", session, [product]] */
export function vaultPda(session: PublicKey, product: 0 | 1): [PublicKey, number] {
  return find([SEEDS.vault, session.toBytes(), Uint8Array.of(product)]);
}
/** ["position", session, owner] */
export function positionPda(session: PublicKey, owner: PublicKey): [PublicKey, number] {
  return find([SEEDS.position, session.toBytes(), owner.toBytes()]);
}
/** ["cover", session, owner] */
export function coverPda(session: PublicKey, owner: PublicKey): [PublicKey, number] {
  return find([SEEDS.cover, session.toBytes(), owner.toBytes()]);
}
/** ["seller", session] */
export function sellerPda(session: PublicKey): [PublicKey, number] {
  return find([SEEDS.seller, session.toBytes()]);
}
/** ["seller_ta", session] */
export function sellerTaPda(session: PublicKey): [PublicKey, number] {
  return find([SEEDS.sellerTa, session.toBytes()]);
}
/** ["quote", session] */
export function quotePda(session: PublicKey): [PublicKey, number] {
  return find([SEEDS.quote, session.toBytes()]);
}
