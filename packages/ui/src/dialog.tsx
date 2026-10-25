"use client";
/* Modal dialog on the native <dialog> element: focus trapping, inert background,
   role and Escape handling come from showModal(). Controlled by `open`;
   Escape, the close button and backdrop clicks all call onClose. */
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { cx } from "./primitives";

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children?: ReactNode;
  actions?: ReactNode;
  closeLabel?: string;
  className?: string;
}

export function Dialog({ open, onClose, title, description, children, actions, closeLabel = "Close", className }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal?.();
    if (!open && el.open) el.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      className={cx("mp-dialog", className)}
      aria-labelledby={`${id}-title`}
      aria-describedby={description ? `${id}-desc` : undefined}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <header className="mp-dialog__head">
        <h2 id={`${id}-title`} className="mp-dialog__title">{title}</h2>
        <button type="button" className="mp-icon-btn mp-icon-btn--sm" aria-label={closeLabel} onClick={onClose}>
          <span aria-hidden="true">×</span>
        </button>
      </header>
      {description ? <p id={`${id}-desc`} className="mp-dialog__desc">{description}</p> : null}
      {children}
      {actions ? <footer className="mp-dialog__actions">{actions}</footer> : null}
    </dialog>
  );
}

/* Explain: button-triggered popover for "explain this number". Content is
   caller-supplied (no formatting here). Escape and outside click/touch close it;
   Escape returns focus to the trigger. aria-expanded/aria-controls, 44px target. */
export interface ExplainProps {
  /** Accessible name of the trigger, e.g. "Explain residual shortfall". */
  label: string;
  children: ReactNode;
  /** Visible trigger content; defaults to an "i" glyph. */
  trigger?: ReactNode;
  title?: string;
  className?: string;
}

export function Explain({ label, children, trigger, title, className }: ExplainProps) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const root = useRef<HTMLSpanElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    panel.current?.focus();
    const onDown = (e: PointerEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        btn.current?.focus();
      }
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  return (
    <span ref={root} className={cx("mp-explain", className)}>
      <button
        ref={btn}
        type="button"
        className="mp-explain__trigger"
        aria-label={label}
        aria-expanded={open}
        aria-controls={`${id}-panel`}
        onClick={() => setOpen((o) => !o)}
      >
        {trigger ?? <span aria-hidden="true">i</span>}
      </button>
      <div
        ref={panel}
        id={`${id}-panel`}
        role="region"
        aria-label={title ?? label}
        tabIndex={-1}
        className="mp-explain__panel"
        hidden={!open}
      >
        {title ? <p className="mp-explain__title">{title}</p> : null}
        {children}
      </div>
    </span>
  );
}
