import { describe, expect, it } from "vitest";
import { decodeWalletActivity } from "@/server/wallet/decode/attribute";
import { ROLES } from "@/server/wallet/decode/instructions";
import {
  OTHER, OTHER_TA, OWNER_TA, S2_VAULT0, SELLER_TA, SESSION, SESSION2, S2_VAULT1, UNREGISTERED, VAULT0, VAULT1, WALLET,
  balance, buyCoverIx, claimIx, claimedLog, coverBoughtLog, depositIx, programLogs, session, session2, sessionsMap, transferIx, tx,
} from "./builders";

const open = sessionsMap(session());
const settled = sessionsMap(session({ state: "Settled" }));
const refunding = sessionsMap(session({ state: "Refunding" }));

describe("IDL account roles", () => {
  it("matches the program layout this decoder assumes", () => {
    expect(ROLES.deposit).toMatchObject({ owner: 0, session: 1, owner_ta: 3, vault_0: 4, vault_1: 5 });
    expect(ROLES.buy_cover).toMatchObject({ buyer: 0, session: 1, seller_ta: 4, buyer_ta: 6, vault: 7 });
    expect(ROLES.claim).toMatchObject({ owner: 0, session: 1, owner_ta: 3, vault_0: 4, vault_1: 5 });
    expect(ROLES.claim_cover).toMatchObject({ owner: 0, session: 1, owner_ta: 3, vault_0: 4, vault_1: 5 });
  });
});

describe("deposit", () => {
  it("appears without any program event, amount from owner->vault legs", () => {
    const t = tx([
      depositIx({ ix: 0 }, [5n, 0n, 0n, 0n]),
      transferIx({ ix: 0, inner: 0 }, OWNER_TA, VAULT0, WALLET, 5n),
    ]);
    const [item] = decodeWalletActivity(t, WALLET, open);
    expect(item).toMatchObject({ kind: "PoolDeposit", amount: "-5", product: 0, session: SESSION, instructionIndex: 0, innerInstructionIndex: null });
    expect(item.id).toBe(`${t.signature}:0:top:PoolDeposit`);
  });

  it("two-product deposit is one item with product null and summed amount", () => {
    const t = tx([
      depositIx({ ix: 0 }, [1n, 2n, 3n, 4n]),
      transferIx({ ix: 0, inner: 0 }, OWNER_TA, VAULT0, WALLET, 3n),
      transferIx({ ix: 0, inner: 1 }, OWNER_TA, VAULT1, WALLET, 7n, true),
    ]);
    const items = decodeWalletActivity(t, WALLET, open);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ product: null, amount: "-10" });
  });

  it("mismatched legs vs decoded side amounts yield amount null", () => {
    const t = tx([depositIx({ ix: 0 }, [5n, 0n, 0n, 0n]), transferIx({ ix: 0, inner: 0 }, OWNER_TA, VAULT0, WALLET, 4n)]);
    expect(decodeWalletActivity(t, WALLET, open)[0].amount).toBeNull();
  });

  it("decodes an inner (CPI) deposit and only counts its own subtree", () => {
    const t = tx([
      { ...transferIx({ ix: 0 }, OWNER_TA, OTHER_TA, WALLET, 99n) }, // unrelated top-level transfer
      { instructionIndex: 1, innerInstructionIndex: null, parentInnerInstructionIndex: null, programId: OTHER, accounts: [], dataBase64: "" },
      depositIx({ ix: 1, inner: 0, parent: null }, [0n, 0n, 0n, 8n]),
      transferIx({ ix: 1, inner: 1, parent: 0 }, OWNER_TA, VAULT1, WALLET, 8n),
    ]);
    const [item] = decodeWalletActivity(t, WALLET, open);
    expect(item).toMatchObject({ instructionIndex: 1, innerInstructionIndex: 0, amount: "-8", product: 1 });
    expect(item.id).toBe(`${t.signature}:1:0:PoolDeposit`);
  });

  it("unresolved parentage touching the owner account makes the amount unavailable", () => {
    const t = tx([
      { instructionIndex: 0, innerInstructionIndex: null, parentInnerInstructionIndex: null, programId: OTHER, accounts: [], dataBase64: "" },
      depositIx({ ix: 0, inner: 0 }, [8n, 0n, 0n, 0n]),
      transferIx({ ix: 0, inner: 2, parent: 7 }, OWNER_TA, VAULT0, WALLET, 8n), // parent 7 does not exist
    ]);
    const [item] = decodeWalletActivity(t, WALLET, open);
    expect(item.kind).toBe("PoolDeposit");
    expect(item.amount).toBeNull();
  });
});

