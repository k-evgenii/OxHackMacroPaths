"use client";
// Integrator: delegates to the shared query builders (same cache keys and polling as fe-03's hooks),
// keeping the optional initialData that the Path/Results/Seller server components pass in fixture mode.
import { useQuery } from "@tanstack/react-query";
import type { PositionsResponse, SellerResponse, SessionView } from "@macropaths/client";
import { positionsQuery, sellerQuery, sessionQuery } from "@/lib/hooks/queries";

export const useSession = (addr: string, initialData?: SessionView) =>
  useQuery({ ...sessionQuery(addr), initialData });

export function usePositions(addr: string, initialData?: PositionsResponse) {
  const state = useSession(addr).data?.state;
  return useQuery({ ...positionsQuery(addr, state), initialData });
}

export function useSeller(addr: string, initialData?: SellerResponse) {
  const state = useSession(addr).data?.state;
  return useQuery({ ...sellerQuery(addr, state), initialData });
}
