// URL-driven session selection (interfaces.md "Query and wallet interfaces").
// `/session/[addr]` selects its path address; Home/Activity/Products use optional `?session=<addr>`;
// absent means catalog.defaultSession. A path session wins over a conflicting query value. An explicit
// unregistered/malformed selection is `invalid` (never a silent fallback). No localStorage precedence.
import type { SelectedSession } from "@/features/wallet-connect/contracts";

export type Destination = "home" | "session" | "activity" | "products";

export const DESTINATIONS: ReadonlyArray<{ key: Destination; label: string }> = [
  { key: "home", label: "Home" },
  { key: "session", label: "Session" },
  { key: "activity", label: "Activity" },
  { key: "products", label: "Products" },
];

type CatalogLike = { defaultSession: string; sessions: ReadonlyArray<{ address: string }> };

export type SelectionState = Omit<SelectedSession, "select"> & {
  /** The explicit value that failed validation (status "invalid"). */
  requested: string | null;
  /** Catalog default, once the catalog has loaded. */
  defaultSession: string | null;
};

/** Address segment of a `/session/<addr>[/...]` path, decoded; null elsewhere. */
export function pathSession(pathname: string): string | null {
  const m = pathname.match(/^\/session\/([^/?#]+)/);
  if (!m) return null;
  try {
    return decodeURIComponent(m[1]);
  } catch {
    return m[1];
  }
}

export function resolveSelection(args: {
  pathname: string;
  query: string | null;
  catalog: CatalogLike | undefined;
  catalogStatus: "pending" | "error" | "success";
}): SelectionState {
  const { pathname, query, catalog, catalogStatus } = args;
  const explicit = pathSession(pathname) ?? (query && query.length > 0 ? query : null);
  if (!catalog) {
    return {
      address: null,
      status: catalogStatus === "error" ? "unavailable" : "loading",
      requested: null,
      defaultSession: null,
    };
  }
  if (explicit !== null) {
    const ok = catalog.sessions.some((s) => s.address === explicit);
    return ok
      ? { address: explicit, status: "ready", requested: null, defaultSession: catalog.defaultSession }
      : { address: null, status: "invalid", requested: explicit, defaultSession: catalog.defaultSession };
  }
  return { address: catalog.defaultSession, status: "ready", requested: null, defaultSession: catalog.defaultSession };
}

export function activeDestination(pathname: string): Destination | null {
  if (pathname === "/") return "home";
  if (pathname === "/session" || pathname.startsWith("/session/")) return "session";
  if (pathname === "/activity" || pathname.startsWith("/activity/")) return "activity";
  if (/^\/(products|forecast|planner)(\/|$)/.test(pathname)) return "products";
  return null;
}

const DEST_PATH: Record<Exclude<Destination, "session">, string> = { home: "/", activity: "/activity", products: "/products" };

/**
 * Link for a destination that preserves the selected registered address. The default session is
 * implied by an absent `?session`, so it is omitted for clean URLs.
 */
export function destinationHref(dest: Destination, address: string | null, defaultSession: string | null): string {
  if (dest === "session") {
    const a = address ?? defaultSession;
    return a ? `/session/${encodeURIComponent(a)}` : "/";
  }
  const base = DEST_PATH[dest];
  return address && address !== defaultSession ? `${base}?session=${encodeURIComponent(address)}` : base;
}

/** Where `select(address)` navigates within the current destination. */
export function selectHref(pathname: string, search: string, address: string): string {
  if (pathSession(pathname) !== null) {
    const rest = pathname.replace(/^\/session\/[^/?#]+/, "");
    return `/session/${encodeURIComponent(address)}${rest}`;
  }
  const params = new URLSearchParams(search);
  params.set("session", address);
  return `${pathname}?${params}`;
}

/** Explicit return-to-default action for an invalid selection. */
export function defaultSelectionHref(pathname: string, search: string, defaultSession: string): string {
  if (pathSession(pathname) !== null) return `/session/${encodeURIComponent(defaultSession)}`;
  const params = new URLSearchParams(search);
  params.delete("session");
  const q = params.toString();
  return q ? `${pathname}?${q}` : pathname;
}
