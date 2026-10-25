import { ApiRequestError } from "@/lib/api-client";

/** Rounded surface container with an optional title row and action slot. */
export function Card({
  title,
  action,
  className = "",
  children,
}: {
  title?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section className={`min-w-0 rounded-card border border-border bg-surface p-4 sm:p-5 ${className}`}>
      {(title || action) && (
        <header className="mb-3 flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-muted">{title}</h2>
          {action}
        </header>
      )}
      {children}
    </section>
  );
}

/** Labelled value tile: small label, large value, optional sub line. */
export function Stat({ label, value, sub }: { label: React.ReactNode; value: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className="min-w-0 rounded-card border border-border bg-surface p-4">
      <div className="text-xs text-muted">{label}</div>
      <div className="num mt-1 truncate text-xl font-semibold">{value}</div>
      {sub != null && <div className="mt-1 truncate text-xs text-muted">{sub}</div>}
    </div>
  );
}

export type BadgeVariant = "Open" | "Running" | "Settled" | "Refunding" | "ok" | "bad" | "neutral" | "accent";

const badgeStyles: Record<BadgeVariant, string> = {
  Open: "text-info border-info/40 bg-info/10",
  Running: "text-primary border-primary/40 bg-primary/10",
  Settled: "text-up border-up/40 bg-up/10",
  Refunding: "text-warn border-warn/40 bg-warn/10",
  ok: "text-up border-up/40 bg-up/10",
  bad: "text-down border-down/40 bg-down/10",
  neutral: "text-muted border-border bg-surface-2",
  accent: "text-primary border-primary/40 bg-primary/10",
};

/** Small pill. Pass a session state as the variant (label defaults to it), or ok/bad/neutral/accent. */
export function Badge({ variant = "neutral", children }: { variant?: BadgeVariant; children?: React.ReactNode }) {
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${badgeStyles[variant]}`}>
      {children ?? variant}
    </span>
  );
}

/** Formatted value; the title tooltip shows the raw integer (and its unit) it came from. */
export function Num({
  raw,
  unit,
  className = "",
  children,
}: {
  raw: string | number | bigint;
  unit?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <span className={`num ${className}`} title={`raw: ${String(raw)}${unit ? ` (${unit})` : ""}`}>
      {children}
    </span>
  );
}

export type Column<T> = {
  key: string;
  header: React.ReactNode;
  cell: (row: T) => React.ReactNode;
  align?: "left" | "right";
};

/** Simple table with typed columns; scrolls horizontally inside its card on narrow screens. */
export function Table<T>({
  columns,
  rows,
  rowKey,
  empty = "No rows",
}: {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T, i: number) => string;
  empty?: React.ReactNode;
}) {
  if (rows.length === 0) return <div className="py-6 text-center text-sm text-muted">{empty}</div>;
  const align = (c: Column<T>) => (c.align === "right" ? "num text-right" : "text-left");
  return (
    <div className="max-w-full overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-xs text-muted">
            {columns.map((c) => (
              <th key={c.key} className={`whitespace-nowrap px-2 py-2 font-medium ${align(c)}`}>
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={rowKey(r, i)} className="border-b border-border/50 last:border-0">
              {columns.map((c) => (
                <td key={c.key} className={`whitespace-nowrap px-2 py-2 ${align(c)}`}>
                  {c.cell(r)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Neutral placeholder for an empty list or missing data. */
export function EmptyState({ title, children }: { title: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="rounded-card border border-dashed border-border p-6 text-center">
      <div className="font-medium">{title}</div>
      {children && <div className="mt-1 text-sm text-muted">{children}</div>}
    </div>
  );
}

/** Error box with the ApiRequestError message, HTTP status and code (or any Error message). */
export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const msg = error instanceof Error ? error.message : String(error);
  const code = error instanceof ApiRequestError ? `${error.status} ${error.code}` : null;
  return (
    <div role="alert" className="rounded-card border border-down/40 bg-down/10 p-4 text-sm">
      <div className="font-medium text-down">Could not load data</div>
      <div className="mt-1 break-words">{msg}</div>
      {code && <div className="mt-1 font-mono text-xs text-muted">{code}</div>}
      {onRetry && (
        <button type="button" onClick={onRetry} className="mt-2 rounded-full border border-border px-3 py-1 text-xs hover:bg-surface-2">
          Retry
        </button>
      )}
    </div>
  );
}

/** Pulsing placeholder block; size it with className. */
export function Skeleton({ className = "h-5 w-full" }: { className?: string }) {
  return <div aria-hidden className={`animate-pulse rounded-md bg-surface-2 ${className}`} />;
}
