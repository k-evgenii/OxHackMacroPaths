"use client";
import type { ReactNode } from "react";
export const fmt = (n: number, dp = 2) =>
  n
    .toLocaleString("en-GB", {
      minimumFractionDigits: dp,
      maximumFractionDigits: dp,
    })
    .replace(/^-/, "−");
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
      className={`min-w-0 rounded-3xl border border-line bg-panel p-5 shadow-[0_1px_2px_rgba(0,0,0,0.03)] sm:p-6 ${order !== undefined ? "reveal" : ""} ${className}`}
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
      className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${tone === "up" ? "bg-up/10 text-up" : tone === "accent" ? "bg-accent/10 text-brand" : "border border-line bg-panel-2 text-muted"}`}
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
      className={`min-h-12 w-full rounded-full px-5 py-3 text-sm font-semibold transition active:scale-[.98] disabled:cursor-not-allowed disabled:opacity-40 ${variant === "primary" ? "bg-accent text-white hover:brightness-105" : variant === "dark" ? "bg-night text-white" : "border border-line bg-panel-2 text-text"} ${className}`}
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
    <nav aria-label="Walkthrough progress">
      <ol className="grid grid-cols-3 gap-1.5 rounded-full border border-line bg-panel p-1.5">
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
              className={`flex w-full items-center justify-center gap-2 rounded-full px-2 py-3 text-sm transition disabled:opacity-40 ${current === s.key ? "bg-night text-white" : "hover:bg-panel-2"}`}
            >
              <span
                className={`grid h-5 w-5 shrink-0 place-items-center rounded-full text-xs ${current === s.key ? "bg-accent text-white" : "bg-panel-2 text-muted"}`}
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
