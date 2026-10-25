import { dehydrate, HydrationBoundary, QueryClient, type FetchQueryOptions } from "@tanstack/react-query";

/**
 * Server-side prefetch so first paint already has data (fixtures always resolve on the server).
 * Failed prefetches (e.g. a relative /api URL during SSR) are dropped and the client fetches instead.
 */
export async function Prefetch({
  queries = [],
  infinite = [],
  children,
}: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  queries?: FetchQueryOptions<any, any, any, any>[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  infinite?: any[];
  children: React.ReactNode;
}) {
  const client = new QueryClient();
  await Promise.all([
    ...queries.map((q) => client.prefetchQuery(q)),
    ...infinite.map((q) => client.prefetchInfiniteQuery(q)),
  ]);
  return <HydrationBoundary state={dehydrate(client)}>{children}</HydrationBoundary>;
}
