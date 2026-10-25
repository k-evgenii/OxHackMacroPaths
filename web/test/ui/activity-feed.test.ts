// ActivityFeed list keys must be unique even when one transaction emits two events of the same type.
import { describe, expect, it, vi } from "vitest";
import { isValidElement, type ReactNode } from "react";
import type { EventView } from "@macropaths/client";

const fake = vi.hoisted(() => ({ query: undefined as unknown }));
vi.mock("@/lib/hooks", async (orig) => ({ ...(await orig<typeof import("@/lib/hooks")>()), useEvents: () => fake.query }));

import { ActivityFeed } from "@/app/session/[addr]/activity/ActivityFeed";

const SIG = "3".repeat(87);
const OWNER = "B89zLLRMtmwAKP5idiUt6ffzfetNo6xRZBbXpDVaBVju";
const claimed = (refund: boolean): EventView => ({
  type: "Claimed",
  signature: SIG,
  slot: 1,
  blockTime: null,
  data: { owner: OWNER, amounts: ["1", "2"], refund },
});

/** Keys of every <li> in an unrendered element tree. */
function liKeys(node: ReactNode): (string | null)[] {
  if (Array.isArray(node)) return node.flatMap(liKeys);
  if (!isValidElement<{ children?: ReactNode }>(node)) return [];
  const own = node.type === "li" ? [node.key] : [];
  return [...own, ...liKeys(node.props.children)];
}

describe("ActivityFeed", () => {
  it("gives same-type events from one transaction distinct keys", () => {
    fake.query = {
      isPending: false,
      isError: false,
      data: { pages: [{ events: [claimed(false), claimed(true)], nextBefore: null }] },
      hasNextPage: false,
      isFetchingNextPage: false,
    };
    const keys = liKeys(ActivityFeed({ addr: OWNER }));
    expect(keys).toHaveLength(2);
    expect(new Set(keys).size).toBe(2);
  });
});
