"use client";

import { useState, type ReactNode } from "react";
import { Button, Card, Icon, IconButton } from "./primitives";

/* ---------------------------------------------------------------------------
 * BalanceCard. Source: bank app "Total balance $12,902.72" (image-like gradient
 * card, account dropdown pill, masked number, eye toggle, Receive / Send / ...).
 * Backend: the connected wallet's PLAY token balance and its Position.
 * The account slot takes whatever selector the app owns (session picker).
 * ------------------------------------------------------------------------- */
export interface BalanceCardProps {
  label: ReactNode;
  amount: string;
  meta?: string;              // e.g. a shortened wallet address
  accountSlot?: ReactNode;
  actions?: ReactNode;        // Buttons; the kit styles them white on the card
  startHidden?: boolean;
}

export function BalanceCard({ label, amount, meta, accountSlot, actions, startHidden = false }: BalanceCardProps) {
  const [hidden, setHidden] = useState(startHidden);
  return (
    <section className="mp-balance">
      <div className="mp-balance__head">
        <span>{label}</span>
        {accountSlot}
      </div>
      <div className="mp-balance__amount-row">
        <span className="mp-balance__amount mp-num" aria-live="polite">
          {hidden ? "••••••" : amount}
        </span>
        <button type="button" className="mp-balance__eye" aria-label={hidden ? "Show balance" : "Hide balance"} aria-pressed={hidden} onClick={() => setHidden((h) => !h)}>
          {hidden ? Icon.eyeOff : Icon.eye}
        </button>
      </div>
      {meta ? <div className="mp-balance__meta">{meta}</div> : null}
      {actions ? <div className="mp-balance__actions">{actions}</div> : null}
    </section>
  );
}

/* Account dropdown pill used inside BalanceCard. Source: bank app "Main account ⌄". */
export function AccountPill({ children, onClick }: { children: ReactNode; onClick?: () => void }) {
  return (
    <button type="button" className="mp-balance__select" onClick={onClick}>
      {children}
      {Icon.chevronDown}
    </button>
  );
}

/* ---------------------------------------------------------------------------
 * HeroCard. Source: AERIS "Treasury overview" (tall image card, eyebrow,
 * title, body, lime badge, white CTA pill with a dark arrow circle).
 * Backend: the planner recommendation ("Excess Inflation cover, stake 40").
 * Without an image it renders a gradient so no photo asset is required.
 * ------------------------------------------------------------------------- */
export interface HeroCardProps {
  eyebrow?: ReactNode;
  title: ReactNode;
  body?: ReactNode;
  badge?: ReactNode;
  imageSrc?: string;
  cta?: { label: string; onClick?: () => void; disabled?: boolean };
  children?: ReactNode;
}

export function HeroCard({ eyebrow, title, body, badge, imageSrc, cta, children }: HeroCardProps) {
  return (
    <article className="mp-hero-card">
      {imageSrc ? (
        <div className="mp-hero-card__media" aria-hidden="true">
          <img src={imageSrc} alt="" />
        </div>
      ) : null}
      {eyebrow ? <div className="mp-hero-card__eyebrow">{eyebrow}</div> : null}
      <div className="mp-hero-card__row">
        <h3 className="mp-hero-card__title">{title}</h3>
        {badge}
      </div>
      {body ? <p className="mp-hero-card__body">{body}</p> : null}
      {children}
      {cta ? (
        <button type="button" className="mp-hero-card__cta" onClick={cta.onClick} disabled={cta.disabled}>
          {cta.label}
          <span className="mp-hero-card__cta-icon">{Icon.arrowUpRight}</span>
        </button>
      ) : null}
    </article>
  );
}

/* ---------------------------------------------------------------------------
 * SessionCard. Source: AERIS mint "Virtual card" (brand top-right, big amount,
 * card number and expiry at the bottom, decorative rings).
 * Backend: Session address (shortened), total locked = Σ side_totals,
 * replay_deadline or deposit_deadline as the "expiry", state pill.
 * ------------------------------------------------------------------------- */
export interface SessionCardProps {
  caption: ReactNode;      // "Session #1"
  brand?: ReactNode;       // "MacroPaths"
  amount: ReactNode;       // "1,240 PLAY"
  id: string;              // shortened address
  expiry?: string;         // "12/26"
  status?: ReactNode;      // <StatusPill/>
}

export function SessionCard({ caption, brand = "MacroPaths", amount, id, expiry, status }: SessionCardProps) {
  return (
    <article className="mp-session-card">
      <div className="mp-session-card__head">
        <span>{caption}</span>
        <span className="mp-session-card__brand">{brand}</span>
      </div>
      <div>
        <div className="mp-session-card__amount mp-num">{amount}</div>
        {status}
      </div>
      <div className="mp-session-card__foot">
        <span>{id}</span>
        {expiry ? <span>{expiry}</span> : null}
      </div>
    </article>
  );
}

/* ---------------------------------------------------------------------------
 * SummaryCtaCard. Source: AERIS mint "Awaiting approval $5,430" (eyebrow, big
 * number, sub-line, line items, full-width dark CTA with an arrow).
 * Backend: Screen C claim card. amount = claim_amount for the connected
 * Position; lines = deposited per side; CTA calls `claim`.
 * ------------------------------------------------------------------------- */
export interface SummaryCtaCardProps {
  eyebrow: ReactNode;
  amount: ReactNode;
  sub?: ReactNode;
  lines?: Array<{ label: ReactNode; value: ReactNode }>;
  cta?: { label: string; onClick?: () => void; disabled?: boolean; busy?: boolean };
  note?: ReactNode;        // e.g. "Illustration until settlement"
  tone?: "calm" | "default" | "glow";
}

export function SummaryCtaCard({ eyebrow, amount, sub, lines = [], cta, note, tone = "calm" }: SummaryCtaCardProps) {
  return (
    <Card tone={tone}>
      <div className="mp-summary-cta">
        <div>
          <div className="mp-summary-cta__eyebrow">{eyebrow}</div>
          <div className="mp-hero-num mp-hero-num--light mp-num">{amount}</div>
          {sub ? <div className="mp-card__sub">{sub}</div> : null}
        </div>
        {lines.length ? (
          <div className="mp-summary-cta__lines">
            {lines.map((l, i) => (
              <div className="mp-summary-cta__line" key={i}>
                <span>{l.label}</span>
                <strong>{l.value}</strong>
              </div>
            ))}
          </div>
        ) : null}
        {cta ? (
          <Button block onClick={cta.onClick} disabled={cta.disabled || cta.busy} aria-busy={cta.busy} iconEnd={Icon.arrowUpRight}>
            {cta.busy ? "Confirm in wallet…" : cta.label}
          </Button>
        ) : null}
        {note ? <div className="mp-summary-cta__note">{note}</div> : null}
      </div>
    </Card>
  );
}

/* Corner arrow button used in AERIS card headers. */
export function CardArrow({ label, onClick }: { label: string; onClick?: () => void }) {
  return (
    <IconButton label={label} size="sm" onClick={onClick}>
      {Icon.arrowUpRight}
    </IconButton>
  );
}
