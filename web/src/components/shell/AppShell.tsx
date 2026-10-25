"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { CLUSTER, DEFAULT_SESSION } from "@/lib/api-client";
import { shortAddr, useHealth, useSessions } from "@/lib/hooks";

const SESSION_TABS = [
  ["Summary", ""],
  ["Path", "/path"],
  ["Results", "/results"],
  ["Activity", "/activity"],
  ["Seller", "/seller"],
] as const;

/** Session address and sub-route ("" | "/path" | ...) of the current URL, if it is a session page. */
function sessionRoute(pathname: string): { addr: string; sub: string } | null {
  const m = pathname.match(/^\/session\/([^/]+)(\/.*)?$/);
  return m ? { addr: decodeURIComponent(m[1]), sub: m[2] ?? "" } : null;
}

function NavLink({ href, active, children, nested }: { href: string; active: boolean; children: React.ReactNode; nested?: boolean }) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`block rounded-xl px-3 py-2 text-sm ${nested ? "ml-3" : ""} ${
        active ? "bg-primary/15 font-medium text-primary" : "text-muted hover:bg-surface-2 hover:text-text"
      }`}
    >
      {children}
    </Link>
  );
}

function Sidebar({ pathname, addr }: { pathname: string; addr: string }) {
  const base = `/session/${addr}`;
  return (
    <nav aria-label="Main" className="flex flex-col gap-1 p-3">
      <Link href="/" className="mb-4 px-3 py-2 text-lg font-bold">
        Macro<span className="text-primary">Paths</span>
      </Link>
      <NavLink href="/" active={pathname === "/"}>Overview</NavLink>
      <div className="mt-2 px-3 py-1 text-xs uppercase tracking-wide text-muted">Session</div>
      {SESSION_TABS.map(([label, sub]) => (
        <NavLink key={label} href={base + sub} active={pathname === base + sub} nested>
          {label}
        </NavLink>
      ))}
      <div className="mt-2" />
      <NavLink href="/forecast" active={pathname.startsWith("/forecast")}>Forecast</NavLink>
      <NavLink href="/planner" active={pathname.startsWith("/planner")}>Planner</NavLink>
    </nav>
  );
}

function SessionPicker({ addr, sub }: { addr: string; sub: string }) {
  const router = useRouter();
  const { data } = useSessions();
  const options = data?.sessions.map((s) => s.address) ?? [];
  if (!options.includes(addr)) options.unshift(addr);
  return (
    <label className="flex min-w-0 items-center gap-2 text-xs text-muted">
      <span className="hidden sm:inline">Session</span>
      <select
        value={addr}
        onChange={(e) => router.push(`/session/${e.target.value}${sub}`)}
        className="min-w-0 max-w-36 rounded-full border border-border bg-surface-2 px-2 py-1 font-mono text-xs text-text sm:max-w-56"
      >
        {options.map((a) => (
          <option key={a} value={a}>
            {shortAddr(a, 6)}
          </option>
        ))}
      </select>
    </label>
  );
}

function TopBar({ addr, sub, onMenu }: { addr: string; sub: string; onMenu: () => void }) {
  const health = useHealth();
  return (
    <header className="sticky top-0 z-20 flex items-center gap-2 border-b border-border bg-bg/90 px-4 py-3 backdrop-blur">
      <button
        type="button"
        onClick={onMenu}
        aria-label="Open navigation"
        className="rounded-lg border border-border px-2 py-1 text-sm lg:hidden"
      >
        Menu
      </button>
      <span className="rounded-full border border-primary/40 bg-primary/10 px-2 py-0.5 text-xs text-primary">
        {health.data?.cluster ?? CLUSTER}
      </span>
      <span className="num hidden text-xs text-muted sm:inline" title="Current slot from /api/health">
        slot {health.data ? health.data.slot.toLocaleString("en-US") : health.isError ? "unavailable" : "..."}
      </span>
      <div className="ml-auto flex min-w-0 items-center gap-2">
        <SessionPicker addr={addr} sub={sub} />
        <button
          type="button"
          disabled
          title="Wallet connection is not available yet"
          className="shrink-0 cursor-not-allowed rounded-full bg-primary/40 px-3 py-1 text-xs font-medium text-primary-ink opacity-70"
        >
          Connect wallet
        </button>
      </div>
    </header>
  );
}

/** App frame: sidebar (drawer below lg), top bar with cluster, slot, session picker and wallet placeholder. */
export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const route = sessionRoute(pathname);
  const addr = route?.addr ?? DEFAULT_SESSION;
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [pathname]);

  if (pathname === "/" || pathname === "/forecast") return <>{children}</>;

  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 hidden h-screen w-56 shrink-0 overflow-y-auto border-r border-border bg-surface lg:block">
        <Sidebar pathname={pathname} addr={addr} />
      </aside>
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
          <button type="button" aria-label="Close navigation" className="absolute inset-0 bg-black/60" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-64 max-w-[80vw] overflow-y-auto border-r border-border bg-surface">
            <Sidebar pathname={pathname} addr={addr} />
          </aside>
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar addr={addr} sub={route?.sub ?? ""} onMenu={() => setOpen(true)} />
        <main className="mx-auto w-full min-w-0 max-w-6xl flex-1 p-4 sm:p-6">{children}</main>
      </div>
    </div>
  );
}