describe("buy_cover", () => {
  it("reports buyer premium only, not units or seller funding", () => {
    const t = tx(
      [
        buyCoverIx({ ix: 0 }, 1, 1_000_000n),
        transferIx({ ix: 0, inner: 0 }, OWNER_TA, VAULT1, WALLET, 300n),
        transferIx({ ix: 0, inner: 1 }, SELLER_TA, VAULT1, SESSION, 700n),
      ],
      { logs: programLogs(coverBoughtLog(WALLET, 1, 1_000_000n, 300n, 700n)) },
    );
    const [item] = decodeWalletActivity(t, WALLET, open);
    expect(item).toMatchObject({ kind: "CoverBought", product: 1, amount: "-300" });
  });

  it("event disagreeing with the premium leg yields null", () => {
    const t = tx(
      [buyCoverIx({ ix: 0 }, 0, 10n), transferIx({ ix: 0, inner: 0 }, OWNER_TA, VAULT0, WALLET, 300n)],
      { logs: programLogs(coverBoughtLog(WALLET, 0, 10n, 301n, 0n)) },
    );
    expect(decodeWalletActivity(t, WALLET, open)[0].amount).toBeNull();
  });

  it("genuine zero premium needs event proof; otherwise null", () => {
    const withEvent = tx([buyCoverIx({ ix: 0 }, 0, 10n)], { logs: programLogs(coverBoughtLog(WALLET, 0, 10n, 0n, 5n)) });
    expect(decodeWalletActivity(withEvent, WALLET, open)[0].amount).toBe("0");
    const without = tx([buyCoverIx({ ix: 0 }, 0, 10n)]);
    expect(decodeWalletActivity(without, WALLET, open)[0].amount).toBeNull();
  });

  it("vault not matching the product's session vault is rejected", () => {
    const t = tx([buyCoverIx({ ix: 0 }, 0, 10n, { vault: VAULT1 })]);
    expect(decodeWalletActivity(t, WALLET, open)).toEqual([]);
  });
});

