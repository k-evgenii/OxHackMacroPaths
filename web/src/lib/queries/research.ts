// Research queries. The bundle is version-keyed and cached long; the legacy artifact constants are kept
// for /dev and are re-exported (not redefined) by web/src/lib/artifacts.ts.
import { queryOptions } from "@tanstack/react-query";
import { Forecast, Manifest, PlannerArtifact, ResearchBundle } from "@macropaths/client/types";
import { ApiRequestError, fetchJson } from "@/lib/api-client";
import { queryKeys } from "./keys";

export const researchBundleQuery = (bundleId: string) =>
  queryOptions({
    queryKey: queryKeys.researchBundle(bundleId),
    queryFn: async ({ signal }) => {
      const bundle = await fetchJson("/api/artifacts/bundle", ResearchBundle, { signal });
      if (bundle.id !== bundleId)
        throw new ApiRequestError("The published research bundle does not match the requested version.", 409, "bundle_mismatch");
      return bundle;
    },
    staleTime: Infinity,
    gcTime: 60 * 60_000,
  });

// Legacy static research files: fetched once per page load.
export const manifestQuery = queryOptions({
  queryKey: ["artifact", "manifest"],
  queryFn: ({ signal }) => fetchJson("/api/artifacts/manifest", Manifest, { signal }),
  staleTime: Infinity,
});
export const forecastQuery = queryOptions({
  queryKey: ["artifact", "forecast"],
  queryFn: ({ signal }) => fetchJson("/api/artifacts/forecast", Forecast, { signal }),
  staleTime: Infinity,
});
export const plannerQuery = queryOptions({
  queryKey: ["artifact", "planner"],
  queryFn: ({ signal }) => fetchJson("/api/artifacts/planner", PlannerArtifact, { signal }),
  staleTime: Infinity,
});
