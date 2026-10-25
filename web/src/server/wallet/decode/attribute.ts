// Turns one normalized transaction into the requested wallet's MacroPaths action rows.
//
// Invariants:
// - Only successful transactions, only instructions of the real program, only
//   actions whose signer role is the wallet and whose session is registered.
// - A token transfer belongs to an action only if that action is its nearest
//   MacroPaths ancestor in the invocation tree. Unresolved parentage under the
//   same top-level instruction makes the affected amounts unavailable.
// - Amounts are the action's own PLAY legs (deposit: owner->vaults; buy_cover:
//   buyer premium only; claims: vaults->owner). Never the transaction-wide delta,
//   which is only a reconciliation check per owner token account.
// - Anything recognized but unprovable yields amount:null, never zero.
import {
  MACROPATHS_PROGRAM_ID,
  ROLES,
  decodeAction,
  decodeTokenTransfer,
  type ActionName,
  type DecodedAction,
  type TokenTransfer,
} from "./instructions";
import { parseWalletEvents, type ClaimedEvent, type CoverBoughtEvent } from "./events";
import type { ActivityKind, HistoryTransaction, InstructionNode, RegisteredSession, WalletActivityItem } from "./ports";

type Loc = { instructionIndex: number; inner: number | null };
const locKey = (l: Loc) => `${l.instructionIndex}:${l.inner ?? "top"}`;

type Located<T> = { node: InstructionNode; value: T };
const UNRESOLVED = Symbol("unresolved");

export function activityId(signature: string, instructionIndex: number, inner: number | null, kind: ActivityKind): string {
  return `${signature}:${instructionIndex}:${inner ?? "top"}:${kind}`;
}

export function decodeWalletActivity(
  tx: HistoryTransaction,
  wallet: string,
  sessions: ReadonlyMap<string, RegisteredSession>,
): WalletActivityItem[] {
  if (tx.failed) return [];

  const byLoc = new Map<string, InstructionNode>();
  for (const n of tx.instructions) byLoc.set(locKey({ instructionIndex: n.instructionIndex, inner: n.innerInstructionIndex }), n);

  const actions: Located<DecodedAction>[] = [];
  const transfers: Located<TokenTransfer>[] = [];
  for (const node of tx.instructions) {
    if (node.programId === MACROPATHS_PROGRAM_ID) {
      const a = decodeAction(node.dataBase64);
      if (a) actions.push({ node, value: a });
      continue;
    }
    const t = decodeTokenTransfer(node.programId, node.accounts, node.dataBase64);
    if (t) transfers.push({ node, value: t });
  }
  if (actions.length === 0) return [];

  /** Nearest MacroPaths ancestor of a node (excluding itself), null if none, UNRESOLVED if the chain breaks. */
  const macroAncestor = (node: InstructionNode): string | null | typeof UNRESOLVED => {
    let cur = node;
    for (let guard = 0; guard < 256; guard++) {
      if (cur.innerInstructionIndex === null) return null; // reached top-level without a MacroPaths frame
      const parentLoc: Loc = { instructionIndex: cur.instructionIndex, inner: cur.parentInnerInstructionIndex };
      const parent = byLoc.get(locKey(parentLoc));
      if (!parent) return UNRESOLVED;
      if (parent.programId === MACROPATHS_PROGRAM_ID && decodeAction(parent.dataBase64)) return locKey(parentLoc);
      cur = parent;
    }
    return UNRESOLVED;
  };

  const owned = new Map<string, TokenTransfer[]>();
  const unresolvedByTop = new Map<number, TokenTransfer[]>();
  for (const t of transfers) {
    const anc = macroAncestor(t.node);
    if (anc === UNRESOLVED) {
      const list = unresolvedByTop.get(t.node.instructionIndex) ?? [];
      list.push(t.value);
      unresolvedByTop.set(t.node.instructionIndex, list);
    } else if (anc !== null) {
      const list = owned.get(anc) ?? [];
      list.push(t.value);
      owned.set(anc, list);
    }
  }

  const reconciled = reconcileTokenAccounts(tx, transfers.map((t) => t.value));
  const events = parseWalletEvents(tx.logs);
  const out: WalletActivityItem[] = [];

  for (const { node, value: action } of actions) {
    const roles = ROLES[action.name];
    const signerRole = action.name === "buy_cover" ? "buyer" : "owner";
    const taRole = action.name === "buy_cover" ? "buyer_ta" : "owner_ta";
    const acc = (role: string): string | undefined => node.accounts[roles[role]];

    if (acc(signerRole) !== wallet) continue;
    const session = sessions.get(acc("session") ?? "");
    if (!session) continue;
    const ownerTa = acc(taRole);
    if (!ownerTa) continue;
    // Token metadata, when present, must agree with the program's own checks.
    const taMeta = tokenMeta(tx, ownerTa);
    if (taMeta && (taMeta.mint !== session.playMint || (taMeta.owner !== null && taMeta.owner !== wallet))) continue;

    const loc = locKey({ instructionIndex: node.instructionIndex, inner: node.innerInstructionIndex });
    const legs = owned.get(loc) ?? [];
    const touchesUnresolved = (unresolvedByTop.get(node.instructionIndex) ?? []).some(
      (t) => t.source === ownerTa || t.destination === ownerTa,
    );
    const ambiguous = touchesUnresolved || reconciled.get(ownerTa) === false;

    const ctx: Ctx = { session, wallet, ownerTa, legs, events, sameKindCount: (pred) => actions.filter((a) => pred(a)).length };
    const result = attribute(action, node, ctx);
    if (!result) continue;

    out.push({
      id: activityId(tx.signature, node.instructionIndex, node.innerInstructionIndex, result.kind),
      signature: tx.signature,
      instructionIndex: node.instructionIndex,
      innerInstructionIndex: node.innerInstructionIndex,
      session: session.address,
      product: result.product,
      slot: tx.slot,
      blockTime: tx.blockTime,
      kind: result.kind,
      amount: ambiguous || result.amount === null ? null : result.amount.toString(),
      mint: session.playMint,
    });
  }
  return out;
}

