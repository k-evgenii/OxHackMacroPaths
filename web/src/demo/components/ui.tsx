"use client";
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
export const fmt = (n: number, dp = 2) =>
  n
    .toLocaleString("en-GB", {
      minimumFractionDigits: dp,
      maximumFractionDigits: dp,
    })
    .replace(/^-/, "−");
/** Animate changes only; the first render and assistive text show the exact value. */
export function AnimatedNumber({
  value,
  decimals = 2,
  className = "",
}: {
  value: number;
  decimals?: number;
  className?: string;
}) {
  const [shown, setShown] = useState(value);
  const previous = useRef(value);
  useEffect(() => {
    const from = previous.current;
    if (
      window.matchMedia("(prefers-reduced-motion: reduce)").matches ||
      from === value
    ) {
      previous.current = value;
      setShown(value);
      return;
    }
    let frame = 0;
    const start = performance.now();
    const tick = (time: number) => {
      const progress = Math.min(1, (time - start) / 480);
      previous.current = from + (value - from) * (1 - (1 - progress) ** 3);
      setShown(previous.current);
      if (progress < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value]);
  return (
    <span className={className}>
      <span aria-hidden="true">{fmt(shown, decimals)}</span>
      <span className="sr-only">{fmt(value, decimals)}</span>
    </span>
  );
}
export function Card({
  children,
  className = "",
  order,
}: {
  children: ReactNode;
  className?: string;
  order?: number;
}) {
  return (
    <section
      className={`mp-card min-w-0 p-5 sm:p-6 ${order !== undefined ? "reveal" : ""} ${className}`}
      style={
        {
          "--mp-enter-delay": `${Math.min(order ?? 0, 6) * 45}ms`,
        } as CSSProperties
      }
    >
      {children}
    </section>
  );
}
export function Tag({
  children,
  tone = "muted",
}: {
  children: ReactNode;
  tone?: "muted" | "accent" | "forecast" | "up";
}) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold tracking-[.01em] ${tone === "up" ? "bg-up/10 text-up" : tone === "accent" ? "bg-accent/10 text-brand" : tone === "forecast" ? "bg-forecast/10 text-forecast" : "border border-line bg-panel-2 text-muted"}`}
    >
      {children}
    </span>
  );
}
export function Button({
  children,
  onClick,
  disabled,
  variant = "primary",
  className = "",
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  variant?: "primary" | "secondary" | "dark";
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`mp-button w-full px-5 py-3 text-sm disabled:cursor-not-allowed disabled:opacity-40 ${variant === "primary" ? "mp-button-primary" : variant === "dark" ? "bg-night text-white hover:bg-night/90" : "border border-line bg-panel text-text hover:bg-panel-2"} ${className}`}
    >
      {children}
    </button>
  );
}
export function InfoTip({
  text,
  label = "More info",
}: {
  text: string;
  label?: string;
}) {
  return (
    <span className="group relative inline-flex align-middle">
      <button
        type="button"
        aria-label={`${label}: ${text}`}
        className="ml-1 grid h-5 w-5 place-items-center rounded-full border border-line text-[10px] text-muted"
      >
        i
      </button>
      <span
        role="tooltip"
        className="pointer-events-none absolute bottom-full right-0 z-30 mb-2 w-52 rounded-xl bg-night px-3 py-2 text-xs font-normal leading-snug text-white opacity-0 shadow-lg transition group-hover:opacity-100 group-focus-within:opacity-100"
      >
        {text}
      </span>
    </span>
  );
}
export function WhatHappens({ children }: { children: ReactNode }) {
  return <p className="mt-2 text-xs leading-relaxed text-muted">{children}</p>;
}
export type StepKey = "choose" | "watch" | "claim";
export function StepBar({
  current,
  done,
  enabled,
  onGo,
}: {
  current: StepKey;
  done: Record<StepKey, boolean>;
  enabled: Record<StepKey, boolean>;
  onGo: (s: StepKey) => void;
}) {
  return (
    <nav aria-label="Position progress">
      <ol className="grid grid-cols-3 gap-1.5 rounded-2xl border border-line bg-panel p-1.5">
        {(
          [
            { key: "choose", label: "Choose" },
            { key: "watch", label: "Replay" },
            { key: "claim", label: "Result" },
          ] as const
        ).map((s, i) => (
          <li key={s.key}>
            <button
              type="button"
              onClick={() => onGo(s.key)}
              disabled={!enabled[s.key]}
              aria-current={current === s.key ? "step" : undefined}
              className={`flex w-full items-center justify-center gap-2 rounded-xl px-2 py-3 text-sm font-medium transition disabled:opacity-40 ${current === s.key ? "bg-night text-white" : "text-muted hover:bg-panel-2 hover:text-text"}`}
            >
              <span
                className={`grid h-5 w-5 shrink-0 place-items-center rounded-full text-xs font-semibold ${current === s.key ? "bg-accent text-accent-ink" : done[s.key] ? "bg-up/10 text-up" : "bg-panel-2 text-muted"}`}
              >
                {done[s.key] ? "✓" : i + 1}
              </span>
              {s.label}
            </button>
          </li>
        ))}
      </ol>
    </nav>
  );
}
