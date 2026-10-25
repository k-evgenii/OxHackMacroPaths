"use client";
// Must be mounted inside the app's QueryClientProvider (root wiring: worker 15).
import { createContext, useContext, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import type { WalletConnectionProviderProps, WalletConnectionValue } from "./contracts";
import { DISCONNECTED, WalletConnectionController, type WalletResolver, type WalletSnapshot } from "./controller";

type ContextValue = WalletConnectionValue & { wallet: WalletSnapshot["wallet"] };

const WalletContext = createContext<ContextValue | null>(null);

/** Cancel in-flight requests for a previous owner and drop its cached personal data. */
export function clearOwnerQueries(client: QueryClient, owner: string): void {
  const queryKey = ["wallet", owner];
  void client.cancelQueries({ queryKey });
  client.removeQueries({ queryKey });
}

const serverSnapshot = () => DISCONNECTED;

export function WalletConnectionProvider({
  children,
  resolver,
}: WalletConnectionProviderProps & { /** Test seam: injected-wallet lookup. */ resolver?: WalletResolver }) {
  const client = useQueryClient();
  const [controller] = useState(() => new WalletConnectionController(resolver));
  useEffect(() => controller.onOwnerChange((previous) => clearOwnerQueries(client, previous)), [controller, client]);
  const snap = useSyncExternalStore(controller.subscribe, controller.getSnapshot, serverSnapshot);
  const value = useMemo<ContextValue>(
    () => ({
      owner: snap.owner,
      status: snap.status,
      error: snap.error,
      wallet: snap.wallet,
      connect: controller.connect,
      disconnect: controller.disconnect,
    }),
    [snap, controller],
  );
  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

/**
 * Provides wallet connection only when no outer WalletConnectionProvider exists, so the shell works
 * before and after the root wiring adds the provider (no second, competing connection).
 */
export function EnsureWalletConnection({ children }: { children: React.ReactNode }) {
  return useContext(WalletContext) ? <>{children}</> : <WalletConnectionProvider>{children}</WalletConnectionProvider>;
}

function useWalletContext(): ContextValue {
  const v = useContext(WalletContext);
  if (!v) throw new Error("useWalletConnection must be used inside <WalletConnectionProvider>.");
  return v;
}

/** Public owner address and connection state. Address access only: no signing, no browser RPC. */
export function useWalletConnection(): WalletConnectionValue {
  const { owner, status, error, connect, disconnect } = useWalletContext();
  return useMemo(() => ({ owner, status, error, connect, disconnect }), [owner, status, error, connect, disconnect]);
}

/** Shell-only detail: which wallet is selected (for labels in the wallet control). */
export function useSelectedWalletName() {
  return useWalletContext().wallet;
}