type Ctx = {
  session: RegisteredSession;
  wallet: string;
  ownerTa: string;
  legs: TokenTransfer[];
  events: ReturnType<typeof parseWalletEvents>;
  sameKindCount: (pred: (a: Located<DecodedAction>) => boolean) => number;
};
type Attributed = { kind: ActivityKind; product: 0 | 1 | null; amount: bigint | null };

function attribute(action: DecodedAction, node: InstructionNode, c: Ctx): Attributed | null {
  const roles = ROLES[action.name as ActionName];
  const acc = (role: string) => node.accounts[roles[role]];
  const [v0, v1] = c.session.vaults;

  switch (action.name) {
    case "deposit": {
      if (acc("vault_0") !== v0 || acc("vault_1") !== v1) return null;
      const [a0, a1, a2, a3] = action.amounts;
      const exp: [bigint, bigint] = [a0 + a1, a2 + a3];
      const product = productOf(exp);
      const got = legSums(c.legs, [
        { source: c.ownerTa, destination: v0, authority: c.wallet },
        { source: c.ownerTa, destination: v1, authority: c.wallet },
      ]);
      if (!got || got[0] !== exp[0] || got[1] !== exp[1]) return { kind: "PoolDeposit", product, amount: null };
      return { kind: "PoolDeposit", product, amount: -(exp[0] + exp[1]) };
    }
    case "buy_cover": {
      if (action.product !== 0 && action.product !== 1) return null;
      const product = action.product;
      const vault = acc("vault");
      if (vault !== c.session.vaults[product]) return null;
      const premium = c.legs.filter((t) => t.source === c.ownerTa && t.destination === vault && t.authority === c.wallet);
      const sellerTa = acc("seller_ta");
      const sellerLeg = (t: TokenTransfer) =>
        t.source === sellerTa && t.destination === vault && t.authority === c.session.address;
      const unexpected = c.legs.some((t) => !premium.includes(t) && !sellerLeg(t));
      // Event evidence is only usable if it maps to exactly one buy_cover action.
      const key = (e: CoverBoughtEvent) => e.session === c.session.address && e.owner === c.wallet && e.product === product;
      const evs = c.events.filter((e): e is CoverBoughtEvent => e.type === "CoverBought" && key(e));
      const siblings = c.sameKindCount(
        (a) =>
          a.value.name === "buy_cover" &&
          a.value.product === product &&
          a.node.accounts[ROLES.buy_cover.buyer] === c.wallet &&
          a.node.accounts[ROLES.buy_cover.session] === c.session.address,
      );
      const event = siblings === 1 && evs.length === 1 ? evs[0] : null;
      if (unexpected || premium.length > 1 || (siblings === 1 && evs.length > 1)) return { kind: "CoverBought", product, amount: null };
      if (premium.length === 1) {
        const paid = premium[0].amount;
        if (event && event.buyerPaid !== paid) return { kind: "CoverBought", product, amount: null };
        return { kind: "CoverBought", product, amount: -paid };
      }
      // No premium transfer: only an unambiguous event can prove a genuine zero.
      return { kind: "CoverBought", product, amount: event && event.buyerPaid === 0n ? 0n : null };
    }
    case "claim":
    case "claim_cover": {
      if (acc("vault_0") !== v0 || acc("vault_1") !== v1) return null;
      let refund: boolean | null = null;
      let evAmounts: [bigint, bigint] | null = null;
      if (action.name === "claim") {
        const evs = c.events.filter(
          (e): e is ClaimedEvent => e.type === "Claimed" && e.session === c.session.address && e.owner === c.wallet,
        );
        if (evs.length === 1) {
          refund = evs[0].refund;
          evAmounts = evs[0].amounts;
        }
      }
      // Claims only succeed in a terminal state, so the session's current terminal state is authoritative.
      if (refund === null) {
        if (c.session.state === "Refunding") refund = true;
        else if (c.session.state === "Settled") refund = false;
        else return null; // recognized but kind unprovable; do not guess
      }
      const kind: ActivityKind = refund ? "Refund" : action.name === "claim" ? "PoolPayout" : "CoverPayout";
      const got = legSums(c.legs, [
        { source: v0, destination: c.ownerTa, authority: c.session.address },
        { source: v1, destination: c.ownerTa, authority: c.session.address },
      ]);
      const product = got ? productOf(got) : null;
      if (!got) return { kind, product: null, amount: null };
      if (evAmounts && (evAmounts[0] !== got[0] || evAmounts[1] !== got[1])) return { kind, product, amount: null };
      return { kind, product, amount: got[0] + got[1] };
    }
  }
}

