"use client";
// Top-bar wallet control: choose Phantom/Solflare, shortened address with explicit copy, switch and
// disconnect. Connection is public-address access only.
import { useEffect, useId, useRef, useState } from "react";
import type { SupportedWallet } from "./contracts";
import { WALLET_LABELS } from "./controller";
import { useSelectedWalletName, useWalletConnection } from "./WalletConnectionProvider";

export function shortenAddress(a: string, n = 4): string {
  return a.length <= n * 2 + 1 ? a : `${a.slice(0, n)}…${a.slice(-n)}`;
}

const btn =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary";

function useDismiss(open: boolean, close: () => void, root: React.RefObject<HTMLElement | null>, trigger: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        close();
        trigger.current?.focus();
      }
    };
    const onPointer = (e: PointerEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) close();
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [open, close, root, trigger]);
}

export function WalletControl() {
  const { owner, status, error, connect, disconnect } = useWalletConnection();
  const wallet = useSelectedWalletName();
  const [open, setOpen] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const close = () => setOpen(false);
  useDismiss(open, close, root, trigger);

  // Announce connection outcomes politely; errors are additionally rendered with role="alert".
  useEffect(() => {
    if (status === "connected" && owner) setAnnouncement(`Wallet connected: ${shortenAddress(owner)}`);
    else if (status === "disconnected") setAnnouncement("");
  }, [status, owner]);

  const choose = async (w: SupportedWallet) => {
    setOpen(false);
    await connect(w);
    trigger.current?.focus();
  };

  const copy = async () => {
    if (!owner) return;
    try {
      await navigator.clipboard.writeText(owner);
      setAnnouncement("Address copied to clipboard.");
    } catch {
      setAnnouncement("Could not copy the address. Select it and copy manually.");
    }
  };

  const connected = status === "connected" && owner;
  const label = connected ? shortenAddress(owner) : status === "connecting" ? "Connecting…" : "Connect wallet";

  return (
    <div ref={root} className="relative">
      <button
        ref={trigger}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        aria-busy={status === "connecting" || undefined}
        disabled={status === "connecting"}
        onClick={() => setOpen((o) => !o)}
        className={`${btn} ${connected ? "border border-border bg-surface font-mono text-text" : "bg-primary text-primary-ink"} disabled:opacity-70`}
        aria-label={connected ? `Wallet ${shortenAddress(owner)}${wallet ? ` (${WALLET_LABELS[wallet]})` : ""}: options` : undefined}
      >
        {label}
      </button>

      {open && (
        <div
          id={panelId}
          role="group"
          aria-label={connected ? "Wallet options" : "Choose a wallet"}
          className="absolute right-0 z-50 mt-2 w-72 max-w-[calc(100vw-2rem)] rounded-2xl border border-border bg-surface p-3 shadow-lg"
        >
          {connected ? (
            <div className="flex flex-col gap-2">
              <p className="text-xs text-muted">Connected{wallet ? ` with ${WALLET_LABELS[wallet]}` : ""}. Address access only.</p>
              <p className="break-all font-mono text-xs text-text" title={owner}>
                {owner}
              </p>
              <button type="button" onClick={copy} className={`${btn} border border-border`} aria-label="Copy wallet address">
                Copy address
              </button>
              <ChooseWallet onChoose={choose} heading="Switch wallet" />
              <button
                type="button"
                onClick={async () => {
                  setOpen(false);
                  await disconnect();
                  setAnnouncement("Wallet disconnected.");
                  trigger.current?.focus();
                }}
                className={`${btn} border border-border text-down`}
              >
                Disconnect
              </button>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              <ChooseWallet onChoose={choose} />
              <p className="text-xs text-muted">
                Shares your public address only. No signature or transaction is requested.
              </p>
            </div>
          )}
        </div>
      )}

      {status === "error" && error && (
        <p role="alert" className="absolute right-0 mt-2 w-72 max-w-[calc(100vw-2rem)] rounded-xl border border-down/30 bg-surface p-2 text-xs text-down">
          {error}
        </p>
      )}
      <span className="sr-only" role="status" aria-live="polite">
        {announcement}
      </span>
    </div>
  );
}

function ChooseWallet({ onChoose, heading = "Connect with" }: { onChoose: (w: SupportedWallet) => void; heading?: string }) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1 text-xs font-medium text-muted">{heading}</legend>
      {(Object.keys(WALLET_LABELS) as SupportedWallet[]).map((w) => (
        <button key={w} type="button" onClick={() => onChoose(w)} className={`${btn} justify-start border border-border bg-surface-2 text-text`}>
          {WALLET_LABELS[w]}
        </button>
      ))}
    </fieldset>
  );
}
