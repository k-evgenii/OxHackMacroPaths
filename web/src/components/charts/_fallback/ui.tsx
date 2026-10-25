// Minimal stand-ins for fe-03's web/src/components/ui. Repoint imports at merge.
import type { ReactNode } from "react";

export function Card({ title, children, className = "" }: { title?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`min-w-0 rounded-lg border border-white/10 bg-white/[0.03] p-4 ${className}`}>
      {title ? <h2 className="mb-3 text-sm font-semibold text-white/80">{title}</h2> : null}
      {children}
    </section>
  );
}
export function Stat({ label, value, hint }: { label: ReactNode; value: ReactNode; hint?: ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="text-xs text-white/60">{label}</div>
      <div className="truncate text-lg font-semibold tabular-nums">{value}</div>
      {hint ? <div className="text-xs text-white/50">{hint}</div> : null}
    </div>
  );
}
export function Badge({ children }: { children: ReactNode }) {
  return <span className="rounded border border-white/20 px-1.5 py-0.5 text-xs text-white/80">{children}</span>;
}
export function EmptyState({ title, children }: { title: ReactNode; children?: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-white/15 p-6 text-center text-sm text-white/70">
      <div className="font-medium">{title}</div>
      {children}
    </div>
  );
}
export function ErrorState({ error }: { error: unknown }) {
  return <div role="alert" className="rounded-lg border border-red-400/40 p-4 text-sm text-red-300">{error instanceof Error ? error.message : String(error)}</div>;
}
export function Skeleton({ className = "h-40" }: { className?: string }) {
  return <div className={`animate-pulse rounded-lg bg-white/5 ${className}`} />;
}