describe("claims", () => {
  it("pool claim sums vault->owner legs and reconciles with Claimed", () => {
    const t = tx(
      [
        claimIx({ ix: 0 }, "claim"),
        transferIx({ ix: 0, inner: 0 }, VAULT0, OWNER_TA, SESSION, 40n),
        transferIx({ ix: 0, inner: 1 }, VAULT1, OWNER_TA, SESSION, 2n),
      ],
      { logs: programLogs(claimedLog(SESSION, WALLET, [40n, 2n], false)) },
    );
    expect(decodeWalletActivity(t, WALLET, settled)[0]).toMatchObject({ kind: "PoolPayout", amount: "42", product: null });
  });

  it("Claimed event mismatch yields null amount", () => {
    const t = tx(
      [claimIx({ ix: 0 }, "claim"), transferIx({ ix: 0, inner: 0 }, VAULT0, OWNER_TA, SESSION, 40n)],
      { logs: programLogs(claimedLog(SESSION, WALLET, [41n, 0n], false)) },
    );
    expect(decodeWalletActivity(t, WALLET, settled)[0].amount).toBeNull();
  });

  it("cover claim appears without any event", () => {
    const t = tx([claimIx({ ix: 0 }, "claim_cover"), transferIx({ ix: 0, inner: 0 }, VAULT0, OWNER_TA, SESSION, 9n)]);
    expect(decodeWalletActivity(t, WALLET, settled)[0]).toMatchObject({ kind: "CoverPayout", amount: "9", product: 0 });
  });

  it("refund classification uses the event flag", () => {
    const t = tx(
      [claimIx({ ix: 0 }, "claim"), transferIx({ ix: 0, inner: 0 }, VAULT0, OWNER_TA, SESSION, 5n)],
      { logs: programLogs(claimedLog(SESSION, WALLET, [5n, 0n], true)) },
    );
    expect(decodeWalletActivity(t, WALLET, settled)[0].kind).toBe("Refund");
  });

  it("refund classification uses the terminal Refunding session for cover claims", () => {
    const t = tx([claimIx({ ix: 0 }, "claim_cover"), transferIx({ ix: 0, inner: 0 }, VAULT1, OWNER_TA, SESSION, 5n)]);
    expect(decodeWalletActivity(t, WALLET, refunding)[0]).toMatchObject({ kind: "Refund", amount: "5", product: 1 });
  });

  it("without event or terminal state, kind is unprovable and no row is invented", () => {
    const t = tx([claimIx({ ix: 0 }, "claim_cover"), transferIx({ ix: 0, inner: 0 }, VAULT0, OWNER_TA, SESSION, 5n)]);
    expect(decodeWalletActivity(t, WALLET, open)).toEqual([]);
  });
});

describe("multi-action transactions", () => {
  it("two actions in one signature get distinct IDs and their own amounts", () => {
    const t = tx(
      [
        claimIx({ ix: 0 }, "claim"),
        transferIx({ ix: 0, inner: 0 }, VAULT0, OWNER_TA, SESSION, 10n),
        claimIx({ ix: 1 }, "claim_cover"),
        transferIx({ ix: 1, inner: 0 }, VAULT1, OWNER_TA, SESSION, 3n),
      ],
      { logs: programLogs(claimedLog(SESSION, WALLET, [10n, 0n], false)) },
    );
    const items = decodeWalletActivity(t, WALLET, settled);
    expect(items.map((i) => [i.kind, i.amount])).toEqual([["PoolPayout", "10"], ["CoverPayout", "3"]]);
    expect(new Set(items.map((i) => i.id)).size).toBe(2);
  });

  it("two sessions in one signature cannot cross-attribute transfers", () => {
    const sessions = sessionsMap(session({ state: "Settled" }), session2({ state: "Refunding" }));
    const t = tx([
      claimIx({ ix: 0 }, "claim_cover"),
      transferIx({ ix: 0, inner: 0 }, VAULT0, OWNER_TA, SESSION, 10n),
      claimIx({ ix: 1 }, "claim_cover", { session: SESSION2, vaults: [S2_VAULT0, S2_VAULT1] }),
      transferIx({ ix: 1, inner: 0 }, S2_VAULT1, OWNER_TA, SESSION2, 4n),
    ]);
    const items = decodeWalletActivity(t, WALLET, sessions);
    expect(items).toMatchObject([
      { session: SESSION, kind: "CoverPayout", amount: "10", product: 0 },
      { session: SESSION2, kind: "Refund", amount: "4", product: 1 },
    ]);
  });

  it("a sibling's transfer misplaced in another subtree makes that action ambiguous (null)", () => {
    const sessions = sessionsMap(session({ state: "Settled" }), session2({ state: "Settled" }));
    const t = tx([
      claimIx({ ix: 0 }, "claim_cover"),
      transferIx({ ix: 0, inner: 0 }, VAULT0, OWNER_TA, SESSION, 10n),
      transferIx({ ix: 0, inner: 1 }, S2_VAULT0, OWNER_TA, SESSION2, 1n),
      claimIx({ ix: 1 }, "claim_cover", { session: SESSION2, vaults: [S2_VAULT0, S2_VAULT1] }),
    ]);
    const [a, b] = decodeWalletActivity(t, WALLET, sessions);
    expect(a.amount).toBeNull();
    expect(b.amount).toBe("0");
  });
});

