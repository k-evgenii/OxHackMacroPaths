"use client";
import { useEffect, useState } from "react";
import { explorerUrl } from "@/lib/api-client";
import { fmtTime, shortAddr } from "@/lib/hooks/format";

/** Shortened pubkey or tx signature with a copy button and a Solana Explorer link. */
export function Addr({ value, kind = "address", full = false }: { value: string; kind?: "address" | "tx"; full?: boolean }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const id = setTimeout(() => setCopied(false), 1200);
    return () => clearTimeout(id);
  }, [copied]);
  const copy = () => navigator.clipboard?.writeText(value).then(() => setCopied(true), () => {});
  return (
    <span className="inline-flex min-w-0 max-w-full items-center gap-1 font-mono text-sm">
      <a
        href={explorerUrl(kind, value)}
        target="_blank"
        rel="noreferrer"
        title={value}
        className={`text-primary hover:underline ${full ? "break-all" : "truncate"}`}
      >
        {full ? value : shortAddr(value)}
      </a>
      <button type="button" onClick={copy} aria-label={`Copy ${value}`} className="shrink-0 rounded px-1 text-xs text-muted hover:text-text">
        {copied ? "copied" : "copy"}
      </button>
    </span>
  );
}

function remaining(s: number): string {
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const x = s % 60;
  return d ? `${d}d ${h}h ${m}m` : h ? `${h}h ${m}m ${x}s` : `${m}m ${x}s`;
}

/** Live countdown to a unix-seconds deadline; shows "passed" afterwards. Absolute UTC time in the tooltip. */
export function Countdown({ deadline }: { deadline: number }) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => setNow(Math.floor(Date.now() / 1000));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);
  const rem = now == null ? null : deadline - now;
  return (
    <span className="num" title={fmtTime(deadline)}>
      {rem == null ? "..." : rem <= 0 ? "passed" : `in ${remaining(rem)}`}
    </span>
  );
}
