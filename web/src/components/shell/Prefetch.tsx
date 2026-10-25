// Deprecated pass-through. Fixture-only server prefetch was removed from the shell: in fixture mode the
// client answers from fixtures itself, and live mode never prefetched. Legacy route files (worker 15)
// still import this component; it renders children unchanged until those routes are migrated.
import type { FetchQueryOptions } from "@tanstack/react-query";

export function Prefetch({
  children,
}: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  queries?: FetchQueryOptions<any, any, any, any>[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  infinite?: any[];
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
