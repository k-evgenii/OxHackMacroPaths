// Approved wallet-adapter dependencies, used for public-address access only. The adapters are loaded
// lazily in the browser; no ConnectionProvider, no adapter UI kit, no signing and no RPC calls are used.
import type { SupportedWallet } from "./contracts";
import type { InjectedWallet } from "./controller";

type Listener = (...args: unknown[]) => void;
type AdapterLike = {
  publicKey: { toString(): string } | null;
  readyState: string;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  on(event: string, listener: Listener): unknown;
  off(event: string, listener: Listener): unknown;
};

/** Expose an adapter through the controller's minimal surface ("accountChanged" maps to "connect"). */
export function wrapAdapter(adapter: AdapterLike): InjectedWallet {
  const map = (e: string) => (e === "accountChanged" ? "connect" : e);
  return {
    get publicKey() {
      return adapter.publicKey;
    },
    async connect() {
      await adapter.connect();
      return { publicKey: adapter.publicKey };
    },
    disconnect: () => adapter.disconnect(),
    on: (e, l) => adapter.on(map(e), l),
    off: (e, l) => adapter.off(map(e), l),
  };
}

const cache = new Map<SupportedWallet, InjectedWallet | null>();

/** Default resolver: Phantom only when the extension is installed; Solflare when supported. */
export async function loadAdapterWallet(wallet: SupportedWallet): Promise<InjectedWallet | null> {
  if (typeof window === "undefined") return null;
  if (cache.has(wallet)) return cache.get(wallet)!;
  const { WalletReadyState } = await import("@solana/wallet-adapter-base");
  let adapter: AdapterLike;
  if (wallet === "phantom") {
    const { PhantomWalletAdapter } = await import("@solana/wallet-adapter-phantom");
    adapter = new PhantomWalletAdapter() as unknown as AdapterLike;
    if (adapter.readyState !== WalletReadyState.Installed) return null; // re-checked on the next attempt
  } else {
    const { SolflareWalletAdapter } = await import("@solana/wallet-adapter-solflare");
    adapter = new SolflareWalletAdapter() as unknown as AdapterLike;
    if (adapter.readyState === WalletReadyState.Unsupported) return null;
  }
  const wrapped = wrapAdapter(adapter);
  cache.set(wallet, wrapped);
  return wrapped;
}
