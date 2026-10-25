"use client";
// Application shell: four destinations (Home, Session, Activity, Products). Desktop: compact rail and a
// light top bar with the wallet control. Mobile: bottom navigation with safe-area spacing; main content
// is padded so nothing (including focus targets) hides beneath it. No slot counters or protocol addresses
// in navigation; client data is read only through the application API.
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef } from "react";
import { WalletControl } from "@/features/wallet-connect/WalletControl";
import { EnsureWalletConnection } from "@/features/wallet-connect/WalletConnectionProvider";
import { useCatalog } from "@/lib/hooks";
import {
  DESTINATIONS,
  activeDestination,
  defaultSelectionHref,
  destinationHref,
  type Destination,
} from "./selection";
import { useSelectionState } from "./useSelectedSession";

const focusRing = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary";

function Icon({ dest }: { dest: Destination }) {
  const d: Record<Destination, string> = {
    home: "M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z",
    session: "M3 17l5-6 4 3 6-8 3 3",
    activity: "M4 6h16M4 12h16M4 18h10",
    products: "M4 5h7v7H4zM13 5h7v7h-7zM4 14h7v5H4zM13 14h7v5h-7z",
  };
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5 shrink-0" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <path d={d[dest]} />
    </svg>
  );
}

type NavProps = { pathname: string; address: string | null; defaultSession: string | null };

function NavItems({ pathname, address, defaultSession, variant }: NavProps & { variant: "rail" | "bar" }) {
  const active = activeDestination(pathname);
  return (
    <ul className={variant === "rail" ? "flex flex-col gap-1" : "grid grid-cols-4"}>
      {DESTINATIONS.map(({ key, label }) => {
        const isActive = active === key;
        return (
          <li key={key}>
            <Link
              href={destinationHref(key, address, defaultSession)}
              aria-current={isActive ? "page" : undefined}
              className={`${focusRing} ${
                variant === "rail"
                  ? "flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm"
                  : "flex min-h-14 flex-col items-center justify-center gap-0.5 text-xs"
              } ${isActive ? "bg-primary/10 font-semibold text-primary" : "text-muted hover:bg-surface-2 hover:text-text"}`}
            >
              <Icon dest={key} />
              <span>{label}</span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

function SessionPicker() {
  const sel = useSelectionState();
  const catalog = useCatalog();
  const id = "mp-session-picker";
  if (sel.status === "unavailable")
    return (
      <span className="text-xs text-muted" role="status">
        Sessions unavailable
      </span>
    );
  const sessions = catalog.data?.sessions ?? [];
  return (
    <div className="flex min-w-0 items-center gap-2">
      <label htmlFor={id} className="hidden text-xs text-muted sm:inline">
        Session
      </label>
      <select
        id={id}
        aria-label="Session"
        disabled={sel.status === "loading"}
        value={sel.address ?? ""}
        onChange={(e) => e.target.value && sel.select(e.target.value)}
        className={`${focusRing} min-h-11 min-w-0 max-w-40 truncate rounded-xl border border-border bg-surface px-3 text-sm text-text sm:max-w-64`}
      >
        {sel.status === "loading" && <option value="">Loading sessions…</option>}
        {sel.status === "invalid" && <option value="">Choose a session</option>}
        {sessions.map((s) => (
          <option key={s.address} value={s.address}>
            {s.presentation.label}
          </option>
        ))}
      </select>
    </div>
  );
}

function SelectionNotice() {
  const sel = useSelectionState();
  const pathname = usePathname() ?? "/";
  const params = useSearchParams();
  if (sel.status !== "invalid" || !sel.defaultSession) return null;
  const search = params?.toString() ?? "";
  return (
    <div role="alert" className="mx-auto mt-4 flex w-full max-w-[1280px] flex-wrap items-center gap-3 px-4 sm:px-6">
      <p className="text-sm text-down">This session is not available in this app. It may be mistyped or unregistered.</p>
      <Link href={defaultSelectionHref(pathname, search, sel.defaultSession)} className={`${focusRing} text-sm font-medium text-primary underline`}>
        Return to the default session
      </Link>
    </div>
  );
}

function ShellNav({ pathname }: { pathname: string }) {
  const sel = useSelectionState();
  const props = { pathname, address: sel.address, defaultSession: sel.defaultSession };
  return (
    <>
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-56 flex-col border-r border-border bg-surface px-3 py-4 lg:flex">
        <Link href={destinationHref("home", sel.address, sel.defaultSession)} className={`${focusRing} mb-6 rounded-xl px-3 py-2 text-lg font-semibold`}>
          Macro<span className="text-primary">Paths</span>
        </Link>
        <nav aria-label="Main">
          <NavItems {...props} variant="rail" />
        </nav>
      </aside>
      <nav
        aria-label="Main"
        className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden"
      >
        <NavItems {...props} variant="bar" />
      </nav>
    </>
  );
}

const NavFallback = () => null;

/** App frame. Requires QueryClientProvider and WalletConnectionProvider above it (root wiring). */
export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? "/";
  const main = useRef<HTMLElement>(null);
  const first = useRef(true);

  // Move focus to the content on client navigation so keyboard/screen-reader users start at the new page.
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    main.current?.focus({ preventScroll: true });
  }, [pathname]);

  return (
    <EnsureWalletConnection>
    <div className="min-h-screen bg-bg text-text">
      <a
        href="#main"
        className={`${focusRing} sr-only z-50 rounded-xl bg-primary px-4 py-2 text-primary-ink focus:not-sr-only focus:fixed focus:left-4 focus:top-4`}
      >
        Skip to content
      </a>
      <Suspense fallback={<NavFallback />}>
        <ShellNav pathname={pathname} />
      </Suspense>
      <div className="flex min-h-screen flex-col lg:pl-56">
        <header className="sticky top-0 z-20 border-b border-border bg-bg/90 backdrop-blur">
          <div className="mx-auto flex w-full max-w-[1280px] flex-wrap items-center gap-2 px-4 py-2 sm:px-6">
            <Link href="/" className={`${focusRing} rounded-xl py-2 text-base font-semibold lg:hidden`}>
              Macro<span className="text-primary">Paths</span>
            </Link>
            <span className="hidden rounded-full border border-border bg-surface px-3 py-1 text-xs text-muted md:inline">
              Historical replay · devnet · test PLAY
            </span>
            <div className="ml-auto flex min-w-0 items-center gap-2">
              <Suspense fallback={null}>
                <SessionPicker />
              </Suspense>
              <WalletControl />
            </div>
          </div>
          <p className="px-4 pb-2 text-xs text-muted md:hidden">Historical replay · devnet · test PLAY</p>
        </header>
        <Suspense fallback={null}>
          <SelectionNotice />
        </Suspense>
        <main
          id="main"
          ref={main}
          tabIndex={-1}
          className="mx-auto w-full min-w-0 max-w-[1280px] flex-1 scroll-mt-20 px-4 pb-[calc(5rem+env(safe-area-inset-bottom))] pt-4 outline-none sm:px-6 sm:pt-6 lg:pb-10"
        >
          {children}
        </main>
      </div>
    </div>
    </EnsureWalletConnection>
  );
}