describe("filtering", () => {
  it("wrong owner, unregistered session, other program and failed tx yield nothing", () => {
    const base = transferIx({ ix: 0, inner: 0 }, OWNER_TA, VAULT0, WALLET, 5n);
    expect(decodeWalletActivity(tx([depositIx({ ix: 0 }, [5n, 0n, 0n, 0n], { owner: OTHER }), base]), WALLET, open)).toEqual([]);
    expect(decodeWalletActivity(tx([depositIx({ ix: 0 }, [5n, 0n, 0n, 0n], { session: UNREGISTERED }), base]), WALLET, open)).toEqual([]);
    expect(decodeWalletActivity(tx([depositIx({ ix: 0 }, [5n, 0n, 0n, 0n], { programId: OTHER }), base]), WALLET, open)).toEqual([]);
    expect(decodeWalletActivity(tx([depositIx({ ix: 0 }, [5n, 0n, 0n, 0n]), base], { failed: true }), WALLET, open)).toEqual([]);
  });

  it("wallet merely appearing as a non-signer account is not personal activity", () => {
    const t = tx([depositIx({ ix: 0 }, [5n, 0n, 0n, 0n], { owner: OTHER, ta: OTHER_TA })], { accountKeys: [WALLET] });
    expect(decodeWalletActivity(t, WALLET, open)).toEqual([]);
  });

  it("token account metadata owned by someone else rejects the action", () => {
    const t = tx([depositIx({ ix: 0 }, [5n, 0n, 0n, 0n]), transferIx({ ix: 0, inner: 0 }, OWNER_TA, VAULT0, WALLET, 5n)], {
      tokenBalances: [balance(OWNER_TA, "5", "0", OTHER)],
    });
    expect(decodeWalletActivity(t, WALLET, open)).toEqual([]);
  });
});

describe("token balance reconciliation", () => {
  it("new token account (no pre balance) and SOL rent changes do not corrupt PLAY amounts", () => {
    const t = tx(
      [claimIx({ ix: 0 }, "claim_cover"), transferIx({ ix: 0, inner: 0 }, VAULT0, OWNER_TA, SESSION, 9n)],
      { tokenBalances: [balance(OWNER_TA, null, "9")] },
    );
    expect(decodeWalletActivity(t, WALLET, settled)[0].amount).toBe("9");
  });

  it("closed token account (no post balance) reconciles to zero", () => {
    const t = tx(
      [depositIx({ ix: 0 }, [5n, 0n, 0n, 0n]), transferIx({ ix: 0, inner: 0 }, OWNER_TA, VAULT0, WALLET, 5n)],
      { tokenBalances: [balance(OWNER_TA, "5", null)] },
    );
    expect(decodeWalletActivity(t, WALLET, open)[0].amount).toBe("-5");
  });

  it("unseen movement on the owner account makes amounts unavailable instead of repeating the net delta", () => {
    const t = tx(
      [depositIx({ ix: 0 }, [5n, 0n, 0n, 0n]), transferIx({ ix: 0, inner: 0 }, OWNER_TA, VAULT0, WALLET, 5n)],
      { tokenBalances: [balance(OWNER_TA, "100", "90")] },
    );
    expect(decodeWalletActivity(t, WALLET, open)[0].amount).toBeNull();
  });
});

describe("timestamps", () => {
  it("unknown block time stays null", () => {
    const t = tx([claimIx({ ix: 0 }, "claim_cover"), transferIx({ ix: 0, inner: 0 }, VAULT0, OWNER_TA, SESSION, 1n)], { blockTime: null });
    expect(decodeWalletActivity(t, WALLET, settled)[0].blockTime).toBeNull();
  });
});
