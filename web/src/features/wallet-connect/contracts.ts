// Frozen wallet connection contract (interfaces.md "Query and wallet interfaces"). Types only:
// worker 10 implements WalletConnectionProvider / useWalletConnection in this directory's index.ts.
// Connection exposes address access only; no transaction signing and no browser RPC data reads.
import type { ReactNode } from "react";

export type SupportedWallet = "phantom" | "solflare";

export type WalletConnectionStatus = "disconnected" | "connecting" | "connected" | "error";

export type WalletConnectionValue = {
  owner: string | null;
  status: WalletConnectionStatus;
  error: string | null;
  connect(wallet: SupportedWallet): Promise<void>;
  disconnect(): Promise<void>;
};

export type WalletConnectionProviderProps = { children: ReactNode };

/** Shape of `useSelectedSession()`, exported by worker 10 from `@/features/shell`. */
export type SelectedSession = {
  address: string | null;
  status: "loading" | "ready" | "invalid" | "unavailable";
  select(address: string): void;
};
export type UseSelectedSession = () => SelectedSession;
