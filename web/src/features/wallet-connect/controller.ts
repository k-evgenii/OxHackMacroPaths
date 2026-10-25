// Read-only wallet connection: requests public-address access from an injected Phantom/Solflare
// provider. It never asks for message signatures, never signs/sends transactions, and never performs
// RPC reads. Balances and holdings come from the application API keyed by `owner`.
import type { SupportedWallet, WalletConnectionStatus } from "./contracts";
import { loadAdapterWallet } from "./adapters";

type PublicKeyLike = { toString(): string } | null | undefined;
type Listener = (...args: unknown[]) => void;

/** Minimal surface of an injected Solana wallet that this module uses (address access only). */
export type InjectedWallet = {
  publicKey?: PublicKeyLike;
  connect(options?: { onlyIfTrusted?: boolean }): Promise<unknown>;
  disconnect(): Promise<unknown>;
  on?(event: string, listener: Listener): unknown;
  off?(event: string, listener: Listener): unknown;
  removeListener?(event: string, listener: Listener): unknown;
};

export type WalletResolver = (wallet: SupportedWallet) => InjectedWallet | null | Promise<InjectedWallet | null>;

export const WALLET_LABELS: Record<SupportedWallet, string> = { phantom: "Phantom", solflare: "Solflare" };

const BASE58_PUBKEY = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/** Find the injected provider for a wallet in a browser window (or a test double). */
export function findInjectedWallet(wallet: SupportedWallet, win: unknown = globalThis): InjectedWallet | null {
  const w = win as {
    phantom?: { solana?: InjectedWallet & { isPhantom?: boolean } };
    solana?: InjectedWallet & { isPhantom?: boolean };
    solflare?: InjectedWallet & { isSolflare?: boolean };
  } | null;
  if (!w) return null;
  if (wallet === "phantom") {
    if (w.phantom?.solana?.isPhantom) return w.phantom.solana;
    if (w.solana?.isPhantom) return w.solana;
    return null;
  }
  return w.solflare?.isSolflare ? w.solflare : null;
}

export type WalletSnapshot = {
  owner: string | null;
  status: WalletConnectionStatus;
  error: string | null;
  wallet: SupportedWallet | null;
};

export const DISCONNECTED: WalletSnapshot = Object.freeze({ owner: null, status: "disconnected", error: null, wallet: null });

function keyToOwner(key: PublicKeyLike): string | null {
  const s = key ? key.toString() : "";
  return BASE58_PUBKEY.test(s) ? s : null;
}

function isRejection(err: unknown): boolean {
  const e = err as { code?: number; message?: string; name?: string } | null;
  return e?.code === 4001 || /reject|declin|cancel/i.test(`${e?.name ?? ""} ${e?.message ?? ""}`);
}

/**
 * Connection state machine. Late results of a superseded connect (disconnect/switch while pending)
 * are discarded via a sequence number, so a previous wallet can never re-enter the view.
 */
export class WalletConnectionController {
  private snapshot: WalletSnapshot = DISCONNECTED;
  private listeners = new Set<() => void>();
  private ownerListeners = new Set<(previous: string, next: string | null) => void>();
  private seq = 0;
  private active: { provider: InjectedWallet; detach(): void } | null = null;

  constructor(private readonly resolve: WalletResolver = loadAdapterWallet) {}

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): WalletSnapshot => this.snapshot;

  /** Called synchronously, before subscribers render, whenever a non-null owner is replaced or cleared. */
  onOwnerChange(listener: (previous: string, next: string | null) => void): () => void {
    this.ownerListeners.add(listener);
    return () => {
      this.ownerListeners.delete(listener);
    };
  }

  private set(next: WalletSnapshot) {
    const previous = this.snapshot.owner;
    this.snapshot = next;
    if (previous && previous !== next.owner) for (const l of this.ownerListeners) l(previous, next.owner);
    for (const l of this.listeners) l();
  }

  private release(): InjectedWallet | null {
    const a = this.active;
    this.active = null;
    a?.detach();
    return a?.provider ?? null;
  }

  connect = async (wallet: SupportedWallet): Promise<void> => {
    const seq = ++this.seq;
    const previous = this.release();
    // Switching: clear the previous owner's view immediately.
    this.set({ owner: null, status: "connecting", error: null, wallet });
    if (previous) void previous.disconnect().catch(() => undefined);

    const label = WALLET_LABELS[wallet];
    let provider: InjectedWallet | null;
    try {
      provider = await this.resolve(wallet);
    } catch {
      provider = null;
    }
    if (seq !== this.seq) return;
    if (!provider) {
      this.set({
        owner: null,
        status: "error",
        wallet,
        error: `${label} was not found. Install the ${label} browser extension, then reload this page.`,
      });
      return;
    }
    let result: unknown;
    try {
      result = await provider.connect();
    } catch (err) {
      if (seq !== this.seq) return;
      this.set({
        owner: null,
        status: "error",
        wallet,
        error: isRejection(err) ? `The connection request was declined in ${label}.` : `Could not connect to ${label}. Try again.`,
      });
      return;
    }
    if (seq !== this.seq) return; // superseded by disconnect or another connect
    const owner = keyToOwner((result as { publicKey?: PublicKeyLike } | null)?.publicKey ?? provider.publicKey);
    if (!owner) {
      this.set({ owner: null, status: "error", wallet, error: `${label} did not share a valid public address.` });
      return;
    }
    this.attach(provider, wallet, seq);
    this.set({ owner, status: "connected", error: null, wallet });
  };

  disconnect = async (): Promise<void> => {
    this.seq++;
    const provider = this.release();
    this.set(DISCONNECTED);
    if (provider) await provider.disconnect().catch(() => undefined);
  };

  private attach(provider: InjectedWallet, wallet: SupportedWallet, seq: number) {
    const onAccount: Listener = (key) => {
      if (seq !== this.seq) return;
      const owner = keyToOwner(key as PublicKeyLike);
      // Phantom reports null when the newly selected account has not approved this site.
      if (!owner) {
        this.seq++;
        this.release();
        this.set(DISCONNECTED);
        return;
      }
      if (owner !== this.snapshot.owner) this.set({ owner, status: "connected", error: null, wallet });
    };
    const onDisconnect: Listener = () => {
      if (seq !== this.seq) return;
      this.seq++;
      this.release();
      this.set(DISCONNECTED);
    };
    provider.on?.("accountChanged", onAccount);
    provider.on?.("disconnect", onDisconnect);
    this.active = {
      provider,
      detach: () => {
        const off = (e: string, l: Listener) => (provider.off ? provider.off(e, l) : provider.removeListener?.(e, l));
        off("accountChanged", onAccount);
        off("disconnect", onDisconnect);
      },
    };
  }
}
