// Minimal stand-ins for fe-03's shared UI (web/src/components/ui). The integrator repoints imports at merge.
import type { ReactNode } from "react";

export function Card({ title, children, className = "" }: { title?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-lg border border-white/10 bg-white/[0.03] p-4 ${className}`}>
      {title ? <h2 className="mb-3 text-sm font-semibold tracking-wide text-white/80">{title}</h2> : null}
      {children}
    </section>
  );
}

export function Stat({ label, value, hint }: { label: ReactNode; value: ReactNode; hint?: ReactNode }) {
  return (
    <div>
      <div className="text-xs text-white/50">{label}</div>
      <div className="text-lg tabular-nums">{value}</div>
      {hint ? <div className="text-xs text-white/40">{hint}</div> : null}
    </div>
  );
}

const TONES = {
  good: "border-emerald-400/40 text-emerald-300",
  warn: "border-amber-400/40 text-amber-300",
  muted: "border-white/20 text-white/60",
} as const;
export function Badge({ tone = "muted", children }: { tone?: keyof typeof TONES; children: ReactNode }) {
  return <span className={`inline-block rounded border px-1.5 py-0.5 text-[11px] ${TONES[tone]}`}>{children}</span>;
}

export function Num({ value, digits = 2, suffix = "" }: { value: number; digits?: number; suffix?: string }) {
  return (
    <span className="tabular-nums">
      {value.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits })}
      {suffix}
    </span>
  );
}

export function Skeleton({ className = "h-24" }: { className?: string }) {
  return <div className={`animate-pulse rounded-lg bg-white/5 ${className}`} />;
}

export function ErrorState({ error }: { error: unknown }) {
  return (
    <div role="alert" className="rounded-lg border border-red-400/40 p-4 text-sm text-red-300">
      Could not load research artifact: {error instanceof Error ? error.message : String(error)}
    </div>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <div className="rounded-lg border border-white/10 p-4 text-sm text-white/50">{children}</div>;
}
