"use client";
// Pages using this hook read search params: render them under a <Suspense> boundary (Next 15).
import { useCallback, useMemo } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { SelectedSession } from "@/features/wallet-connect/contracts";
import { useCatalog } from "@/lib/hooks";
import { resolveSelection, selectHref, type SelectionState } from "./selection";

/** Internal: full selection state (shell banner/picker need the requested value and default). */
export function useSelectionState(): SelectionState & { select(address: string): void } {
  const pathname = usePathname() ?? "/";
  const params = useSearchParams();
  const router = useRouter();
  const catalog = useCatalog();
  const query = params?.get("session") ?? null;
  const search = params?.toString() ?? "";
  const state = useMemo(
    () => resolveSelection({ pathname, query, catalog: catalog.data, catalogStatus: catalog.status }),
    [pathname, query, catalog.data, catalog.status],
  );
  const select = useCallback((address: string) => router.push(selectHref(pathname, search, address)), [router, pathname, search]);
  return { ...state, select };
}

/** Selected registered session: `{ address, status, select }`. Address is null until the catalog loads. */
export function useSelectedSession(): SelectedSession {
  const { address, status, select } = useSelectionState();
  return useMemo(() => ({ address, status, select }), [address, status, select]);
}
