"use client";
// Minimal stand-ins for fe-03's web/src/lib/hooks. Repoint imports at merge.
import { useQuery } from "@tanstack/react-query";
import { PositionsResponse, SellerResponse, SessionView } from "@macropaths/client";
import { fetchJson } from "@/lib/api-client";

export const useSession = (addr: string, initialData?: SessionView) =>
  useQuery({ queryKey: ["session", addr], queryFn: () => fetchJson(`/api/sessions/${addr}`, SessionView), initialData });
export const usePositions = (addr: string, initialData?: PositionsResponse) =>
  useQuery({ queryKey: ["positions", addr], queryFn: () => fetchJson(`/api/sessions/${addr}/positions`, PositionsResponse), initialData });
export const useSeller = (addr: string, initialData?: SellerResponse) =>
  useQuery({ queryKey: ["seller", addr], queryFn: () => fetchJson(`/api/sessions/${addr}/seller`, SellerResponse), initialData });
