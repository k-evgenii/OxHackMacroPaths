// Raw instruction-data decoding for the four wallet actions and SPL token transfers.
import idl from "@macropaths/client/idl.json";

export const MACROPATHS_PROGRAM_ID: string = idl.address;
export const TOKEN_PROGRAM_ID = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
export const TOKEN_2022_PROGRAM_ID = "TokenzQdBNbLqP4ccJxgFHQsjWd4RVVfLx3Vr2sXF7pH";

type IdlIx = { name: string; discriminator: number[]; accounts: { name: string }[] };
const ixs = (idl as unknown as { instructions: IdlIx[] }).instructions;

export type ActionName = "deposit" | "buy_cover" | "claim" | "claim_cover";
const ACTIONS: ActionName[] = ["deposit", "buy_cover", "claim", "claim_cover"];

/** Account-role → position, read from the IDL so layout drift fails loudly in tests. */
export const ROLES: Record<ActionName, Record<string, number>> = Object.fromEntries(
  ACTIONS.map((name) => {
    const ix = ixs.find((i) => i.name === name);
    if (!ix) throw new Error(`IDL lacks instruction ${name}`);
    return [name, Object.fromEntries(ix.accounts.map((a, i) => [a.name, i]))];
  }),
) as Record<ActionName, Record<string, number>>;

const DISC: Array<[ActionName, number[]]> = ACTIONS.map((name) => [name, ixs.find((i) => i.name === name)!.discriminator]);

export const discriminatorOf = (name: ActionName): number[] => DISC.find(([n]) => n === name)![1];

export type DecodedAction =
  | { name: "deposit"; amounts: [bigint, bigint, bigint, bigint] }
  | { name: "buy_cover"; product: number; units: bigint }
  | { name: "claim" }
  | { name: "claim_cover" };

const readU64 = (b: Buffer, off: number): bigint | null => (b.length >= off + 8 ? b.readBigUInt64LE(off) : null);

export function decodeAction(dataBase64: string): DecodedAction | null {
  const b = Buffer.from(dataBase64, "base64");
  if (b.length < 8) return null;
  const hit = DISC.find(([, d]) => d.every((x, i) => b[i] === x));
  if (!hit) return null;
  switch (hit[0]) {
    case "deposit": {
      const a = [0, 1, 2, 3].map((i) => readU64(b, 8 + i * 8));
      if (a.some((x) => x === null)) return null;
      return { name: "deposit", amounts: a as [bigint, bigint, bigint, bigint] };
    }
    case "buy_cover": {
      if (b.length < 17) return null;
      return { name: "buy_cover", product: b[8], units: readU64(b, 9)! };
    }
    case "claim":
      return { name: "claim" };
    case "claim_cover":
      return { name: "claim_cover" };
  }
}

export type TokenTransfer = { source: string; destination: string; authority: string; amount: bigint };

/** SPL Token Transfer (3) / TransferChecked (12). Other token instructions return null. */
export function decodeTokenTransfer(programId: string, accounts: string[], dataBase64: string): TokenTransfer | null {
  if (programId !== TOKEN_PROGRAM_ID && programId !== TOKEN_2022_PROGRAM_ID) return null;
  const b = Buffer.from(dataBase64, "base64");
  if (b[0] === 3 && b.length >= 9 && accounts.length >= 3) {
    return { source: accounts[0], destination: accounts[1], authority: accounts[2], amount: b.readBigUInt64LE(1) };
  }
  if (b[0] === 12 && b.length >= 10 && accounts.length >= 4) {
    return { source: accounts[0], destination: accounts[2], authority: accounts[3], amount: b.readBigUInt64LE(1) };
  }
  return null;
}