/** Sums each expected leg; null if any transfer in the subtree is unexpected or a leg repeats. */
function legSums(
  legs: TokenTransfer[],
  expected: Array<{ source: string; destination: string; authority: string }>,
): bigint[] | null {
  const sums = expected.map(() => 0n);
  const seen = expected.map(() => 0);
  for (const t of legs) {
    const i = expected.findIndex((e) => e.source === t.source && e.destination === t.destination && e.authority === t.authority);
    if (i < 0) return null;
    seen[i]++;
    if (seen[i] > 1) return null;
    sums[i] += t.amount;
  }
  return sums;
}

function productOf(perProduct: readonly bigint[]): 0 | 1 | null {
  const nz = perProduct.map((v, i) => (v !== 0n ? i : -1)).filter((i) => i >= 0);
  return nz.length === 1 ? (nz[0] as 0 | 1) : null;
}

function tokenMeta(tx: HistoryTransaction, account: string) {
  return tx.tokenBalances.find((b) => tx.accountKeys[b.accountIndex] === account) ?? null;
}

/**
 * Per token account: does the sum of every decoded transfer equal its pre/post balance change?
 * A missing side (new or closed account) counts as zero. Accounts without balance metadata are
 * not judged (absent from the map). False means unseen movement, so attributed amounts are unsafe.
 */
export function reconcileTokenAccounts(tx: HistoryTransaction, transfers: TokenTransfer[]): Map<string, boolean> {
  const out = new Map<string, boolean>();
  for (const b of tx.tokenBalances) {
    const account = tx.accountKeys[b.accountIndex];
    if (!account || (b.preAmount === null && b.postAmount === null)) continue;
    const delta = BigInt(b.postAmount ?? "0") - BigInt(b.preAmount ?? "0");
    let seen = 0n;
    for (const t of transfers) {
      if (t.destination === account) seen += t.amount;
      if (t.source === account) seen -= t.amount;
    }
    out.set(account, seen === delta);
  }
  return out;
}
