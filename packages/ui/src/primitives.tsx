import type { ButtonHTMLAttributes, ReactNode } from "react";

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

/* Button. Source: AERIS "Create report" (primary), "Add widget" (secondary),
   Capsule "Connect Wallet" (outline-accent), bank app "Receive"/"Send". */
export type ButtonVariant = "primary" | "secondary" | "ghost" | "outline-accent";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: "md" | "lg";
  block?: boolean;
  icon?: ReactNode;
  iconEnd?: ReactNode;
}

export function Button({ variant = "primary", size = "md", block, icon, iconEnd, className, children, type = "button", ...rest }: ButtonProps) {
  return (
    <button
      type={type}
      className={cx("mp-btn", `mp-btn--${variant}`, size === "lg" && "mp-btn--lg", block && "mp-btn--block", className)}
      {...rest}
    >
      {icon}
      {children}
      {iconEnd}
    </button>
  );
}

/* Round icon button. Source: AERIS bell / mail / corner arrow, bank app "...". */
export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  size?: "sm" | "md";
  active?: boolean;
  dot?: boolean;
  children: ReactNode;
}

export function IconButton({ label, size = "md", active, dot, className, children, type = "button", ...rest }: IconButtonProps) {
  return (
    <button
      type={type}
      aria-label={label}
      title={label}
      className={cx("mp-icon-btn", size === "sm" && "mp-icon-btn--sm", active && "mp-icon-btn--active", className)}
      {...rest}
    >
      {children}
      {dot ? <span className="mp-icon-btn__dot" aria-hidden="true" /> : null}
    </button>
  );
}

/* Count badge. Source: AERIS lime "2 pending". */
export function Badge({ tone = "highlight", children }: { tone?: "highlight" | "neutral" | "calm"; children: ReactNode }) {
  return <span className={cx("mp-badge", tone !== "highlight" && `mp-badge--${tone}`)}>{children}</span>;
}

/* Status pill. Source: AERIS "Pending approval" / "Approved" / "Paid".
   The tones map to SessionState from the IDL plus a per-position "claimed" and
   "unavailable" (state could not be read; never implies an enabled action).
   Status is always spoken as text; the dot is decorative. */
export type StatusTone = "open" | "running" | "settled" | "refunding" | "claimed" | "unavailable";

export const statusLabels: Record<StatusTone, string> = {
  open: "Open for deposits",
  running: "Replaying",
  settled: "Settled",
  refunding: "Refunding",
  claimed: "Claimed",
  unavailable: "Status unavailable",
};

export function StatusPill({ tone, children }: { tone: StatusTone; children?: ReactNode }) {
  return (
    <span className={cx("mp-pill", `mp-pill--${tone}`)} data-status={tone}>
      <span className="mp-pill__dot" aria-hidden="true" />
      {children ?? statusLabels[tone]}
    </span>
  );
}

/* ---------- Data states. Display-only: callers map errors to safe text. ---------- */

export interface SkeletonProps {
  className?: string;
  label?: string;
}

/** One placeholder block. Announced once via its label; give it geometry with className. */
export function Skeleton({ className, label = "Loading" }: SkeletonProps) {
  return <span className={cx("mp-skeleton", className)} role="status" aria-label={label} aria-busy="true" />;
}

export interface EmptyStateProps {
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}

/** Data loaded and there is genuinely nothing. Not for unavailable data. */
export function EmptyState({ title, description, action, className }: EmptyStateProps) {
  return (
    <div className={cx("mp-state", "mp-state--empty", className)}>
      <p className="mp-state__title">{title}</p>
      {description ? <p className="mp-state__desc">{description}</p> : null}
      {action ? <div className="mp-state__actions">{action}</div> : null}
    </div>
  );
}

function RetryButton({ onRetry, retrying }: { onRetry: () => void; retrying?: boolean }) {
  return (
    <Button
      variant="secondary"
      className="mp-state__retry"
      onClick={retrying ? undefined : onRetry}
      aria-disabled={retrying ? true : undefined}
      aria-busy={retrying ? true : undefined}
    >
      {retrying ? "Retrying…" : "Retry"}
    </Button>
  );
}

export interface ErrorStateProps {
  title?: string;
  description: string;
  onRetry?: () => void;
  retrying?: boolean;
  className?: string;
}

