"use client";
// Shortened address with an explicit copy control; result announced politely.
import { useState } from "react";
import type { SupportedWallet } from "./contracts";
import { WALLET_LABELS } from "./controller";
import { useWalletConnection } from "./WalletConnectionProvider";

const btn =
  "inline-flex min-h-11 items-center justify-center rounded-xl border border-border px-3 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary";

export function shortAddress(a: string, n = 4): string {
  return a.length <= n * 2 + 1 ? a : `${a.slice(0, n)}…${a.slice(-n)}`;
}

export function CopyableAddress({ address, label = "address", className = "" }: { address: string; label?: string; className?: string }) {
  const [msg, setMsg] = useState("");
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(address);
      setMsg("Address copied to clipboard.");
    } catch {
      setMsg("Could not copy the address.");
    }
  };
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <span className="font-mono text-sm" title={address}>
        {shortAddress(address)}
      </span>
      <button type="button" onClick={copy} className={btn} aria-label={`Copy ${label}`}>
        Copy
      </button>
      <span className="sr-only" role="status" aria-live="polite">
        {msg}
      </span>
    </span>
  );
}

/** Phantom/Solflare choice that calls connect() from useWalletConnection (address access only). */
export function WalletPicker({ heading = "Connect with", onChosen }: { heading?: string; onChosen?: (w: SupportedWallet) => void }) {
  const { connect, status } = useWalletConnection();
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1 text-xs font-medium text-muted">{heading}</legend>
      {(Object.keys(WALLET_LABELS) as SupportedWallet[]).map((w) => (
        <button
          key={w}
          type="button"
          disabled={status === "connecting"}
          onClick={() => {
            onChosen?.(w);
            void connect(w);
          }}
          className={`${btn} justify-start bg-surface-2 text-text`}
        >
          {WALLET_LABELS[w]}
        </button>
      ))}
    </fieldset>
  );
}
