import type { ComponentType, ReactNode } from "react";
import { cx, Icon, IconButton } from "./primitives";

/* A link component the app can inject (for example next/link) so navigation stays client-side. */
export type LinkLike = ComponentType<{ href: string; className?: string; children?: ReactNode; "aria-current"?: "page" }>;
const PlainLink: LinkLike = ({ href, className, children, ...rest }) => (
  <a href={href} className={className} {...rest}>
    {children}
  </a>
);

export interface NavEntry {
  id: string;
  label: string;
  icon?: ReactNode;
  href?: string;
  onSelect?: () => void;
}

/* Sidebar with active pill. Source: Capsule left column (logo, icon+label items,
   glowing active item, promo card pinned at the bottom). */
export interface SidebarProps {
  brand: ReactNode;
  items: NavEntry[];
  activeId: string;
  footer?: ReactNode;
  linkComponent?: LinkLike;
}

export function Sidebar({ brand, items, activeId, footer, linkComponent: L = PlainLink }: SidebarProps) {
  return (
    <aside className="mp-sidebar">
      <div className="mp-sidebar__brand">{brand}</div>
      <nav aria-label="Main">
        <ul className="mp-nav">
          {items.map((item) => {
            const active = item.id === activeId;
            const cls = cx("mp-nav__item", active && "mp-nav__item--active");
            const inner = (
              <>
                {item.icon ? <span className="mp-nav__icon">{item.icon}</span> : null}
                {item.label}
              </>
            );
            return (
              <li key={item.id}>
                {item.href ? (
                  <L href={item.href} className={cls} aria-current={active ? "page" : undefined}>
                    {inner}
                  </L>
                ) : (
                  <button type="button" className={cls} aria-current={active ? "page" : undefined} onClick={item.onSelect}>
                    {inner}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      </nav>
      {footer ? <div className="mp-sidebar__footer">{footer}</div> : null}
    </aside>
  );
}

/* Small promo / notice card for the sidebar footer. Source: Capsule "Activate Super".
   Suggested use: "Devnet · test tokens only". */
export function PromoCard({ icon, title, subtitle }: { icon?: ReactNode; title: ReactNode; subtitle?: ReactNode }) {
  return (
    <div className="mp-promo">
      {icon}
      <div>
        <div className="mp-promo__title">{title}</div>
        {subtitle ? <div className="mp-promo__sub">{subtitle}</div> : null}
      </div>
    </div>
  );
}

/* Vertical icon rail. Source: AERIS left column (round icons, active one filled, support at the bottom). */
export function IconRail({ items, activeId, footer }: { items: Array<NavEntry & { icon: ReactNode }>; activeId: string; footer?: ReactNode }) {
  return (
    <nav className="mp-rail" aria-label="Sections">
      {items.map((item) => (
        <IconButton key={item.id} label={item.label} active={item.id === activeId} onClick={item.onSelect}>
          {item.icon}
        </IconButton>
      ))}
      {footer ? <div className="mp-rail__footer">{footer}</div> : null}
    </nav>
  );
}

/* Search field. Source: Capsule top bar and the Market table header. */
export function SearchField({ placeholder = "Search…", value, onChange, label = "Search" }: { placeholder?: string; value?: string; onChange?: (v: string) => void; label?: string }) {
  return (
    <label className="mp-search">
      {Icon.search}
      <span className="mp-sr-only">{label}</span>
      <input type="search" placeholder={placeholder} value={value} onChange={onChange ? (e) => onChange(e.target.value) : undefined} />
    </label>
  );
}

/* Top bar. Source: Capsule (search, theme toggle, Connect Wallet) and AERIS
   (brand, pill tabs, avatar stack, bell with dot, user avatar). Slots only:
   the app passes its wallet button, network badge and tabs. */
export function TopBar({ brand, center, end }: { brand?: ReactNode; center?: ReactNode; end?: ReactNode }) {
  return (
    <header className="mp-topbar">
      {brand ? <div className="mp-topbar__brand">{brand}</div> : null}
      <div className="mp-topbar__center">{center}</div>
      <div className="mp-topbar__end">{end}</div>
    </header>
  );
}

/* Pill tabs. Source: AERIS "Dashboard / Payments / Cards / Reports". */
export interface TabEntry {
  id: string;
  label: string;
  icon?: ReactNode;
}

export function PillTabs({ tabs, activeId, onChange, label = "Sections" }: { tabs: TabEntry[]; activeId: string; onChange: (id: string) => void; label?: string }) {
  return (
    <div className="mp-tabs" role="tablist" aria-label={label}>
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          role="tab"
          aria-selected={t.id === activeId}
          className={cx("mp-tab", t.id === activeId && "mp-tab--active")}
          onClick={() => onChange(t.id)}
        >
          {t.icon}
          {t.label}
        </button>
      ))}
    </div>
  );
}

/* Page header with breadcrumb, large light title and a toolbar.
   Source: AERIS "Workspace · Northstar Studio · Dashboard" + "Client Dashboard" + right-hand actions. */
export function PageHeader({ crumbs = [], title, actions }: { crumbs?: string[]; title: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mp-page-head">
      <div>
        {crumbs.length ? (
          <ol className="mp-crumbs" aria-label="Breadcrumb">
            {crumbs.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ol>
        ) : null}
        <h1 className="mp-page-title">{title}</h1>
      </div>
      {actions ? <div className="mp-page-actions">{actions}</div> : null}
    </div>
  );
}

/* Segmented control. Source: bank app "W M 3M 6M Y All".
   Suggested use: path range "2021 2022 2023 2024 All". */
export function SegmentedControl<T extends string>({ options, value, onChange, label }: { options: Array<{ value: T; label: string }>; value: T; onChange: (v: T) => void; label: string }) {
  return (
    <div className="mp-seg" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          className={cx("mp-seg__opt", o.value === value && "mp-seg__opt--active")}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/* Filter chips with counts. Source: AERIS "All 04 · Pending 02 · Approved 01 · Paid 01". */
export function FilterChips<T extends string>({ chips, value, onChange, label = "Filter" }: { chips: Array<{ value: T; label: string; count?: number }>; value: T; onChange: (v: T) => void; label?: string }) {
  return (
    <div className="mp-chips" role="radiogroup" aria-label={label}>
      {chips.map((c) => (
        <button
          key={c.value}
          type="button"
          role="radio"
          aria-checked={c.value === value}
          className={cx("mp-chip", c.value === value && "mp-chip--active")}
          onClick={() => onChange(c.value)}
        >
          {c.label}
          {c.count !== undefined ? <span className="mp-chip__count">{String(c.count).padStart(2, "0")}</span> : null}
        </button>
      ))}
    </div>
  );
}
