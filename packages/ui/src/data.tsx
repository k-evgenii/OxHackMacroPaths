import type { ReactNode } from "react";
import { Avatar, Card, cx, type AvatarProps } from "./primitives";
import { Sparkline } from "./charts";

/* ---------------------------------------------------------------------------
 * StatCard. Source: Capsule KPI row ("Coins 9.43M", "24H Price Change 683 +1.12%")
 * with the glowing sparkline on the right.
 * Backend: Session.peak, Session.max_decline, Session.excess_acc, latest value.
 * ------------------------------------------------------------------------- */
export interface StatCardProps {
  label: ReactNode;
  value: ReactNode;
  unit?: ReactNode;
  delta?: { text: string; direction: "up" | "down" | "flat" };
  foot?: ReactNode;
  spark?: number[];
  sparkTone?: "path" | "up" | "down";
  tone?: "default" | "glow" | "calm";
}

export function StatCard({ label, value, unit, delta, foot, spark, sparkTone = "path", tone = "default" }: StatCardProps) {
  return (
    <Card tone={tone}>
      <div className="mp-stat">
        <div className="mp-stat__label">{label}</div>
        <div className="mp-stat__value mp-num">
          {value}
          {unit ? <span className="mp-stat__unit">{unit}</span> : null}
        </div>
        {spark && spark.length > 1 ? (
          <div className="mp-stat__spark">
            <Sparkline values={spark} tone={sparkTone} />
          </div>
        ) : null}
        <div className="mp-stat__foot">
          {delta ? (
            <span className={cx(delta.direction === "up" && "mp-up", delta.direction === "down" && "mp-down")}>
              {delta.direction === "up" ? "▲ " : delta.direction === "down" ? "▼ " : ""}
              {delta.text}
            </span>
          ) : null}
          {delta && foot ? " · " : null}
          {foot}
        </div>
      </div>
    </Card>
  );
}

/* ---------------------------------------------------------------------------
 * ChangeList. Source: Capsule "BTC Price Change" (period label left, coloured
 * value right). Backend: per-product scores, caps, realised statistics.
 * Direction adds a ▲/▼ glyph so meaning is never colour alone.
 * ------------------------------------------------------------------------- */
export interface ChangeRow {
  label: ReactNode;
  value: ReactNode;
  direction?: "up" | "down";
}

export function ChangeList({ rows }: { rows: ChangeRow[] }) {
  return (
    <ul className="mp-change-list">
      {rows.map((r, i) => (
        <li key={i}>
          <span className="mp-change-list__label">{r.label}</span>
          <span className={cx("mp-change-list__value mp-num", r.direction === "up" && "mp-up", r.direction === "down" && "mp-down")}>
            {r.direction === "up" ? "▲ " : r.direction === "down" ? "▼ " : ""}
            {r.value}
          </span>
        </li>
      ))}
    </ul>
  );
}

/* ---------------------------------------------------------------------------
 * Meter. Source: AERIS Wallet "Available 77% / Spent 23%" (labelled pill bar
 * with the percentage inside the fill).
 * Backend: Session.scores[p] / 1e6 (score as a share of the cap),
 * replay progress next_index / n_obs, claimed_count / position_count.
 * ------------------------------------------------------------------------- */