/** Data could not be loaded. Shows only the caller-supplied safe description. */
export function ErrorState({ title = "Unable to load", description, onRetry, retrying, className }: ErrorStateProps) {
  return (
    <div className={cx("mp-state", "mp-state--error", className)} role="alert">
      <p className="mp-state__title">{title}</p>
      <p className="mp-state__desc">{description}</p>
      {onRetry ? (
        <div className="mp-state__actions">
          <RetryButton onRetry={onRetry} retrying={retrying} />
        </div>
      ) : null}
    </div>
  );
}

export interface PartialDataNoticeProps {
  description: string;
  onRetry?: () => void;
  retrying?: boolean;
  className?: string;
}

/** Some data is shown but the set is incomplete. Rendered beside, not instead of, the data. */
export function PartialDataNotice({ description, onRetry, retrying, className }: PartialDataNoticeProps) {
  return (
    <div className={cx("mp-partial", className)} role="status">
      <p className="mp-partial__text">
        <strong>Partial data. </strong>
        {description}
      </p>
      {onRetry ? <RetryButton onRetry={onRetry} retrying={retrying} /> : null}
    </div>
  );
}

/* Avatar with initials or image. Source: AERIS payee initials, bank app merchant logos. */
export interface AvatarProps {
  name: string;
  src?: string;
  color?: string;
  square?: boolean;
}

export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

export function Avatar({ name, src, color, square }: AvatarProps) {
  return (
    <span className={cx("mp-avatar", square && "mp-avatar--square")} style={color ? { background: color } : undefined} title={name}>
      {src ? <img src={src} alt="" /> : initials(name)}
    </span>
  );
}

/* Avatar stack with overflow count. Source: AERIS header "AL MC RH +4". */
export function AvatarStack({ people, max = 3 }: { people: AvatarProps[]; max?: number }) {
  const shown = people.slice(0, max);
  const extra = people.length - shown.length;
  return (
    <span className="mp-avatar-stack" aria-label={`${people.length} participants`}>
      {shown.map((p) => (
        <Avatar key={p.name} {...p} />
      ))}
      {extra > 0 ? <span className="mp-avatar mp-avatar-stack__more">+{extra}</span> : null}
    </span>
  );
}

/* Card. Source: every AERIS bento tile; Capsule panels use tone="glow".
   `action` is the corner slot (the AERIS ↗ button). */
export interface CardProps {
  title?: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
  tone?: "default" | "calm" | "inverse" | "glow";
  className?: string;
  children?: ReactNode;
  as?: "section" | "article" | "div";
}

export function Card({ title, subtitle, action, tone = "default", className, children, as: Tag = "section" }: CardProps) {
  return (
    <Tag className={cx("mp-card", tone !== "default" && `mp-card--${tone}`, className)}>
      {title || action ? (
        <header className="mp-card__head">
          <div>
            {title ? <h3 className="mp-card__title">{title}</h3> : null}
            {subtitle ? <p className="mp-card__sub">{subtitle}</p> : null}
          </div>
          {action}
        </header>
      ) : null}
      {children}
    </Tag>
  );
}

/* Bento grid. Source: AERIS dashboard layout. Children use the span helpers. */
export function Bento({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx("mp-bento", className)}>{children}</div>;
}

export const bento = {
  span2: "mp-bento__span-2",
  full: "mp-bento__span-4",
  tall: "mp-bento__tall",
} as const;

/* Minimal inline icons so the kit has no icon dependency. Swap for lucide-react if the app uses it. */
export const Icon = {
  arrowUpRight: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M7 17 17 7M8 7h9v9" />
    </svg>
  ),
  search: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  ),
  eye: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  ),
  eyeOff: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 3l18 18M10.6 5.1A10.6 10.6 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3.2 4.2M6.6 6.6C3.8 8.3 2 12 2 12s3.5 7 10 7a9.7 9.7 0 0 0 5.4-1.6M9.9 9.9a3 3 0 0 0 4.2 4.2" />
    </svg>
  ),
  more: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <circle cx="5" cy="12" r="2" />
      <circle cx="12" cy="12" r="2" />
      <circle cx="19" cy="12" r="2" />
    </svg>
  ),
  bell: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.9 1.9 0 0 0 3.4 0" />
    </svg>
  ),
  sun: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </svg>
  ),
  chevronDown: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m6 9 6 6 6-6" />
    </svg>
  ),
  wallet: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20 7H5a2 2 0 0 1 0-4h13v4M3 5v14a2 2 0 0 0 2 2h15V7" />
      <circle cx="16" cy="14" r="1" />
    </svg>
  ),
};
