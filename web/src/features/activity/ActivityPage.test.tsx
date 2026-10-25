// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

const state = vi.hoisted(() => ({
  wallet: { owner: null as string | null, status: "disconnected", error: null, connect: vi.fn(), disconnect: vi.fn() },
  activity: {} as Record<string, unknown>,
  activityCalls: [] as unknown[],
  overview: {} as Record<string, unknown>,
}));

// The shared PostCSS (tailwind) config is not loadable by vite in tests; class names are irrelevant here.
vi.mock("./activity.module.css", () => ({ default: new Proxy({}, { get: (_t, k) => String(k) }) }));
vi.mock("@/features/wallet-connect", () => ({ useWalletConnection: () => state.wallet }));
vi.mock("@/features/shell", () => ({
  useSelectedSession: () => ({ address: "Sess1111111111111111111111111111111111111", status: "ready", select: vi.fn() }),
}));
vi.mock("@/lib/hooks", () => ({
  useWalletActivity: (owner: string | null) => {
    state.activityCalls.push(owner);
    return state.activity;
  },
  useSessionOverview: () => state.overview,
}));

import { ActivityPage } from "./ActivityPage";

const SIG = "5".repeat(88);
const item = (id: string, kind: string, amount: string | null) => ({
  id,
  signature: SIG,
  instructionIndex: 0,
  innerInstructionIndex: null,
  session: "Sess1111111111111111111111111111111111111",
  product: 0,
  slot: 1,
  blockTime: null,
  kind,
  amount,
  mint: "Mint111111111111111111111111111111111111",
});

afterEach(() => {
  cleanup();
  state.activityCalls.length = 0;
});

describe("ActivityPage", () => {
  it("disconnected: explains wallet need, switches to Market without history requests", () => {
    state.wallet = { ...state.wallet, owner: null, status: "disconnected" };
    state.overview = {
      status: "success",
      data: { session: { state: "Running", nObs: 48, nextIndex: 1, path: [{ i: 0, periodId: 202303, value: "49800" }] } },
    };
    render(<ActivityPage />);
    expect(screen.getByText("Connect a wallet to see your activity")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Connect wallet" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Show market activity" }));
    expect(screen.getByRole("radio", { name: "Market" }).getAttribute("aria-checked")).toBe("true");
    expect(screen.getByText("Mar 2023 recorded: 4.98 %")).toBeTruthy();
    expect(screen.queryByRole("link")).toBeNull();
    expect(state.activityCalls).toEqual([]);
  });

  it("partial page: shows loaded rows, separate same-signature actions, and a manual retry once automatic recovery stops", () => {
    const retry = vi.fn();
    state.wallet = { ...state.wallet, owner: "Owner11111111111111111111111111111111111", status: "connected" };
    state.activity = {
      status: "success",
      data: {
        pages: [
          {
            items: [item("a", "CoverBought", "-1000000"), item("b", "PoolDeposit", null)],
            pending: ["4".repeat(88)],
            retryCursor: "tok",
            nextBefore: SIG,
          },
        ],
      },
      isFetching: false,
      isFetchingNextPage: false,
      isRefetchError: false,
      isFetchNextPageError: false,
      recovery: { pending: 1, status: "exhausted", needsRefresh: false, retry },
      refetch: vi.fn(),
      fetchNextPage: vi.fn(),
    };
    render(<ActivityPage />);
    expect(screen.getByText(/Some transactions are still loading \(1\)/)).toBeTruthy();
    expect(screen.getByText("Cover purchased")).toBeTruthy();
    expect(screen.getByText("Pool deposit")).toBeTruthy();
    expect(screen.getByText("Amount unavailable")).toBeTruthy();
    expect(screen.getByText("Date unavailable")).toBeTruthy();
    expect(screen.getAllByRole("link", { name: /Solana Explorer/ })).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "Retry now" }));
    expect(retry).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: "Load more" })).toBeTruthy();
  });
});