export function Meter({ label, fraction, text, highlight }: { label: ReactNode; fraction: number; text?: string; highlight?: boolean }) {
  const f = Math.max(0, Math.min(1, fraction));
  return (
    <div className="mp-meter">
      <span className="mp-meter__label">{label}</span>
      <div className="mp-meter__track" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(f * 100)}>
        <div className={cx("mp-meter__fill", highlight && "mp-meter__fill--highlight")} style={{ width: `${f * 100}%` }}>
          {text ?? `${Math.round(f * 100)}%`}
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------------
 * EntityCell. Source: Capsule market rows (coin logo + "Bitcoin (BTC)") and
 * AERIS payee cells (initials avatar + name + sub-line).
 * ------------------------------------------------------------------------- */
export function EntityCell({ name, sub, avatar }: { name: ReactNode; sub?: ReactNode; avatar?: AvatarProps }) {
  return (
    <div className="mp-entity">
      {avatar ? <Avatar {...avatar} /> : null}
      <div>
        <div className="mp-entity__name">{name}</div>
        {sub ? <div className="mp-entity__sub">{sub}</div> : null}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------------
 * DataTable. Source: Capsule "Market" table (avatar column, numeric columns,
 * coloured change, inline sparkline) and AERIS "Approval queue" (uppercase
 * headers, status pills, highlighted selected row).
 * Backend: session list, positions per wallet, the planner's 21 policies with
 * the recommended row selected.
 * ------------------------------------------------------------------------- */
export interface Column<Row> {
  key: string;
  header: ReactNode;
  render: (row: Row) => ReactNode;
  numeric?: boolean;
}

export interface DataTableProps<Row> {
  columns: Column<Row>[];
  rows: Row[];
  rowKey: (row: Row) => string;
  selectedKey?: string;
  onRowClick?: (row: Row) => void;
  caption?: string;
  empty?: ReactNode;
}

export function DataTable<Row>({ columns, rows, rowKey, selectedKey, onRowClick, caption, empty = "Nothing here yet." }: DataTableProps<Row>) {
  return (
    <div className="mp-table-wrap">
      <table className="mp-table">
        {caption ? <caption className="mp-sr-only">{caption}</caption> : null}
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} scope="col" className={c.numeric ? "mp-table__num" : undefined}>
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="mp-muted">
                {empty}
              </td>
            </tr>
          ) : (
            rows.map((row) => {
              const k = rowKey(row);
              return (
                <tr
                  key={k}
                  className={cx(onRowClick && "mp-table__row--clickable", k === selectedKey && "mp-table__row--selected")}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  aria-selected={selectedKey !== undefined ? k === selectedKey : undefined}
                >
                  {columns.map((c) => (
                    <td key={c.key} className={c.numeric ? "mp-table__num" : undefined}>
                      {c.render(row)}
                    </td>
                  ))}
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}

/* ---------------------------------------------------------------------------
 * ActivityFeed. Source: bank app "Transaction history" (date group headers,
 * rounded rows with logo, title, timestamp and a signed amount on the right).
 * Backend: Deposit / Observed / Settled / Claimed / CoverBought events and
 * transaction signatures; href points at the Solana explorer.
 * ------------------------------------------------------------------------- */
export interface FeedItem {
  id: string;
  title: ReactNode;
  meta?: ReactNode;
  amount?: { text: string; direction?: "in" | "out" };
  avatar?: AvatarProps;
  href?: string;
}

export function ActivityFeed({ groups }: { groups: Array<{ title: string; items: FeedItem[] }> }) {
  return (
    <div className="mp-feed">
      {groups.map((g) => (
        <section key={g.title}>
          <h4 className="mp-feed__group-title">{g.title}</h4>
          <div className="mp-feed">
            {g.items.map((it) => {
              const inner = (
                <>
                  {it.avatar ? <Avatar {...it.avatar} /> : null}
                  <div className="mp-feed__body">
                    <div className="mp-feed__title">{it.title}</div>
                    {it.meta ? <div className="mp-feed__meta">{it.meta}</div> : null}
                  </div>
                  {it.amount ? (
                    <span className={cx("mp-feed__amount", it.amount.direction === "in" && "mp-up")}>{it.amount.text}</span>
                  ) : null}
                </>
              );
              return it.href ? (
                <a key={it.id} className="mp-feed__item" href={it.href} target="_blank" rel="noreferrer">
                  {inner}
                </a>
              ) : (
                <div key={it.id} className="mp-feed__item">
                  {inner}
                </div>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
